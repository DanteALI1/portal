"""Catalog of systems (/data/systems.json) and the audit log (/data/audit.jsonl)."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

DATA_DIR = Path(os.environ.get("PORTAL_DATA_DIR", "/data"))
SYSTEMS_FILE = DATA_DIR / "systems.json"
AUDIT_FILE = DATA_DIR / "audit.jsonl"
AUDIT_MAX = int(os.environ.get("PORTAL_AUDIT_MAX", "1000"))

URL_RE = re.compile(r"^(/\S*|https?://\S+)$", re.IGNORECASE)

ICONS = {
    "network", "book", "server", "database", "shield", "monitor", "chart", "cloud", "mail", "git",
    "terminal", "globe", "box", "layers", "users", "calendar", "folder", "key", "cpu", "lock",
    "dashboard", "grid",
}
ACCENTS = {"blue", "teal", "green", "amber", "rose", "violet", "slate", "sky"}

# Legacy values from the first portal version
LEGACY_ICONS = {"link": "globe", "book": "book", "network": "network", "grid": "dashboard"}
LEGACY_CATEGORIES = {"core": "Портал", "infra": "Инфраструктура", "docs": "Документация", "custom": ""}

# Built-in systems. internalHealthUrl is probed directly inside services-network,
# bypassing SSO (through Nginx every page answers with a redirect to the login).
DEFAULT_SYSTEMS = [
    {
        "id": "netbox",
        "name": "NetBox",
        "description": "Учёт сетевой инфраструктуры: стойки, устройства, кабельные соединения, "
        "IP-адресное пространство и VLAN.",
        "url": "/netbox/",
        "icon": "network",
        "accent": "blue",
        "category": "Инфраструктура",
        "tags": ["DCIM", "IPAM"],
        "owner": "Отдел сетевой инфраструктуры",
        "healthUrl": "",
        "internalHealthUrl": "http://netbox:8080/netbox/login/",
        "newTab": False,
        "pinned": True,
        "builtin": True,
    },
    {
        "id": "mediawiki",
        "name": "Корпоративная Вики",
        "description": "База знаний на MediaWiki: регламенты, инструкции, описания сервисов "
        "и технические статьи.",
        "url": "/wiki/",
        "icon": "book",
        "accent": "teal",
        "category": "Документация",
        "tags": ["MediaWiki", "База знаний"],
        "owner": "Служба поддержки",
        "healthUrl": "",
        "internalHealthUrl": "http://mediawiki/api.php?action=query&meta=siteinfo&format=json",
        "newTab": False,
        "pinned": True,
        "builtin": True,
    },
]

# Internal health URLs for built-in routes, used when migrating old records
BUILTIN_INTERNAL = {
    "/netbox/": "http://netbox:8080/netbox/login/",
    "/wiki/": "http://mediawiki/api.php?action=query&meta=siteinfo&format=json",
    "/": "http://127.0.0.1:3000/api/health",
}

EDITABLE_FIELDS = [
    "name", "url", "description", "category", "owner", "icon", "accent", "tags",
    "healthUrl", "internalHealthUrl", "newTab", "pinned",
]

_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SystemIn(BaseModel):
    """Payload for create/update. id/createdAt are accepted to undo a deletion."""

    id: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=60)
    url: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=240)
    category: str = Field(default="", max_length=60)
    owner: str = Field(default="", max_length=80)
    icon: str = Field(default="server", max_length=40)
    accent: str = Field(default="blue", max_length=20)
    tags: list[str] = Field(default_factory=list, max_length=8)
    healthUrl: str = Field(default="", max_length=500)
    internalHealthUrl: str = Field(default="", max_length=500)
    newTab: bool = False
    pinned: bool = False
    builtin: bool = False
    createdAt: str | None = None

    @field_validator("name", "url", "description", "category", "owner", "healthUrl", "internalHealthUrl")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v:
            raise ValueError("Укажите название системы")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        if not URL_RE.match(v):
            raise ValueError("Маршрут начинается с «/», адрес — с http:// или https://")
        return v

    @field_validator("healthUrl", "internalHealthUrl")
    @classmethod
    def _health(cls, v: str) -> str:
        if v and not URL_RE.match(v):
            raise ValueError("Маршрут начинается с «/», адрес — с http:// или https://")
        return v

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for t in v:
            t = str(t).strip()[:32]
            if t and t not in out:
                out.append(t)
        return out

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str) -> str:
        return v if v in ICONS else "server"

    @field_validator("accent")
    @classmethod
    def _accent(cls, v: str) -> str:
        return v if v in ACCENTS else "blue"


def normalize(raw: dict) -> dict:
    """Bring a stored record (possibly from the first portal version) to the current model."""
    stamp = raw.get("createdAt") or now_iso()
    icon = raw.get("icon") or "server"
    icon = icon if icon in ICONS else LEGACY_ICONS.get(icon, "server")
    category = raw.get("category") or ""
    category = LEGACY_CATEGORIES.get(category, category)
    url = raw.get("url") or "/"
    internal = raw.get("internalHealthUrl") or (BUILTIN_INTERNAL.get(url, "") if raw.get("builtin") else "")
    health = raw.get("healthUrl") or ""
    if raw.get("builtin") and health == url:
        health = ""
    return {
        "id": str(raw.get("id") or uuid.uuid4()),
        "name": raw.get("name") or "Без названия",
        "description": raw.get("description") or "",
        "url": url,
        "icon": icon,
        "accent": raw.get("accent") if raw.get("accent") in ACCENTS else "blue",
        "category": category,
        "tags": list(raw.get("tags") or []),
        "owner": raw.get("owner") or "",
        "healthUrl": health,
        "internalHealthUrl": internal,
        "newTab": bool(raw.get("newTab", False)),
        "pinned": bool(raw.get("pinned", False)),
        "builtin": bool(raw.get("builtin", False)),
        "createdAt": stamp,
        "updatedAt": raw.get("updatedAt") or stamp,
    }


def defaults() -> list[dict]:
    stamp = now_iso()
    return [normalize({**d, "createdAt": stamp, "updatedAt": stamp}) for d in DEFAULT_SYSTEMS]


def load() -> list[dict]:
    with _lock:
        if not SYSTEMS_FILE.exists():
            items = defaults()
            _write(items)
            return items
        raw = json.loads(SYSTEMS_FILE.read_text(encoding="utf-8"))
        items = [normalize(x) for x in raw if isinstance(x, dict)]
        if items != raw:
            _write(items)  # one-time migration of old records
        return items


def save(items: list[dict]) -> None:
    with _lock:
        _write(items)


def _write(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SYSTEMS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(SYSTEMS_FILE)


def conflicts(item: dict, items: list[dict], exclude_id: str | None) -> dict[str, str]:
    """Uniqueness of name (case-insensitive) and url."""
    errors: dict[str, str] = {}
    for s in items:
        if s["id"] == exclude_id:
            continue
        if s["name"].strip().lower() == item["name"].strip().lower():
            errors["name"] = "Система с таким названием уже есть"
        if s["url"] == item["url"]:
            errors["url"] = "Этот адрес уже используется другой системой"
    return errors


def changed_fields(before: dict, after: dict) -> list[str]:
    return [k for k in EDITABLE_FIELDS if before.get(k) != after.get(k)]


# --- Audit log ---

def audit(user: str, user_name: str, action: str, target: str, target_id: str = "",
          details: str = "", changes: list[str] | None = None) -> dict:
    entry = {
        "id": uuid.uuid4().hex[:12],
        "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
        "user": user,
        "userName": user_name,
        "action": action,
        "target": target,
        "targetId": target_id,
        "details": details,
        "changes": changes or [],
    }
    with _lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with AUDIT_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        _trim_audit()
    return entry


def _trim_audit() -> None:
    # Keep the file bounded: rewrite when it grows 20% over the limit
    try:
        lines = AUDIT_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    if len(lines) > AUDIT_MAX * 1.2:
        tmp = AUDIT_FILE.with_suffix(".tmp")
        tmp.write_text("\n".join(lines[-AUDIT_MAX:]) + "\n", encoding="utf-8")
        tmp.replace(AUDIT_FILE)


def read_audit(limit: int = 300) -> list[dict]:
    try:
        lines = AUDIT_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    out = []
    for line in reversed(lines[-AUDIT_MAX:]):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(out) >= limit:
            break
    return out
