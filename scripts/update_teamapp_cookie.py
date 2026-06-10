#!/usr/bin/env python3
"""Refresh TEAMAPP_COOKIE in .env by logging in to TeamApp.

Intended for cron/systemd timers. Credentials are read from .env:

  TEAMAPP_USERNAME=...
  TEAMAPP_PASSWORD=...
  TEAMAPP_COOKIE=...

Optional:

  TEAMAPP_LOGIN_URL=https://www.teamapp.com/login

The script logs in, verifies the resulting session can read the MUUC purchases
JSON endpoint, then updates only TEAMAPP_COOKIE in the env file.
"""

from __future__ import annotations

import argparse
import os
import re
import stat
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = BASE_DIR / ".env"
DEFAULT_LOGIN_URL = "https://www.teamapp.com/login"
PURCHASES_URL = "https://muuc.teamapp.com/clubs/132307/store/purchases.json"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
)


class LoginFormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.forms: list[dict[str, Any]] = []
        self._current_form: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "form":
            self._current_form = {
                "action": attr_map.get("action", ""),
                "method": attr_map.get("method", "post").lower(),
                "inputs": [],
            }
            return

        if tag.lower() == "input" and self._current_form is not None:
            self._current_form["inputs"].append(attr_map)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "form" and self._current_form is not None:
            self.forms.append(self._current_form)
            self._current_form = None


def env_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def update_env_value(env_file: Path, key: str, value: str) -> None:
    original = env_file.read_text() if env_file.exists() else ""
    replacement = f"{key}={env_quote(value)}"
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)

    if pattern.search(original):
        updated = pattern.sub(replacement, original)
    else:
        separator = "" if not original or original.endswith("\n") else "\n"
        updated = f"{original}{separator}{replacement}\n"

    temp_file = env_file.with_suffix(env_file.suffix + ".tmp")
    temp_file.write_text(updated)
    if env_file.exists():
        temp_file.chmod(stat.S_IMODE(env_file.stat().st_mode))
    else:
        temp_file.chmod(0o600)
    temp_file.replace(env_file)


def choose_login_form(html: str) -> dict[str, Any]:
    parser = LoginFormParser()
    parser.feed(html)

    for form in parser.forms:
        inputs = form.get("inputs", [])
        has_password = any(input_data.get("type", "").lower() == "password" for input_data in inputs)
        has_identity = any(
            re.search(r"email|login|user|username", input_data.get("name", ""), re.IGNORECASE)
            for input_data in inputs
        )
        if has_password and has_identity:
            return form

    for form in parser.forms:
        if any(input_data.get("type", "").lower() == "password" for input_data in form.get("inputs", [])):
            return form

    raise RuntimeError("Could not find a login form in the TeamApp login page")


def build_login_payload(form: dict[str, Any], username: str, password: str) -> dict[str, str]:
    payload: dict[str, str] = {}
    username_field = ""
    password_field = ""

    for input_data in form.get("inputs", []):
        name = input_data.get("name", "")
        if not name:
            continue

        input_type = input_data.get("type", "text").lower()
        payload[name] = input_data.get("value", "")

        if input_type == "password":
            password_field = name
        elif not username_field and re.search(r"email|login|user|username", name, re.IGNORECASE):
            username_field = name

    if not password_field:
        raise RuntimeError("Could not identify the TeamApp password field")
    if not username_field:
        username_field = "email"

    payload[username_field] = username
    payload[password_field] = password
    return payload


def cookie_header(session: requests.Session) -> str:
    cookies = [f"{cookie.name}={cookie.value}" for cookie in session.cookies]
    if not cookies:
        raise RuntimeError("TeamApp login did not return any cookies")
    return "; ".join(cookies)


def verify_cookie(session: requests.Session) -> None:
    response = session.get(
        PURCHASES_URL,
        params={"_csv_data": "v1", "page": 1},
        headers={"Accept": "application/json,text/html;q=0.9,*/*;q=0.8"},
        timeout=30,
    )
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError("TeamApp purchases endpoint did not return JSON after login") from exc

    if not isinstance(payload, dict) or "data" not in payload:
        raise RuntimeError("TeamApp purchases endpoint returned an unexpected response after login")


def refresh_cookie(env_file: Path, login_url: str) -> str:
    load_dotenv(env_file, override=True)
    username = os.getenv("TEAMAPP_USERNAME", "").strip()
    password = os.getenv("TEAMAPP_PASSWORD", "").strip()

    if not username:
        raise RuntimeError("TEAMAPP_USERNAME is not set in .env")
    if not password:
        raise RuntimeError("TEAMAPP_PASSWORD is not set in .env")

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": urljoin(login_url, "/").rstrip("/"),
            "Referer": login_url,
        }
    )

    login_page = session.get(login_url, timeout=30)
    login_page.raise_for_status()

    form = choose_login_form(login_page.text)
    action = form.get("action") or login_url
    login_action = urljoin(login_page.url, action)
    payload = build_login_payload(form, username, password)

    method = str(form.get("method") or "post").lower()
    if method == "get":
        login_response = session.get(login_action, params=payload, timeout=30)
    else:
        login_response = session.post(login_action, data=payload, timeout=30, allow_redirects=True)
    login_response.raise_for_status()

    verify_cookie(session)
    cookie = cookie_header(session)
    update_env_value(env_file, "TEAMAPP_COOKIE", cookie)
    return cookie


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh TEAMAPP_COOKIE in .env")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to .env file")
    parser.add_argument(
        "--login-url",
        default=os.getenv("TEAMAPP_LOGIN_URL", DEFAULT_LOGIN_URL),
        help="TeamApp login URL",
    )
    parser.add_argument("--print-cookie", action="store_true", help="Print the refreshed cookie value")
    args = parser.parse_args()

    env_file = Path(args.env_file).expanduser().resolve()
    try:
        cookie = refresh_cookie(env_file, args.login_url)
    except Exception as exc:
        print(f"Failed to refresh TEAMAPP_COOKIE: {exc}", file=sys.stderr)
        return 1

    print(f"Updated TEAMAPP_COOKIE in {env_file}")
    if args.print_cookie:
        print(cookie)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
