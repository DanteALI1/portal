"""Corporate portal API + static SPA host.

Identity comes from Nginx (SSO via oauth2-proxy), see auth.py. Reading requires any
portal group, changing the catalog requires SSO_GROUP_PORTAL_ADMINS.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import store
from auth import User, current_user, require_admin
from health import monitor
from store import SystemIn

STATIC_DIR = Path(os.environ.get("PORTAL_STATIC_DIR", "/app/static"))
VERSION = "2.0.0"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.load()  # creates defaults / migrates old records
    monitor.start()
    yield
    await monitor.stop()


app = FastAPI(title="REP Portal API", version=VERSION, lifespan=lifespan, docs_url=None, redoc_url=None)


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc: RequestValidationError) -> JSONResponse:
    # Field errors in a shape the UI can show next to inputs
    fields = {}
    for err in exc.errors():
        loc = [str(x) for x in err.get("loc", []) if x != "body"]
        fields[".".join(loc) or "body"] = str(err.get("msg", "")).removeprefix("Value error, ")
    return JSONResponse(status_code=422, content={"detail": "Проверьте поля формы", "fields": fields})


def _conflict(errors: dict[str, str]) -> None:
    if errors:
        raise HTTPException(status_code=409, detail={"detail": "Такая система уже есть", "fields": errors})


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "portal", "version": VERSION,
            "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/me")
async def me(user: User = Depends(current_user)) -> dict:
    return user.public()


@app.get("/api/systems")
async def list_systems(_user: User = Depends(current_user)) -> list[dict]:
    return store.load()


@app.post("/api/systems", status_code=201)
async def create_system(payload: SystemIn, user: User = Depends(require_admin)) -> dict:
    items = store.load()
    stamp = store.now_iso()
    data = payload.model_dump()
    restoring = bool(data.get("id"))  # undo of a deletion keeps the original id
    if restoring and any(s["id"] == data["id"] for s in items):
        raise HTTPException(status_code=409, detail={"detail": "Система с таким id уже есть", "fields": {}})
    item = store.normalize({
        **data,
        "id": data.get("id") or None,
        "builtin": data.get("builtin", False) if restoring else False,
        "createdAt": data.get("createdAt") if restoring else stamp,
        "updatedAt": stamp,
    })
    _conflict(store.conflicts(item, items, None))
    items.append(item)
    store.save(items)
    if restoring:
        store.audit(user.username, user.name, "restore", item["name"], item["id"], "Удаление отменено")
    else:
        details = f"Адрес {item['url']}" + (f", категория «{item['category']}»" if item["category"] else "")
        store.audit(user.username, user.name, "create", item["name"], item["id"], details)
    monitor.check_soon(item)
    return item


@app.put("/api/systems/{system_id}")
async def update_system(system_id: str, payload: SystemIn, user: User = Depends(require_admin)) -> dict:
    items = store.load()
    idx = next((i for i, s in enumerate(items) if s["id"] == system_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Система не найдена")
    before = items[idx]
    data = payload.model_dump(exclude={"id", "createdAt", "builtin"})
    after = store.normalize({**before, **data, "id": system_id, "createdAt": before["createdAt"],
                             "builtin": before["builtin"], "updatedAt": store.now_iso()})
    _conflict(store.conflicts(after, items, system_id))
    items[idx] = after
    store.save(items)
    changed = store.changed_fields(before, after)
    if changed:
        store.audit(user.username, user.name, "update", after["name"], system_id,
                    "Изменено: " + ", ".join(changed), changed)
        monitor.check_soon(after)
    return after


@app.delete("/api/systems/{system_id}", status_code=204, response_class=Response)
async def delete_system(system_id: str, user: User = Depends(require_admin)) -> Response:
    items = store.load()
    target = next((x for x in items if x["id"] == system_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Система не найдена")
    store.save([x for x in items if x["id"] != system_id])
    store.audit(user.username, user.name, "delete", target["name"], system_id, f"Адрес {target['url']}")
    return Response(status_code=204)


@app.put("/api/systems")
async def replace_systems(
    payload: list[SystemIn],
    action: str = Query(default="import", pattern="^(import|reset)$"),
    source: str = Query(default="", max_length=120),
    user: User = Depends(require_admin),
) -> list[dict]:
    """Replace the whole catalog (import from JSON or reset)."""
    stamp = store.now_iso()
    if action == "reset":
        # Reset always returns the server-side built-ins (with their internal health URLs)
        items = store.defaults()
        store.save(items)
        store.audit(user.username, user.name, "reset", "Каталог", "", "Восстановлен исходный состав")
        await monitor.run()
        return items
    items: list[dict] = []
    for p in payload:
        item = store.normalize({**p.model_dump(), "createdAt": p.createdAt or stamp, "updatedAt": stamp})
        errors = store.conflicts(item, items, None)
        if errors:
            raise HTTPException(status_code=409, detail={
                "detail": f"Повторяется система «{item['name']}»", "fields": errors})
        items.append(item)
    store.save(items)
    store.audit(user.username, user.name, "import", source or "Каталог", "", f"Загружено систем: {len(items)}")
    await monitor.run()
    return items


@app.post("/api/systems/restore-defaults")
async def restore_defaults(user: User = Depends(require_admin)) -> list[dict]:
    """Re-add built-in systems that were deleted; custom ones are kept."""
    items = store.load()
    # A built-in counts as present by id or by route (old records used other ids, e.g. "wiki")
    present = {x["id"] for x in items} | {x["url"] for x in items}
    missing = [d for d in store.defaults() if d["id"] not in present and d["url"] not in present]
    if missing:
        items = missing + items
        store.save(items)
        store.audit(user.username, user.name, "restore", "Каталог", "",
                    "Возвращены: " + ", ".join(d["name"] for d in missing))
    return items


@app.get("/api/audit")
async def audit(limit: int = Query(default=300, ge=1, le=1000), _user: User = Depends(require_admin)) -> list[dict]:
    return store.read_audit(limit)


@app.get("/api/status")
async def status(_user: User = Depends(current_user)) -> dict:
    await monitor.ensure_fresh()
    return monitor.snapshot(store.load())


@app.post("/api/status/refresh")
async def status_refresh(_user: User = Depends(current_user)) -> dict:
    await monitor.ensure_fresh(force=True)
    return monitor.snapshot(store.load())


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def api_not_found(rest: str) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"Нет такого метода API: /api/{rest}"})


# --- SPA (registered after the API routes) ---
NO_CACHE = {"Cache-Control": "no-cache"}

if (STATIC_DIR / "assets").is_dir():
    class ImmutableStatic(StaticFiles):
        async def get_response(self, path, scope):  # type: ignore[override]
            resp = await super().get_response(path, scope)
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    app.mount("/assets", ImmutableStatic(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str = "") -> FileResponse:
    candidate = (STATIC_DIR / full_path).resolve()
    if full_path and candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
        headers = NO_CACHE if candidate.name == "config.js" else {}
        return FileResponse(candidate, headers=headers)
    index = STATIC_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="SPA not built")
    return FileResponse(index, headers=NO_CACHE)
