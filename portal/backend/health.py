"""Server-side monitoring of systems and SSO components.

Checks go directly to internal addresses inside services-network, bypassing SSO:
through Nginx every protected page answers 302 to the login page, so a stopped
service would look healthy. A redirect to the login page is never counted as "works".
"""

from __future__ import annotations

import asyncio
import os
import ssl
import time
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

import store

DOMAIN = os.environ.get("PORTAL_DOMAIN", "rep.local.inion")
PROBE_BASE = os.environ.get("PORTAL_PROBE_BASE", f"https://{DOMAIN}")
CA_FILE = os.environ.get("PORTAL_CA_FILE", "/etc/portal/ca.crt")
POLL_INTERVAL = int(os.environ.get("PORTAL_POLL_INTERVAL", "30"))
CACHE_TTL = int(os.environ.get("PORTAL_STATUS_CACHE_TTL", "20"))
TIMEOUT = float(os.environ.get("PORTAL_PROBE_TIMEOUT", "5"))
SLOW_MS = int(os.environ.get("PORTAL_SLOW_MS", "1500"))
HISTORY = 40

# Infrastructure behind the portal (shown on the monitoring page)
COMPONENTS = [
    {"id": "gateway", "name": "Шлюз Nginx", "url": f"{PROBE_BASE}/health"},
    {"id": "portal", "name": "Портал (API)", "url": "http://127.0.0.1:3000/api/health"},
    {"id": "keycloak", "name": "Keycloak (SSO)", "url": "http://keycloak:9000/auth/health/ready"},
    {"id": "oauth2-proxy", "name": "oauth2-proxy", "url": "http://oauth2-proxy:4180/ping"},
]

# Built-in containers expect the public host name and HTTPS from the proxy
INTERNAL_HEADERS = {
    "netbox": {"Host": DOMAIN, "X-Forwarded-Proto": "https"},
    "mediawiki": {"Host": DOMAIN, "X-Forwarded-Proto": "https"},
}

LOGIN_MARKERS = ("/oauth2/start", "/oauth2/sign_in", "/auth/realms/", "/login", "signin", "sign_in")


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if os.path.exists(CA_FILE):
        ctx.load_verify_locations(CA_FILE)  # self-signed certificate of the host Nginx
    return ctx


_ctx = _ssl_context()


def _iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def target_for(system: dict) -> str:
    url = system.get("internalHealthUrl") or system.get("healthUrl") or system.get("url") or "/"
    return PROBE_BASE.rstrip("/") + url if url.startswith("/") else url


async def probe(url: str) -> dict:
    started = time.perf_counter()
    ts = int(time.time() * 1000)
    host = urlsplit(url).hostname or ""
    headers = INTERNAL_HEADERS.get(host, {})
    try:
        async with httpx.AsyncClient(verify=_ctx, follow_redirects=False, timeout=TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return {"ts": ts, "status": "offline", "ok": False, "latencyMs": None, "httpCode": None,
                "detail": "Превышено время ожидания"}
    except Exception as exc:  # noqa: BLE001
        return {"ts": ts, "status": "offline", "ok": False, "latencyMs": None, "httpCode": None,
                "detail": f"Нет соединения: {type(exc).__name__}"}
    latency = round((time.perf_counter() - started) * 1000)
    code = resp.status_code
    sample = {"ts": ts, "latencyMs": latency, "httpCode": code, "detail": f"HTTP {code}"}
    if code >= 500:
        return {**sample, "status": "offline", "ok": False}
    if 300 <= code < 400:
        location = resp.headers.get("location", "")
        if any(m in location.lower() for m in LOGIN_MARKERS):
            # Behind SSO: we cannot tell whether the service itself works
            return {**sample, "status": "unknown", "ok": None,
                    "detail": "Закрыто единым входом — укажите внутренний адрес проверки"}
    status = "degraded" if latency > SLOW_MS else "online"
    return {**sample, "status": status, "ok": True}


class Monitor:
    def __init__(self) -> None:
        self.history: dict[str, deque] = {}
        self.last: dict[str, dict] = {}
        self.last_run = 0.0
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    def _record(self, key: str, sample: dict) -> dict | None:
        """Store a sample, return (previous, new) status change for online<->offline."""
        prev = self.last.get(key)
        self.last[key] = sample
        self.history.setdefault(key, deque(maxlen=HISTORY)).append(
            {"ts": sample["ts"], "ok": sample["ok"], "latency": sample["latencyMs"], "code": sample["httpCode"],
             "error": None if sample["ok"] else sample["detail"]}
        )
        if prev and prev["status"] != sample["status"] and {prev["status"], sample["status"]} <= {
            "online", "degraded", "offline"
        } and "offline" in (prev["status"], sample["status"]):
            return prev
        return None

    async def run(self, only: list[dict] | None = None) -> None:
        async with self._lock:
            systems = store.load() if only is None else only
            jobs = [("sys:" + s["id"], target_for(s), s) for s in systems]
            if only is None:
                jobs += [("cmp:" + c["id"], c["url"], c) for c in COMPONENTS]
            results = await asyncio.gather(*(probe(url) for _, url, _ in jobs))
            for (key, _, obj), sample in zip(jobs, results):
                prev = self._record(key, sample)
                if prev and key.startswith("sys:"):
                    store.audit("system", "Мониторинг", "status", obj["name"], obj["id"],
                                f"{prev['status']} → {sample['status']} ({sample['detail']})")
            if only is None:
                live = {"sys:" + s["id"] for s in systems} | {"cmp:" + c["id"] for c in COMPONENTS}
                for key in list(self.history):
                    if key not in live:
                        self.history.pop(key, None)
                        self.last.pop(key, None)
                self.last_run = time.time()

    async def ensure_fresh(self, force: bool = False) -> None:
        age = time.time() - self.last_run
        if force and age < 5:
            return  # "check now" is rate limited
        if force or age > CACHE_TTL:
            await self.run()

    def snapshot(self, systems: list[dict]) -> dict:
        def entry(key: str) -> dict:
            last = self.last.get(key)
            return {
                "status": last["status"] if last else "unknown",
                "latencyMs": last["latencyMs"] if last else None,
                "httpCode": last["httpCode"] if last else None,
                "detail": last["detail"] if last else "Ещё не проверялась",
                "checkedAt": _iso(last["ts"]) if last else None,
                "history": list(self.history.get(key, [])),
            }

        return {
            "checkedAt": _iso(int(self.last_run * 1000)) if self.last_run else None,
            "pollIntervalSec": POLL_INTERVAL,
            "slowThresholdMs": SLOW_MS,
            "systems": {s["id"]: entry("sys:" + s["id"]) for s in systems},
            "components": [{"id": c["id"], "name": c["name"], **entry("cmp:" + c["id"])} for c in COMPONENTS],
        }

    def check_soon(self, system: dict) -> None:
        asyncio.get_running_loop().create_task(self.run(only=[system]))

    async def _loop(self) -> None:
        while True:
            try:
                await self.run()
            except Exception as exc:  # noqa: BLE001
                print(f"[monitor] check failed: {exc!r}", flush=True)
            await asyncio.sleep(POLL_INTERVAL)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


monitor = Monitor()
