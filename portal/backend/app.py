"""Corporate portal API + static SPA host."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DATA_DIR = Path(os.environ.get("PORTAL_DATA_DIR", "/data"))
DATA_FILE = DATA_DIR / "systems.json"
STATIC_DIR = Path(os.environ.get("PORTAL_STATIC_DIR", "/app/static"))

DEFAULT_SYSTEMS = [
    {
        "id": "portal",
        "name": "Портал",
        "description": "Единая точка входа в корпоративные системы",
        "url": "/",
        "icon": "grid",
        "category": "core",
        "healthUrl": "/api/health",
        "builtin": True,
    },
    {
        "id": "netbox",
        "name": "NetBox",
        "description": "DCIM / IPAM — учёт сетевой инфраструктуры",
        "url": "/netbox/",
        "icon": "network",
        "category": "infra",
        "healthUrl": "/netbox/login/",
        "builtin": True,
    },
    {
        "id": "wiki",
        "name": "MediaWiki",
        "description": "Корпоративная база знаний",
        "url": "/wiki/",
        "icon": "book",
        "category": "docs",
        "healthUrl": "/wiki/index.php",
        "builtin": True,
    },
]


class SystemIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=400)
    url: str = Field(min_length=1, max_length=500)
    icon: str = Field(default="link", max_length=40)
    category: str = Field(default="custom", max_length=40)
    healthUrl: str | None = Field(default=None, max_length=500)


class System(SystemIn):
    id: str
    builtin: bool = False


StatusLiteral = Literal["online", "offline", "unknown"]


app = FastAPI(title="REP Portal API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_data() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text(
            json.dumps(DEFAULT_SYSTEMS, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _load() -> list[dict]:
    _ensure_data()
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def _save(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DATA_FILE)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "portal",
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/systems", response_model=list[System])
async def list_systems() -> list[dict]:
    return _load()


@app.post("/api/systems", response_model=System, status_code=201)
async def create_system(payload: SystemIn) -> dict:
    items = _load()
    item = payload.model_dump()
    item["id"] = str(uuid.uuid4())
    item["builtin"] = False
    if not item.get("healthUrl"):
        item["healthUrl"] = item["url"]
    items.append(item)
    _save(items)
    return item


@app.delete("/api/systems/{system_id}", status_code=204, response_class=Response)
async def delete_system(system_id: str) -> Response:
    items = _load()
    target = next((x for x in items if x["id"] == system_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="System not found")
    # Built-in cards may be removed too; restore them via /api/systems/restore-defaults
    _save([x for x in items if x["id"] != system_id])
    return Response(status_code=204)


@app.post("/api/systems/restore-defaults", response_model=list[System])
async def restore_defaults() -> list[dict]:
    """Re-add built-in systems that were deleted; custom ones are kept."""
    items = _load()
    by_id = {x["id"]: x for x in items}
    default_ids = {x["id"] for x in DEFAULT_SYSTEMS}
    # Built-ins first in their default order, then custom systems as they were
    restored = [by_id.get(x["id"], dict(x)) for x in DEFAULT_SYSTEMS]
    restored += [x for x in items if x["id"] not in default_ids]
    if restored != items:
        _save(restored)
    return restored


@app.get("/api/systems/{system_id}/status")
async def system_status(system_id: str) -> dict:
    items = _load()
    target = next((x for x in items if x["id"] == system_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="System not found")

    health_url = target.get("healthUrl") or target.get("url") or "/"
    # Relative URLs are probed via host gateway (docker host nginx / services)
    base = os.environ.get("PORTAL_PROBE_BASE", "https://rep.local.inion")
    if health_url.startswith("/"):
        probe = base.rstrip("/") + health_url
    else:
        probe = health_url

    status: StatusLiteral = "unknown"
    detail = ""
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=5.0) as client:
            resp = await client.get(probe)
            status = "online" if resp.status_code < 500 else "offline"
            detail = f"HTTP {resp.status_code}"
    except Exception as exc:  # noqa: BLE001
        status = "offline"
        detail = str(exc)

    return {
        "id": system_id,
        "status": status,
        "detail": detail,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/status")
async def all_status() -> list[dict]:
    items = _load()
    results = []
    for item in items:
        results.append(await system_status(item["id"]))
    return results


# SPA fallback — must be registered after API routes
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str = "") -> FileResponse:
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = STATIC_DIR / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404, detail="SPA not built")
        return FileResponse(index)
