from __future__ import annotations

import os
import calendar
import json
import re
import threading
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
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
SYNC_STATE_PATH = BASE_DIR / "purchases.sync.json"
TRIPS_PATH = BASE_DIR / "trips.json"
MEMBER_DATA_PATH = BASE_DIR / "member-data.json"
MEMBER_PROFILE_PATH = BASE_DIR / "member-profiles.json"
MEMBER_PROFILE_SYNC_STATE_PATH = BASE_DIR / "member-profiles.sync.json"
TEAMAPP_URL = "https://muuc.teamapp.com/clubs/132307/store/purchases.json"
TEAMAPP_MEMBERSHIPS_URL = "https://muuc.teamapp.com/clubs/132307/memberships.json"
TEAMAPP_PAGE_PARAM = "page"
TEAMAPP_PAGE_RANGE = range(1, 7)
TEAMAPP_REFRESH_PAGE_RANGE = range(1, 2)
SYNC_INTERVAL_SECONDS = 60 * 60
SYNC_STALE_SECONDS = 15 * 60
MEMBER_PROFILE_SYNC_STALE_SECONDS = 24 * 60 * 60

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
member_data_lock = threading.Lock()
member_profile_lock = threading.Lock()
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


def is_current_year_membership_paid(item: str, note: Any, paid: Any) -> bool:
    if clean_scalar(paid).strip().casefold() != "yes":
        return False
    source = f"{clean_scalar(item)} {clean_scalar(note)}".casefold()
    normalized_item = source
    if "membership" not in normalized_item:
        return False
    stated_year = _extract_stated_year(source)
    if stated_year is None:
        return False
    now = datetime.now(timezone.utc).date()
    start = date(stated_year, 3, 1)
    end = date(stated_year + 1, 3, 1)
    return start <= now < end


def _current_membership_year() -> int:
    today = datetime.now(timezone.utc).date()
    return today.year if today >= date(today.year, 3, 1) else today.year - 1


def _current_status_year_label(matches: pd.DataFrame, matcher: Any, fallback_prefix: str) -> str:
    for _, row in matches.iterrows():
        if matcher(row.get("items"), row.get("note"), row.get("paid")):
            source = f"{clean_scalar(row.get('items'))} {clean_scalar(row.get('note'))}".casefold()
            stated_year = _extract_stated_year(source)
            if stated_year is not None:
                return f"{fallback_prefix} {stated_year}"
    return f"{fallback_prefix} {_current_membership_year()}"


def is_current_year_liability_waiver_paid(item: str, note: Any, paid: Any) -> bool:
    if clean_scalar(paid).strip().casefold() != "yes":
        return False
    source = f"{clean_scalar(item)} {clean_scalar(note)}".casefold()
    if "liability" not in source or "waiver" not in source:
        return False
    stated_year = _extract_stated_year(source)
    if stated_year is None:
        return False
    now = datetime.now(timezone.utc).date()
    start = date(stated_year, 3, 1)
    end = date(stated_year + 1, 3, 1)
    return start <= now < end


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
    if df.empty:
        df["_dedupe_key"] = ""
        return df
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


def _parse_stored_sync_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _last_synced_at() -> Optional[datetime]:
    if SYNC_STATE_PATH.exists():
        try:
            payload = json.loads(SYNC_STATE_PATH.read_text(encoding="utf-8"))
            synced_at = _parse_stored_sync_time(payload.get("at"))
            if synced_at is not None:
                return synced_at
        except Exception:
            pass

    source = _store_source()
    if source is None or not source.exists():
        return None
    try:
        return datetime.fromtimestamp(source.stat().st_mtime, tz=timezone.utc)
    except Exception:
        return None


def _persist_sync_state(rows: int, at: datetime) -> None:
    try:
        SYNC_STATE_PATH.write_text(
            json.dumps({"at": at.isoformat(), "rows": rows}, sort_keys=True),
            encoding="utf-8",
        )
    except Exception:
        pass


def _is_sync_stale(now: datetime) -> bool:
    synced_at = _last_synced_at()
    if synced_at is None:
        return True
    return (now - synced_at).total_seconds() >= SYNC_STALE_SECONDS


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


def status_snapshot() -> dict[str, Any]:
    current = dict(last_sync)
    store = load_store()
    synced_at = current.get("at") or (_last_synced_at().isoformat() if _last_synced_at() else None)
    current["rows"] = int(store.shape[0])
    current["at"] = synced_at
    if current.get("ok") is None and synced_at:
        current["ok"] = True
        current["message"] = "Using cached purchase data."
    current["date_range"] = purchase_date_range(store)
    return current


def display_sync_time(value: Any) -> str:
    parsed = _parse_stored_sync_time(value)
    if parsed is None:
        return "never"
    return parsed.astimezone().strftime("%d/%m/%Y, %I:%M:%S %p")


def freshness_color(value: Any) -> str:
    parsed = _parse_stored_sync_time(value)
    if parsed is None:
        return "hsl(120, 72%, 45%)"
    now = datetime.now(timezone.utc)
    elapsed = max(0.0, (now - parsed.astimezone(timezone.utc)).total_seconds())
    ratio = min(1.0, elapsed / SYNC_STALE_SECONDS)
    hue = round(120 * (1 - ratio))
    return f"hsl({hue}, 72%, 45%)"


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


def _profile_text(profile: dict[str, Any], *fields: str) -> str:
    return " ".join(clean_scalar(profile.get(field)) for field in fields if clean_scalar(profile.get(field)))


def _membership_profile_record(row: dict[str, Any]) -> dict[str, str]:
    return {
        "name": normalize_member_name(row.get("name")),
        "name_key": name_canonical_key(row.get("name")),
        "email": clean_scalar(row.get("email")),
        "email_key": clean_scalar(row.get("email")).casefold(),
        "dive_certification": clean_scalar(row.get("Dive Certification*")),
        "diving_history": clean_scalar(row.get("Diving History*")),
        "membership_type": clean_scalar(row.get("Membership Type*")),
        "gear_hire_acknowledgement": clean_scalar(row.get("Gear Hire*")),
        "oxygen_blender_certification": clean_scalar(row.get("Oxygen blender certification")),
        "access_groups_csv": clean_scalar(row.get("access_groups_csv")),
        "restricted_admin_groups_csv": clean_scalar(row.get("restricted_admin_groups_csv")),
        "note": clean_scalar(row.get("note")),
        "updated_at": clean_scalar(row.get("updated_at")),
    }


def fetch_remote_member_profiles() -> list[dict[str, str]]:
    profiles: list[dict[str, str]] = []
    page = 1
    next_url = ""
    while page <= 200:
        if next_url:
            response = requests.get(next_url, headers=build_headers(), timeout=30)
        else:
            response = requests.get(
                TEAMAPP_MEMBERSHIPS_URL,
                headers=build_headers(),
                params={"_csv_data": "v1", TEAMAPP_PAGE_PARAM: page},
                timeout=30,
            )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("data", [])
        if not isinstance(rows, list) or not rows:
            break
        profiles.extend(_membership_profile_record(row) for row in rows if isinstance(row, dict))
        next_url = clean_scalar(payload.get("nextPageUrl"))
        if next_url.startswith("/"):
            next_url = f"https://muuc.teamapp.com{next_url}"
        if not next_url:
            break
        page += 1
    return profiles


def _last_member_profile_synced_at() -> Optional[datetime]:
    if MEMBER_PROFILE_SYNC_STATE_PATH.exists():
        try:
            payload = json.loads(MEMBER_PROFILE_SYNC_STATE_PATH.read_text(encoding="utf-8"))
            synced_at = _parse_stored_sync_time(payload.get("at"))
            if synced_at is not None:
                return synced_at
        except Exception:
            pass
    if not MEMBER_PROFILE_PATH.exists():
        return None
    try:
        return datetime.fromtimestamp(MEMBER_PROFILE_PATH.stat().st_mtime, tz=timezone.utc)
    except Exception:
        return None


def _member_profile_sync_is_stale(now: datetime) -> bool:
    synced_at = _last_member_profile_synced_at()
    if synced_at is None:
        return True
    return (now - synced_at).total_seconds() >= MEMBER_PROFILE_SYNC_STALE_SECONDS


def _save_member_profiles(profiles: list[dict[str, str]], synced_at: datetime) -> None:
    MEMBER_PROFILE_PATH.write_text(json.dumps(profiles, indent=2, sort_keys=True), encoding="utf-8")
    MEMBER_PROFILE_SYNC_STATE_PATH.write_text(
        json.dumps({"at": synced_at.isoformat(), "rows": len(profiles)}, sort_keys=True),
        encoding="utf-8",
    )


def sync_member_profiles(force: bool = False) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    with member_profile_lock:
        if not force and MEMBER_PROFILE_PATH.exists() and not _member_profile_sync_is_stale(now):
            profiles = _load_member_profiles()
            return {
                "ok": True,
                "message": "Using cached member profile data.",
                "rows": len(profiles),
                "at": (_last_member_profile_synced_at() or now).isoformat(),
            }
        try:
            profiles = fetch_remote_member_profiles()
            _save_member_profiles(profiles, now)
            return {
                "ok": True,
                "message": f"Fetched {len(profiles)} member profile rows.",
                "rows": len(profiles),
                "at": now.isoformat(),
            }
        except Exception as exc:
            profiles = _load_member_profiles()
            return {
                "ok": False,
                "message": str(exc),
                "rows": len(profiles),
                "at": now.isoformat(),
            }


def _load_member_profiles() -> list[dict[str, str]]:
    if not MEMBER_PROFILE_PATH.exists():
        return []
    try:
        payload = json.loads(MEMBER_PROFILE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def _find_member_profile(name: str, email: str = "") -> Optional[dict[str, str]]:
    profiles = _load_member_profiles()
    email_key = clean_scalar(email).casefold()
    if email_key:
        for profile in profiles:
            if clean_scalar(profile.get("email_key")) == email_key:
                return profile
            if clean_scalar(profile.get("email")).casefold() == email_key:
                return profile
    name_key = name_canonical_key(name)
    if name_key:
        for profile in profiles:
            if clean_scalar(profile.get("name_key")) == name_key:
                return profile
            if name_canonical_key(profile.get("name")) == name_key:
                return profile
    return None


def _certification_statuses(profile: Optional[dict[str, Any]]) -> list[dict[str, str]]:
    if not profile:
        return []
    source = _profile_text(profile, "dive_certification")
    access_groups = clean_scalar(profile.get("access_groups_csv"))
    source_lower = source.casefold()
    access_groups_lower = access_groups.casefold()
    statuses: list[dict[str, str]] = []
    if re.search(r"\bandp\b|\btech\b|technical|advanced\s+nitrox|deco\s+procedure|decompression\s+procedure", source_lower):
        statuses.append({"code": "Tech", "label": "Tech"})
    elif re.search(r"\ba\.?o\.?w\.?\b|advanced\s+open\s+water|\badventure\b|\bdeep\b", source_lower):
        statuses.append({"code": "AOW", "label": "AOW"})
    elif re.search(r"\bo\.?w\.?\b|open\s+water|\bowd\b", source_lower):
        statuses.append({"code": "OW", "label": "OW"})
    if re.search(r"\bnitrox\b", source_lower):
        statuses.append({"code": "NO", "label": "Nitrox"})
    access_groups_has_dive_master = re.search(r"\bd\.?m\.?\b|\bdive\s+master\b|\bdivemaster\b", access_groups_lower)
    if access_groups_has_dive_master:
        statuses.append({"code": "Pro", "label": "Dive Master"})
    return statuses


def _role_statuses(profile: Optional[dict[str, Any]]) -> list[dict[str, str]]:
    if not profile:
        return []
    source = clean_scalar(profile.get("access_groups_csv"))
    source_lower = source.casefold()
    statuses: list[dict[str, str]] = []
    if "boat dive check" in source_lower:
        statuses.append({"code": "Boat", "label": "Boat Dive Check"})
    if "certified oxygen blenders" in source_lower:
        statuses.append({"code": "O2", "label": "Certified Oxygen Blender"})
    if "instructor" in source_lower or "msdt" in source_lower:
        statuses.append({"code": "Inst", "label": "Instructor"})
    if "endorsed car driver" in source_lower:
        statuses.append({"code": "Car", "label": "Endorsed Car Driver"})
    return statuses


def _member_profile_summary(profile: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not profile:
        return {
            "dive_certification": "",
            "diving_history": "",
            "membership_type": "",
            "certification_statuses": [],
            "role_statuses": [],
        }
    return {
        "dive_certification": clean_scalar(profile.get("dive_certification")),
        "diving_history": clean_scalar(profile.get("diving_history")),
        "membership_type": clean_scalar(profile.get("membership_type")),
        "certification_statuses": _certification_statuses(profile),
        "role_statuses": _role_statuses(profile),
    }


def sync_purchases(force: bool = False) -> dict[str, Any]:
    global initial_sync_completed
    with sync_lock:
        existing = deduplicate_purchases(load_store(), keep="first")
        has_existing_data = not existing.empty
        now = datetime.now(timezone.utc)
        if not force and has_existing_data and not _is_sync_stale(now):
            profile_status = sync_member_profiles()
            status = {
                "ok": True,
                "message": "Using cached purchase data (checked less than 15 minutes ago).",
                "rows": int(len(existing)),
                "at": _last_synced_at().isoformat() if _last_synced_at() else now.isoformat(),
            }
            if profile_status.get("ok") is False:
                status["message"] = f"{status['message']} Member profile sync issue: {profile_status.get('message')}"
            last_sync.update(status)
            result = dict(last_sync)
            result["date_range"] = purchase_date_range(load_store())
            result["member_profiles"] = profile_status
            return result
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
                "at": now.isoformat(),
            }
            _persist_sync_state(len(merged), now)
        except Exception as exc:
            save_store(existing)
            if has_existing_data:
                _persist_sync_state(len(existing), now)
            status = {
                "ok": False,
                "message": str(exc),
                "rows": int(len(existing)),
                "at": now.isoformat(),
            }
        finally:
            initial_sync_completed = True

        profile_status = sync_member_profiles()
        if profile_status.get("ok") is False:
            status["message"] = f"{status.get('message', '')} Member profile sync issue: {profile_status.get('message')}"
        last_sync.update(status)
        result = dict(last_sync)
        result["date_range"] = purchase_date_range(load_store())
        result["member_profiles"] = profile_status
        return result


def hourly_worker() -> None:
    while True:
        time.sleep(SYNC_INTERVAL_SECONDS)
        sync_purchases()
        sync_member_profiles()


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
    profiles = _load_member_profiles()
    profile_by_email = {
        clean_scalar(profile.get("email")).casefold(): normalize_member_name(profile.get("name"))
        for profile in profiles
        if clean_scalar(profile.get("email")) and normalize_member_name(profile.get("name"))
    }
    profile_by_name = {
        name_canonical_key(profile.get("name")): normalize_member_name(profile.get("name"))
        for profile in profiles
        if normalize_member_name(profile.get("name"))
    }
    for _, row in df.iterrows():
        name = normalize_member_name(row.get("name"))
        email = clean_scalar(row.get("email")).casefold()
        if email and profile_by_email.get(email):
            name = profile_by_email[email]
        elif name and profile_by_name.get(name_canonical_key(name)):
            name = profile_by_name[name_canonical_key(name)]
        if not name:
            continue
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


def _member_matches(name: str) -> pd.DataFrame:
    df = load_store()
    name_key = name_canonical_key(name)
    matches = df[df["name_key"] == name_key].copy()
    if matches.empty:
        matches = df[df["name"].map(name_canonical_key) == name_key].copy()
    if matches.empty:
        profile = _find_member_profile(name)
        profile_email = clean_scalar(profile.get("email")) if profile else ""
        if profile_email:
            matches = df[df["email"].str.casefold() == profile_email.casefold()].copy()
    if matches.empty:
        return matches

    base_email = clean_scalar(matches.iloc[0].get("email"))
    if base_email:
        email_key = base_email.casefold()
        matched_by_email = df[df["email"].str.casefold() == email_key].copy()
        if not matched_by_email.empty:
            matches = matched_by_email
    return matches


def member_summary(name: str) -> dict[str, Any]:
    matches = _member_matches(name)
    if matches.empty:
        return {"found": False, "name": name, "emergency": {}, "categories": {}}

    base_email = clean_scalar(matches.iloc[0].get("email"))

    payment_year = datetime.now(timezone.utc).year
    payment_year_matches = matches[matches["date"].map(row_year).eq(payment_year)].copy()
    hire_status_matches = matches.copy()

    profile_by_email = _find_member_profile(name, base_email)
    profile_name = normalize_member_name(profile_by_email.get("name")) if profile_by_email else ""
    merged_names = [normalize_member_name(value) for value in matches["name"]]
    merged_name = profile_name or max((value for value in merged_names if value), key=len, default=name)
    latest = matches.iloc[0]
    contact_phone = next(
        (clean_scalar(value) for value in matches["phone"] if clean_scalar(value)),
        "",
    )
    contact = {
        "email": base_email or clean_scalar(latest.get("email")),
        "phone": contact_phone,
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
        )
        for _, row in matches.iterrows()
    )
    membership_label = _current_status_year_label(matches, is_current_year_membership_paid, "Membership")
    liability_waiver = any(
        is_current_year_liability_waiver_paid(
            row.get("items"),
            row.get("note"),
            row.get("paid"),
        )
        for _, row in matches.iterrows()
    )
    liability_waiver_label = _current_status_year_label(matches, is_current_year_liability_waiver_paid, "Liability Waiver")
    hire_status = _hire_status_for_payment_year(hire_status_matches)
    member_profile = profile_by_email or _find_member_profile(merged_name, base_email)

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
        "saved_member_data": _member_saved_data(merged_name),
        "member_profile": _member_profile_summary(member_profile),
        "membership_status": {
            "is_current": current_member,
            "label": membership_label,
        },
        "liability_waiver_status": {
            "is_current": liability_waiver,
            "label": liability_waiver_label,
        },
        "hire_status": hire_status,
        "categories": grouped,
    }


def _trip_date(value: Any) -> Optional[date]:
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def _trip_member_transactions(name: str) -> list[dict[str, str]]:
    matches = _member_matches(name)
    if matches.empty:
        return []
    rows: list[dict[str, str]] = []
    for _, row in matches.sort_values("date", ascending=False).iterrows():
        rows.append(
            {
                "name": clean_scalar(row.get("name")),
                "date": clean_scalar(row.get("date")),
                "paid": clean_scalar(row.get("paid")),
                "total": clean_scalar(row.get("total")),
                "items": clean_scalar(row.get("items")),
            }
        )
    return rows


def _recent_week_transactions(days: int = 7) -> dict[str, dict[str, list[dict[str, str]]]]:
    try:
        days = int(days)
    except Exception:
        days = 7
    if days < 1:
        days = 1

    matches = load_store()
    if matches.empty or "date" not in matches.columns:
        return {category: [] for category, _ in CATEGORIES}

    today = datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = today - timedelta(days=days)
    transactions = matches.copy()
    transactions["_date"] = pd.to_datetime(transactions["date"], format="mixed", errors="coerce")
    recent = transactions.loc[
        transactions["_date"].notna()
        & (transactions["_date"] >= cutoff)
        & (transactions["_date"] <= today)
    ].copy()

    grouped: dict[str, list[dict[str, str]]] = {category: [] for category, _ in CATEGORIES}
    for _, row in recent.sort_values("_date", ascending=False).iterrows():
        item_text = clean_scalar(row.get("items"))
        category = category_for_item(item_text)
        if category not in grouped:
            continue
        grouped.setdefault(category, []).append(
            {
                "name": clean_scalar(row.get("name")),
                "date": clean_scalar(row.get("date")),
                "paid": clean_scalar(row.get("paid")),
                "total": clean_scalar(row.get("total")),
                "items": item_text,
            }
        )
    return {category: rows for category, rows in grouped.items() if rows}


def _boat_payment_status(name: str, trip_date_value: Any, boat_selected: bool) -> Optional[dict[str, Union[str, bool]]]:
    if not boat_selected:
        return None

    matches = _member_matches(name)
    if matches.empty:
        return None

    trip_day = _trip_date(trip_date_value)
    if trip_day is None:
        return None

    payment_window_start = trip_day - timedelta(days=7)
    now = datetime.now(timezone.utc)
    for _, row in matches.iterrows():
        paid = clean_scalar(row.get("paid")).casefold() == "yes"
        item_text = clean_scalar(row.get("items")).casefold()
        paid_date = _trip_date(row.get("date"))
        if (
            paid
            and paid_date
            and payment_window_start <= paid_date <= trip_day
            and "boat" in item_text
        ):
            return {"is_current": True, "label": "Boat Fee Paid"}

    trip_datetime = datetime.combine(trip_day, datetime.min.time(), tzinfo=timezone.utc)
    hours_until_trip = (trip_datetime - now).total_seconds() / 3600
    if 0 <= hours_until_trip <= 72:
        return {"is_current": False, "label": "Boat Fee Overdue"}

    return None


def trip_member_summary(name: str, trip_date_value: Any, boat_selected: bool) -> dict[str, Any]:
    summary = member_summary(name)
    summary["boat_payment_status"] = _boat_payment_status(name, trip_date_value, boat_selected)
    summary["transactions"] = _trip_member_transactions(name)
    return summary


def _load_trips() -> list[dict[str, Any]]:
    if not TRIPS_PATH.exists():
        return []
    try:
        payload = json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def _save_trips(trips: list[dict[str, Any]]) -> None:
    TRIPS_PATH.write_text(json.dumps(trips, indent=2, sort_keys=True), encoding="utf-8")


def _member_data_key(name: Any) -> str:
    return name_canonical_key(name)


def _load_member_data() -> dict[str, Any]:
    if not MEMBER_DATA_PATH.exists():
        return {}
    try:
        payload = json.loads(MEMBER_DATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _save_member_data(payload: dict[str, Any]) -> None:
    MEMBER_DATA_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _member_saved_data(name: str) -> dict[str, Any]:
    key = _member_data_key(name)
    if not key:
        return {"comment": "", "membership_override": None}
    with member_data_lock:
        record = _load_member_data().get(key, {})
    if not isinstance(record, dict):
        record = {}
    membership_override = record.get("membership_override")
    if not isinstance(membership_override, dict):
        membership_override = None
    return {
        "comment": clean_scalar(record.get("comment")),
        "membership_override": membership_override,
    }


def _update_member_saved_data(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    key = _member_data_key(name)
    if not key:
        return {"comment": "", "membership_override": None}
    with member_data_lock:
        all_data = _load_member_data()
        record = all_data.get(key, {})
        if not isinstance(record, dict):
            record = {}

        if "comment" in payload:
            comment = clean_scalar(payload.get("comment"))
            if comment:
                record["comment"] = comment
            else:
                record.pop("comment", None)

        if "membership_override" in payload:
            override = payload.get("membership_override")
            if isinstance(override, dict) and "is_current" in override:
                record["membership_override"] = {
                    "is_current": bool(override.get("is_current")),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            elif override is None:
                record.pop("membership_override", None)

        if record:
            all_data[key] = record
        else:
            all_data.pop(key, None)
        _save_member_data(all_data)
    return _member_saved_data(name)


def _trip_is_archived(trip: dict[str, Any]) -> bool:
    if trip.get("archived") is True:
        return True
    trip_day = _trip_date(trip.get("date"))
    return trip_day is not None and trip_day < date.today()


def _trips_for_archive(archived: bool) -> list[dict[str, Any]]:
    return [trip for trip in _load_trips() if _trip_is_archived(trip) == archived]


def _default_trip_pattern(trip_id: str) -> str:
    seed = sum((index + 1) * ord(character) for index, character in enumerate(trip_id))
    values = [
        12 + seed % 76,
        10 + (seed // 3) % 78,
        12 + (seed // 5) % 76,
        10 + (seed // 7) % 78,
        12 + (seed // 11) % 76,
        10 + (seed // 13) % 78,
        seed % 180,
    ]
    return "r-" + "-".join(str(value) for value in values)


def _clean_trip_payload(payload: dict[str, Any], existing_id: Optional[str] = None) -> dict[str, Any]:
    trip_id = existing_id or clean_scalar(payload.get("id")) or f"trip-{int(time.time() * 1000)}"
    members = payload.get("members", [])
    if not isinstance(members, list):
        members = []
    organizer = normalize_member_name(payload.get("organizer"))
    cleaned_members = []
    if organizer:
        cleaned_members.append(organizer)
    for member in members:
        member_name = normalize_member_name(member)
        if member_name and member_name not in cleaned_members:
            cleaned_members.append(member_name)
    trip_type = clean_scalar(payload.get("trip_type")).title()
    if trip_type not in {"Boat", "Shore", "Other"}:
        title_text = clean_scalar(payload.get("title")).casefold()
        if "boat" in title_text:
            trip_type = "Boat"
        elif "shore" in title_text:
            trip_type = "Shore"
        else:
            trip_type = "Other"
    title = re.sub(r"^\s*(?:boat|shore|other)\b[\s:.-]*", "", clean_scalar(payload.get("title")), flags=re.I).strip()
    title = "" if title.casefold() == "trip" else title
    title = f"{trip_type} {title}".strip()
    pattern = clean_scalar(payload.get("pattern"))
    if not re.fullmatch(r"r(?:-\d{1,3}){7}", pattern):
        pattern = _default_trip_pattern(trip_id)
    return {
        "id": trip_id,
        "date": clean_scalar(payload.get("date")),
        "title": title,
        "trip_type": trip_type,
        "organizer": organizer,
        "members": cleaned_members,
        "comment": clean_scalar(payload.get("comment")),
        "pattern": pattern,
        "archived": payload.get("archived") is True,
        "created_at": clean_scalar(payload.get("created_at")) or datetime.now(timezone.utc).isoformat(),
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
    current = status_snapshot()
    prefix = "Refresh issue" if current.get("ok") is False else "Purchase store"
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "sync_status_text": f"{prefix}: {current.get('rows') or 0} rows. {current.get('message') or ''}",
            "last_checked_text": f"Last checked: {display_sync_time(current.get('at'))}",
            "last_checked_at": current.get("at") or "",
            "last_checked_color": freshness_color(current.get("at")),
            "recent_categories": _recent_week_transactions(30),
        },
    )


@app.get("/trips", response_class=HTMLResponse)
def trips_page(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    return templates.TemplateResponse(request, "trips.html", {"archive_mode": False})


@app.get("/trips/archive", response_class=HTMLResponse)
def archived_trips_page(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    return templates.TemplateResponse(request, "trips.html", {"archive_mode": True})


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
    return status_snapshot()


@app.get("/api/names")
def names(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    return {"names": names_from_store()}


@app.get("/api/trips")
def trips(request: Request, archived: bool = False):
    redirect = require_login(request)
    if redirect:
        return redirect
    return {"trips": _trips_for_archive(archived)}


@app.get("/api/recent-transactions")
def recent_transactions(request: Request, days: int = 30):
    redirect = require_login(request)
    if redirect:
        return redirect
    payload = {
        "found": True,
        "name": "Everyone (Past month)",
        "contact": {"email": "", "phone": ""},
        "emergency": {
            "emergency_contact_name": "",
            "emergency_contact_relationship": "",
            "emergency_contact_phone": "",
            "emergency_contact_phone_2": "",
        },
        "membership_status": {"is_current": False, "label": "Membership"},
        "saved_member_data": {"comment": "", "membership_override": None},
        "member_profile": {
            "dive_certification": "",
            "diving_history": "",
            "membership_type": "",
            "certification_statuses": [],
            "role_statuses": [],
        },
        "liability_waiver_status": {"is_current": False, "label": "Liability Waiver"},
        "hire_status": None,
        "scope": "global_last_week",
        "days": max(1, days),
        "categories": _recent_week_transactions(days),
    }
    return payload


@app.post("/api/trips")
async def create_trip(request: Request):
    redirect = require_login(request)
    if redirect:
        return redirect
    payload = await request.json()
    trips = _load_trips()
    trip = _clean_trip_payload(payload if isinstance(payload, dict) else {})
    trips.insert(0, trip)
    _save_trips(trips)
    return trip


@app.put("/api/trips/{trip_id}")
async def update_trip(request: Request, trip_id: str):
    redirect = require_login(request)
    if redirect:
        return redirect
    payload = await request.json()
    trips = _load_trips()
    for index, trip in enumerate(trips):
        if clean_scalar(trip.get("id")) == trip_id:
            merged = dict(trip)
            if isinstance(payload, dict):
                merged.update(payload)
            trips[index] = _clean_trip_payload(merged, existing_id=trip_id)
            _save_trips(trips)
            return trips[index]
    return {"error": "Trip not found"}


@app.delete("/api/trips/{trip_id}")
def delete_trip(request: Request, trip_id: str):
    redirect = require_login(request)
    if redirect:
        return redirect
    trips = _load_trips()
    remaining = [trip for trip in trips if clean_scalar(trip.get("id")) != trip_id]
    _save_trips(remaining)
    return {"ok": True}


@app.get("/api/trip-member/{name}")
def trip_member(request: Request, name: str, trip_date: str = "", boat: bool = False):
    redirect = require_login(request)
    if redirect:
        return redirect
    return trip_member_summary(name, trip_date, boat)


@app.get("/api/member/{name}")
def member(request: Request, name: str):
    redirect = require_login(request)
    if redirect:
        return redirect
    return member_summary(name)


@app.put("/api/member/{name}/saved-data")
async def update_member_saved_data(request: Request, name: str):
    redirect = require_login(request)
    if redirect:
        return redirect
    payload = await request.json()
    return _update_member_saved_data(name, payload if isinstance(payload, dict) else {})
