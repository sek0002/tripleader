from __future__ import annotations

import os
import calendar
import re
import threading
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

import pandas as pd
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from itsdangerous import BadSignature, URLSafeSerializer
from starlette.requests import Request


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
STORE_PATH = BASE_DIR / "purchases.csv"
LEGACY_PURCHASES_PATH = DATA_DIR / "purchases.csv"
TEAMAPP_URL = "https://muuc.teamapp.com/clubs/132307/store/purchases.json"
TEAMAPP_PAGE_PARAM = "page"
TEAMAPP_PAGE_RANGE = range(1, 7)
TEAMAPP_REFRESH_PAGE_RANGE = range(1, 2)
SYNC_INTERVAL_SECONDS = 60 * 60

CATEGORIES = [
    ("Hire", ["hire"]),
    ("Car Fee", ["car fee"]),
    ("Boat Dive/Exclusive", ["boat dive", "exclusive"]),
    ("Air Fills/Tank Fills", ["air fill", "air fills", "tank fill", "tank fills", "nitrox"]),
    ("Course", ["course"]),
    ("Membership", ["membership"]),
]

DISPLAY_COLUMNS = [
    "date",
    "paid",
    "payment_type",
    "transaction_id",
    "purchase_id",
    "payout_id",
    "currency",
    "total",
    "items",
    "note",
    "name",
    "shipping_address",
    "email",
    "phone",
    "gender",
    "dob",
    "year_of_birth",
    "emergency_contact_name",
    "emergency_contact_relationship",
    "emergency_contact_phone",
    "emergency_contact_phone_2",
    "contact_address",
]

DEDUPLICATION_COLUMNS = ["purchase_id", "items"]

load_dotenv(BASE_DIR / ".env")
sync_lock = threading.Lock()
cache_lock = threading.Lock()
initial_sync_completed = False
_store_cache: Optional[pd.DataFrame] = None
_store_cache_source: Optional[Path] = None
_store_cache_mtime: Optional[float] = None
last_sync: dict[str, Any] = {
    "ok": None,
    "message": "Not synced yet",
    "rows": 0,
    "at": None,
}


def auth_serializer() -> URLSafeSerializer:
    load_dotenv(BASE_DIR / ".env", override=True)
    secret = os.getenv("SESSION_SECRET", "").strip() or os.getenv("LOGIN_PIN", "dev").strip()
    return URLSafeSerializer(secret_key=secret, salt="muuc-purchases-login")


def configured_pin() -> str:
    load_dotenv(BASE_DIR / ".env", override=True)
    pin = os.getenv("LOGIN_PIN", "").strip()
    if not pin:
        raise RuntimeError("LOGIN_PIN is not set in .env")
    return pin


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get("muuc_auth", "")
    if not token:
        return False
    try:
        payload = auth_serializer().loads(token)
    except BadSignature:
        return False
    return payload == {"authenticated": True}


def require_login(request: Request) -> Optional[RedirectResponse]:
    if is_authenticated(request):
        return None
    return RedirectResponse(url="/login", status_code=303)


def clean_scalar(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def name_canonical_key(value: Any) -> str:
    normalized = clean_scalar(value)
    normalized = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.casefold()


PURCHASE_NAME_LEAK_KEYWORDS = {
    "air",
    "boat",
    "course",
    "dive",
    "exclusive",
    "fee",
    "hire",
    "liability",
    "merch",
    "misc",
    "membership",
    "month",
    "nitrox",
    "tank",
    "waiver",
}


def _looks_like_purchase_name_leak(value: str) -> bool:
    lowered = value.casefold()
    has_item_word = any(key in lowered for key in PURCHASE_NAME_LEAK_KEYWORDS)
    return bool(has_item_word or re.search(r"\d", value))


def _extract_name_tail(value: str) -> str:
    tokens = re.findall(r"[A-Za-z][A-Za-z'\\-]*", value)
    if len(tokens) < 2:
        return ""

    stopwords = {keyword for keyword in PURCHASE_NAME_LEAK_KEYWORDS}
    stopwords.update({"and", "for", "with", "on", "to", "at", "from", "in", "of", "the"})

    name_parts: list[str] = []
    for token in reversed(tokens):
        if token.casefold() in stopwords:
            break
        name_parts.append(token)
        if len(name_parts) == 4:
            break

    if len(name_parts) < 2:
        return ""

    candidate = " ".join(reversed(name_parts))
    if _looks_like_purchase_name_leak(candidate):
        return ""
    return re.sub(r"\s+", " ", candidate).strip()


def _choose_better_name(current: str, candidate: str) -> bool:
    if not candidate:
        return False
    if not current:
        return True

    current_leak = _looks_like_purchase_name_leak(current)
    candidate_leak = _looks_like_purchase_name_leak(candidate)
    if current_leak != candidate_leak:
        return not candidate_leak

    return _is_preferred_name(current, candidate)


def normalize_member_name(value: Any) -> str:
    candidate = clean_scalar(value)
    if not candidate:
        return ""

    candidate = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", candidate)
    candidate = _strip_quantity_prefix(candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    if candidate:
        candidate = re.sub(r"\d+x\s+", "", candidate, flags=re.I)

    if _looks_like_purchase_name_leak(candidate):
        extracted = _extract_name_tail(candidate)
        if extracted:
            candidate = extracted

    return re.sub(r"\s+", " ", candidate).strip()


def _is_preferred_name(current: str, candidate: str) -> bool:
    if len(candidate) > len(current):
        return True
    if len(candidate) == len(current):
        # Prefer standard capitalised names when length is the same.
        current_score = sum(ch.isupper() for ch in current)
        candidate_score = sum(ch.isupper() for ch in candidate)
        return candidate_score > current_score and candidate.strip() != current.strip()
    return False


def _strip_quantity_prefix(value: str) -> str:
    text = clean_scalar(value)
    if not text:
        return text
    text = re.sub(r"^\s*\d+\s*x\s*\d+\s*[.\-:]?\s*", "", text).strip()
    return re.sub(r"^\s*\d+\s*x\s*[.\-:]?\s*", "", text).strip()


def row_year(value: Any) -> Optional[int]:
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return int(parsed.year)


def _extract_stated_year(value: str) -> Optional[int]:
    source = clean_scalar(value)
    matches = re.findall(r"(?<!\d)(20\d{2})(?!\d)", source)
    if not matches:
        return None
    return int(matches[-1])


def _hire_segment(item: str) -> str:
    lowered = _strip_quantity_prefix(clean_scalar(item)).casefold()
    if "gear" in lowered or "common" in lowered or re.search(r"\bfull\b", lowered):
        return "Common"
    return "Other"


def _hire_status_detail(item: str, period: str) -> str:
    detail = _strip_quantity_prefix(clean_scalar(item))
    detail = re.sub(r"\s+", " ", detail).strip()
    detail = re.sub(r"^\s*\d+\s*x\s*\d*\s*[-.:]?\s*", "", detail, flags=re.I)
    detail = re.sub(r"^\s*(?:hire|rental)\b[\s:.-]*", "", detail, flags=re.I)
    detail = re.sub(r"^[\s\-.:]+", "", detail).strip()

    normalized_detail = re.sub(r"-", " ", detail.casefold())
    period_normalized = period.lower().replace("-", " ")
    if period_normalized not in normalized_detail:
        detail = f"{period} {detail}".strip() if detail else period

    detail = re.sub(r"\s+", " ", detail).strip()
    return detail.title() if detail else ""


def _normalized_hire_duration(item: str) -> Optional[tuple[str, int, str, str]]:
    lowered = _strip_quantity_prefix(item).casefold()
    if "hire" not in lowered:
        return None

    if "half year" in lowered or "half-year" in lowered or re.search(r"\b6\s*[-/]?(?:month|months)\b", lowered):
        period = "Half Year"
        return (
            period,
            6,
            _hire_segment(item),
            _hire_status_detail(item, period),
        )

    if (
        re.search(r"\b12\s*[-/]?(?:month|months)\b", lowered)
        or "yearly" in lowered
        or "annual" in lowered
        or "year" in lowered
    ):
        period = "Annual"
        return (
            period,
            12,
            _hire_segment(item),
            _hire_status_detail(item, period),
        )

    return None


def _parse_date_or_none(value: Any) -> Optional[date]:
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def _add_months(start: date, months: int) -> date:
    total = start.month - 1 + months
    year = start.year + (total // 12)
    month = (total % 12) + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _hire_status_for_payment_year(matches: pd.DataFrame) -> Optional[dict[str, Union[str, bool]]]:
    now = datetime.now(timezone.utc).date()
    candidates: list[tuple[date, str, int]] = []

    for _, row in matches.iterrows():
        if clean_scalar(row.get("paid")).strip().casefold() != "yes":
            continue
        description = f"{clean_scalar(row.get('items'))} {clean_scalar(row.get('note'))}".strip()
        duration = _normalized_hire_duration(description)
        if duration is None:
            continue
        paid_date = _parse_date_or_none(row.get("date"))
        if paid_date is None:
            continue
        period, months, segment, detail = duration
        status_detail = detail
        candidates.append((paid_date, status_detail, months))

    if not candidates:
        return None

    candidates.sort(reverse=True, key=lambda item: item[0])
    for paid_date, status_label, months in candidates:
        valid_until = _add_months(paid_date, months)
        if paid_date <= now <= valid_until:
            return {
                "is_current": True,
                "label": status_label,
            }
    return None


def is_current_year_membership_paid(item: str, note: Any, paid: Any, year: int) -> bool:
    if clean_scalar(paid).strip().casefold() != "yes":
        return False
    source = f"{clean_scalar(item)} {clean_scalar(note)}".casefold()
    normalized_item = source
    if "membership" not in normalized_item:
        return False
    stated_year = _extract_stated_year(source)
    if stated_year is None:
        return False
    return stated_year == year


def is_current_year_liability_waiver_paid(item: str, note: Any, paid: Any, year: int) -> bool:
    if clean_scalar(paid).strip().casefold() != "yes":
        return False
    source = f"{clean_scalar(item)} {clean_scalar(note)}".casefold()
    if "liability" not in source or "waiver" not in source:
        return False
    stated_year = _extract_stated_year(source)
    if stated_year is None:
        return False
    return stated_year == year


def merge_names_by_email(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    merged = df.copy()
    email_to_name: dict[str, str] = {}
    for _, row in merged.iterrows():
        email = clean_scalar(row.get("email"))
        if not email:
            continue

        name = normalize_member_name(row.get("name"))
        name_candidates = [name]
        if not name or _looks_like_purchase_name_leak(name):
            note_name = normalize_member_name(row.get("note"))
            if note_name:
                name_candidates.append(note_name)

        name = ""
        for candidate in name_candidates:
            if _choose_better_name(name, candidate):
                name = candidate
        if not name:
            continue

        email_key = email.casefold()
        if _choose_better_name(email_to_name.get(email_key, ""), name):
            email_to_name[email_key] = name

    if not email_to_name:
        return merged

    for email_key, canonical_name in email_to_name.items():
        merged.loc[merged["email"].map(lambda value: clean_scalar(value).casefold()) == email_key, "name"] = canonical_name

    return merged


def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    normalized_columns = df.columns.astype(str)
    df.columns = normalized_columns
    df = df.loc[:, ~normalized_columns.str.startswith("Unnamed")]

    for column in DISPLAY_COLUMNS:
        if column not in df.columns:
            df[column] = ""

    df = df[DISPLAY_COLUMNS]
    for column in DISPLAY_COLUMNS:
        df[column] = df[column].map(clean_scalar)

    df["name"] = df["name"].map(normalize_member_name)
    df["name_key"] = df["name"].str.casefold()
    dedupe_source = df[DEDUPLICATION_COLUMNS].astype(str).fillna("")
    df["_dedupe_key"] = dedupe_source.apply(lambda row: "||".join(row.astype(str)), axis=1)
    df = merge_names_by_email(df)
    return df


def _store_source() -> Optional[Path]:
    if STORE_PATH.exists():
        return STORE_PATH
    if LEGACY_PURCHASES_PATH.exists():
        return LEGACY_PURCHASES_PATH
    return None


def _invalidate_store_cache() -> None:
    global _store_cache, _store_cache_source, _store_cache_mtime
    _store_cache = None
    _store_cache_source = None
    _store_cache_mtime = None


def load_store() -> pd.DataFrame:
    global _store_cache, _store_cache_source, _store_cache_mtime
    source = _store_source()
    if source is None or not source.exists():
        return normalize_frame(pd.DataFrame())

    current_mtime = source.stat().st_mtime
    with cache_lock:
        if _store_cache is not None and _store_cache_source == source and _store_cache_mtime == current_mtime:
            return _store_cache

    df = normalize_frame(pd.read_csv(source, dtype=str, keep_default_na=False))
    with cache_lock:
        _store_cache = df
        _store_cache_source = source
        _store_cache_mtime = current_mtime
    return df


def save_store(df: pd.DataFrame) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    output = df.drop(columns=["name_key", "_dedupe_key"], errors="ignore")
    output.to_csv(STORE_PATH, index=False)
    _invalidate_store_cache()


def deduplicate_purchases(df: pd.DataFrame, keep: str = "first") -> pd.DataFrame:
    if df.empty:
        return df
    return df.drop_duplicates(subset=["_dedupe_key"], keep=keep).reset_index(drop=True)


def purchase_date_range(df: Optional[pd.DataFrame] = None) -> dict[str, str]:
    source = load_store() if df is None else df
    if source.empty or "date" not in source.columns:
        return {"start": "", "end": "", "label": "Available date range: no purchase data stored"}

    dates = pd.to_datetime(source["date"], format="%Y-%b-%d", errors="coerce")
    dates = dates.dropna()
    if dates.empty:
        return {"start": "", "end": "", "label": "Available date range: no valid dates found"}

    start = dates.min().strftime("%Y-%b-%d")
    end = dates.max().strftime("%Y-%b-%d")
    return {"start": start, "end": end, "label": f"Available date range: {start} to {end}"}


def build_headers() -> dict[str, str]:
    load_dotenv(BASE_DIR / ".env", override=True)
    cookie = os.getenv("TEAMAPP_COOKIE", "").strip()
    if not cookie:
        raise RuntimeError("TEAMAPP_COOKIE is not set in .env")

    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
        ),
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Cookie": cookie,
    }


def fetch_remote_purchases(page_range: range = TEAMAPP_PAGE_RANGE) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for page in page_range:
        response = requests.get(
            TEAMAPP_URL,
            headers=build_headers(),
            params={"_csv_data": "v1", TEAMAPP_PAGE_PARAM: page},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("data", [])
        if not isinstance(rows, list) or not rows:
            continue
        frames.append(pd.json_normalize(rows))

    if not frames:
        return normalize_frame(pd.DataFrame())

    return normalize_frame(pd.concat(frames, ignore_index=True))


def sync_purchases(force: bool = False) -> dict[str, Any]:
    global initial_sync_completed
    with sync_lock:
        existing = deduplicate_purchases(load_store(), keep="first")
        has_existing_data = not existing.empty
        page_range = (
            TEAMAPP_REFRESH_PAGE_RANGE
            if (force or initial_sync_completed or has_existing_data)
            else TEAMAPP_PAGE_RANGE
        )
        try:
            fresh = fetch_remote_purchases(page_range=page_range)
            existing_count = len(existing)
            merged = pd.concat([existing, fresh], ignore_index=True)
            merged = deduplicate_purchases(merged, keep="first")
            added_count = len(merged) - existing_count
            save_store(merged)
            status = {
                "ok": True,
                "message": (
                    f"Fetched {len(fresh)} rows, appended {added_count} new rows, "
                    f"stored {len(merged)} unique purchase/item rows"
                ),
                "rows": int(len(merged)),
                "at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            save_store(existing)
            status = {
                "ok": False,
                "message": str(exc),
                "rows": int(len(existing)),
                "at": datetime.now(timezone.utc).isoformat(),
            }
        finally:
            initial_sync_completed = True

        last_sync.update(status)
        result = dict(last_sync)
        result["date_range"] = purchase_date_range(load_store())
        return result


def hourly_worker() -> None:
    while True:
        time.sleep(SYNC_INTERVAL_SECONDS)
        sync_purchases()


def category_for_item(item: str) -> str:
    lowered = item.casefold()
    for category, needles in CATEGORIES:
        if any(needle in lowered for needle in needles):
            return category
    return "Misc"


def names_from_store() -> list[str]:
    df = load_store()
    email_to_name: dict[str, str] = {}
    grouped_names: dict[str, str] = {}
    for _, row in df.iterrows():
        name = normalize_member_name(row.get("name"))
        if not name:
            continue
        email = clean_scalar(row.get("email")).casefold()
        if email:
            if _is_preferred_name(email_to_name.get(email, ""), name):
                email_to_name[email] = name
        else:
            key = name_canonical_key(name)
            if _is_preferred_name(grouped_names.get(key, ""), name):
                grouped_names[key] = name

    for name in email_to_name.values():
        grouped_names[name_canonical_key(name)] = name

    names = sorted(grouped_names.values(), key=str.casefold)
    return names


def member_summary(name: str) -> dict[str, Any]:
    df = load_store()
    name_key = name_canonical_key(name)
    matches = df[df["name_key"] == name_key].copy()
    if matches.empty:
        matches = df[df["name"].map(name_canonical_key) == name_key].copy()
    if matches.empty:
        return {"found": False, "name": name, "emergency": {}, "categories": {}}

    base_email = clean_scalar(matches.iloc[0].get("email"))
    if base_email:
        email_key = base_email.casefold()
        matched_by_email = df[df["email"].str.casefold() == email_key].copy()
        if not matched_by_email.empty:
            matches = matched_by_email

    payment_year = datetime.now(timezone.utc).year
    payment_year_matches = matches[matches["date"].map(row_year).eq(payment_year)].copy()
    hire_status_matches = matches.copy()

    merged_names = [normalize_member_name(value) for value in matches["name"]]
    merged_name = max((value for value in merged_names if value), key=len, default=name)
    latest = matches.iloc[0]
    contact = {
        "email": base_email or clean_scalar(latest.get("email")),
    }
    emergency = {
        "emergency_contact_name": clean_scalar(latest.get("emergency_contact_name")),
        "emergency_contact_relationship": clean_scalar(latest.get("emergency_contact_relationship")),
        "emergency_contact_phone": clean_scalar(latest.get("emergency_contact_phone")),
        "emergency_contact_phone_2": clean_scalar(latest.get("emergency_contact_phone_2")),
    }

    current_member = any(
        is_current_year_membership_paid(
            row.get("items"),
            row.get("note"),
            row.get("paid"),
            payment_year,
        )
        for _, row in payment_year_matches.iterrows()
    )
    liability_waiver = any(
        is_current_year_liability_waiver_paid(
            row.get("items"),
            row.get("note"),
            row.get("paid"),
            payment_year,
        )
        for _, row in payment_year_matches.iterrows()
    )
    hire_status = _hire_status_for_payment_year(hire_status_matches)

    grouped: dict[str, list[dict[str, str]]] = {category: [] for category, _ in CATEGORIES}
    for _, row in payment_year_matches.iterrows():
        category = category_for_item(clean_scalar(row.get("items")))
        if category not in grouped:
            continue
        item_text = clean_scalar(row.get("items"))
        grouped.setdefault(category, []).append(
            {
                "date": clean_scalar(row.get("date")),
                "paid": clean_scalar(row.get("paid")),
                "total": clean_scalar(row.get("total")),
                "items": item_text,
            }
        )

    grouped = {category: rows for category, rows in grouped.items() if rows}
    return {
        "found": True,
        "name": merged_name,
        "contact": contact,
        "emergency": emergency,
        "membership_status": {
            "is_current": current_member,
            "label": "Current Member",
        },
        "liability_waiver_status": {
            "is_current": liability_waiver,
            "label": "Liability Waiver",
        },
        "hire_status": hire_status,
        "categories": grouped,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    sync_purchases()
    thread = threading.Thread(target=hourly_worker, daemon=True)
    thread.start()
    yield


app = FastAPI(title="MUUC Purchases", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "app" / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "app" / "templates")


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    return templates.TemplateResponse(request, "index.html")


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/", status_code=303)
    return templates.TemplateResponse(request, "login.html", {"error": ""})


@app.post("/login")
def login(request: Request, pin: str = Form("")):
    if pin.strip() != configured_pin():
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "Incorrect PIN"},
            status_code=401,
        )

    token = auth_serializer().dumps({"authenticated": True})
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(
        "muuc_auth",
        token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 12,
    )
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie("muuc_auth")
    return response


@app.post("/api/refresh")
def refresh(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    return sync_purchases(force=True)


@app.get("/api/status")
def status(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    current = dict(last_sync)
    store = load_store()
    current["rows"] = int(store.shape[0])
    current["date_range"] = purchase_date_range(store)
    return current


@app.get("/api/names")
def names(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    return {"names": names_from_store()}


@app.get("/api/member/{name}")
def member(request: Request, name: str):
    redirect = require_login(request)
    if redirect:
        return redirect
    return member_summary(name)
