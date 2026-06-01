from __future__ import annotations

import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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
TEAMAPP_URL = "https://muuc.teamapp.com/clubs/132307/store/purchases.json?_csv_data=v1"
SYNC_INTERVAL_SECONDS = 60 * 60

CATEGORIES = [
    ("Membership", ["membership"]),
    ("Merch", ["merch"]),
    ("Hire", ["hire"]),
    ("Car Fee", ["car fee"]),
    ("Air Fills/Tank Fills", ["air fill", "air fills", "tank fill", "tank fills", "nitrox"]),
    ("Boat Dive/Exclusive", ["boat dive", "exclusive"]),
    ("Course", ["course"]),
    ("Misc", ["misc"]),
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


def require_login(request: Request) -> RedirectResponse | None:
    if is_authenticated(request):
        return None
    return RedirectResponse(url="/login", status_code=303)


def clean_scalar(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    for column in DISPLAY_COLUMNS:
        if column not in df.columns:
            df[column] = ""

    df = df[DISPLAY_COLUMNS]
    for column in DISPLAY_COLUMNS:
        df[column] = df[column].map(clean_scalar)

    df["name_key"] = df["name"].str.casefold()
    df["_dedupe_key"] = df[DEDUPLICATION_COLUMNS].astype(str).agg("||".join, axis=1)
    return df


def load_store() -> pd.DataFrame:
    source = STORE_PATH if STORE_PATH.exists() else LEGACY_PURCHASES_PATH
    if not source.exists():
        return normalize_frame(pd.DataFrame())
    return normalize_frame(pd.read_csv(source, dtype=str, keep_default_na=False))


def save_store(df: pd.DataFrame) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    output = df.drop(columns=["name_key", "_dedupe_key"], errors="ignore")
    output.to_csv(STORE_PATH, index=False)


def deduplicate_purchases(df: pd.DataFrame, keep: str = "first") -> pd.DataFrame:
    if df.empty:
        return df
    return df.drop_duplicates(subset=["_dedupe_key"], keep=keep).reset_index(drop=True)


def purchase_date_range(df: pd.DataFrame | None = None) -> dict[str, str]:
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


def fetch_remote_purchases() -> pd.DataFrame:
    response = requests.get(TEAMAPP_URL, headers=build_headers(), timeout=30)
    response.raise_for_status()
    payload = response.json()
    return normalize_frame(pd.json_normalize(payload.get("data", [])))


def sync_purchases(force: bool = False) -> dict[str, Any]:
    del force
    with sync_lock:
        existing = deduplicate_purchases(load_store(), keep="first")
        try:
            fresh = fetch_remote_purchases()
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
    names = sorted({name for name in df["name"].dropna().map(clean_scalar) if name}, key=str.casefold)
    return names


def member_summary(name: str) -> dict[str, Any]:
    df = load_store()
    name_key = name.strip().casefold()
    matches = df[df["name_key"] == name_key].copy()
    if matches.empty:
        return {"found": False, "name": name, "emergency": {}, "categories": {}}

    latest = matches.iloc[0]
    emergency = {
        "emergency_contact_name": clean_scalar(latest.get("emergency_contact_name")),
        "emergency_contact_relationship": clean_scalar(latest.get("emergency_contact_relationship")),
        "emergency_contact_phone": clean_scalar(latest.get("emergency_contact_phone")),
        "emergency_contact_phone_2": clean_scalar(latest.get("emergency_contact_phone_2")),
    }

    grouped: dict[str, list[dict[str, str]]] = {category: [] for category, _ in CATEGORIES}
    for _, row in matches.iterrows():
        category = category_for_item(clean_scalar(row.get("items")))
        grouped.setdefault(category, []).append(
            {
                "date": clean_scalar(row.get("date")),
                "paid": clean_scalar(row.get("paid")),
                "total": clean_scalar(row.get("total")),
                "items": clean_scalar(row.get("items")),
            }
        )

    grouped = {category: rows for category, rows in grouped.items() if rows}
    return {
        "found": True,
        "name": clean_scalar(matches.iloc[0].get("name")) or name,
        "emergency": emergency,
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
