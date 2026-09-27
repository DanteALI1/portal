"""API-level checks of single sign-on for rep.local.inion (scenarios from docs/CLAUDE-TASK-SSO.md, stage 8)."""

from __future__ import annotations

import os
import time
import uuid

import httpx
import pytest

from conftest import BASE, client, env, login_form_action, sso_login

LOGIN = "/oauth2/start"
KC_AUTH = "/auth/realms/inion/protocol/openid-connect/auth"


def to_login(r: httpx.Response) -> bool:
    """No session: Nginx passes the request to oauth2-proxy, which answers 302 to Keycloak."""
    return r.status_code == 302 and f"{BASE}{KC_AUTH}?" in r.headers.get("location", "")


# --- 1. Anonymous access goes to the Keycloak login page ---
@pytest.mark.parametrize("path", ["/", "/netbox/", "/wiki/", "/wiki/index.php?title=Заглавная_страница"])
def test_1_anonymous_redirects_to_keycloak(anon, path):
    r = anon.get(path)
    assert to_login(r), (path, r.status_code, r.headers.get("location"))
    r = client(follow_redirects=True).get(path)
    assert KC_AUTH in str(r.url) and login_form_action(r.text), f"{path} did not end on the Keycloak login form: {r.url}"


def test_1_api_without_session_is_401_json(anon):
    r = anon.get("/api/me")
    assert r.status_code == 401 and r.json()["login"] == LOGIN


# --- 2. One login -> portal, NetBox and wiki as the same user ---
def test_2_single_sign_on_everywhere(user):
    me = user.get("/api/me").json()
    assert me["username"] == env("USER_USER") and me["isAdmin"] is False
    assert user.get("/").status_code == 200

    nb = user.get("/netbox/")
    assert nb.status_code == 200 and KC_AUTH not in str(nb.url), nb.url
    assert env("USER_USER") in nb.text, "NetBox page does not show the SSO user"

    wiki = user.get("/wiki/api.php", params={"action": "query", "meta": "userinfo", "format": "json"}).json()
    info = wiki["query"]["userinfo"]
    assert "anon" not in info, "wiki sees an anonymous user"
    assert info["name"].lower() == env("USER_USER").lower()  # MediaWiki capitalises the first letter


# --- 3. Regular user: read-only ---
def test_3_user_cannot_change_catalog(user):
    r = user.post("/api/systems", json={"name": f"t-{uuid.uuid4().hex[:6]}", "url": "/forbidden/"})
    assert r.status_code == 403
    assert user.get("/api/audit").status_code == 403
    items = user.get("/api/systems").json()
    assert user.delete(f"/api/systems/{items[0]['id']}").status_code == 403


def test_3_user_is_read_only_in_netbox(user):
    assert user.get("/netbox/dcim/sites/").status_code == 200
    r = user.get("/netbox/dcim/sites/add/")
    assert r.status_code == 403, f"user.portal can open 'add site' in NetBox ({r.status_code})"


# --- 4. Admin: CRUD, undo, audit with author, NetBox superuser, wiki sysop ---
def test_4_admin_crud_undo_and_audit(admin):
    name = f"Autotest {uuid.uuid4().hex[:6]}"
    r = admin.post("/api/systems", json={"name": name, "url": f"/autotest-{uuid.uuid4().hex[:6]}/", "tags": ["test"]})
    assert r.status_code == 201, r.text
    item = r.json()
    r = admin.put(f"/api/systems/{item['id']}", json={**item, "description": "изменено тестом"})
    assert r.status_code == 200 and r.json()["description"] == "изменено тестом"
    assert admin.delete(f"/api/systems/{item['id']}").status_code == 204
    r = admin.post("/api/systems", json=item)  # undo keeps the id
    assert r.status_code == 201 and r.json()["id"] == item["id"]
    assert admin.delete(f"/api/systems/{item['id']}").status_code == 204

    audit = [e for e in admin.get("/api/audit").json() if e.get("targetId") == item["id"]]
    assert [e["action"] for e in audit][:5] == ["delete", "restore", "delete", "update", "create"], audit
    assert {e["user"] for e in audit} == {env("ADMIN_USER")}


def test_4_admin_is_superuser_in_netbox_and_sysop_in_wiki(admin):
    assert admin.get("/netbox/dcim/sites/add/").status_code == 200
    wiki = admin.get("/wiki/api.php", params={"action": "query", "meta": "userinfo", "uiprop": "groups", "format": "json"}).json()
    assert "sysop" in wiki["query"]["userinfo"]["groups"]


# --- 5. Logout from the portal ends the session everywhere ---
def test_5_single_logout():
    c = sso_login(env("USER_USER"), env("USER_PASS"))
    assert c.get("/netbox/").status_code == 200
    c.get("/oauth2/sign_out", params={"rd": "/"})
    c.follow_redirects = False
    for path in ("/", "/netbox/", "/wiki/"):
        r = c.get(path)
        assert to_login(r), (path, r.status_code, r.headers.get("location"))
    # The Keycloak session is gone too: the login form is shown again, no silent re-login
    c.follow_redirects = True
    r = c.get("/")
    assert login_form_action(r.text), f"Keycloak session survived logout: {r.url}"


# --- 6. Forged identity headers never authenticate ---
FORGED = {"X-Remote-User": "admin", "X-Remote-Groups": "portal-admins,netbox-admins", "X-Remote-Email": "a@b"}


@pytest.mark.parametrize("path", ["/", "/wiki/", "/netbox/"])
def test_6_forged_headers_on_protected_pages(anon, path):
    r = anon.get(path, headers=FORGED)
    assert to_login(r), (path, r.status_code)


def test_6_forged_headers_on_unprotected_locations(anon):
    r = anon.get("/netbox/api/users/users/", headers=FORGED)
    assert r.status_code == 403, f"NetBox API trusted a forged X-Remote-User ({r.status_code})"
    assert anon.get("/api/me", headers=FORGED).status_code == 401


def test_6_forged_headers_cannot_elevate_a_logged_in_user(user):
    r = user.get("/api/me", headers=FORGED).json()
    assert r["username"] == env("USER_USER") and r["isAdmin"] is False
    assert user.post("/api/systems", headers=FORGED, json={"name": "x", "url": "/x-forged/"}).status_code == 403


# --- 7. Token API and health checks work without SSO ---
def test_7_netbox_api_with_token(anon):
    r = anon.get("/netbox/api/status/", headers={"Authorization": f"Token {env('NETBOX_TOKEN')}", "Accept": "application/json"})
    assert r.status_code == 200 and "netbox-version" in r.json()


@pytest.mark.parametrize("path", ["/health", "/api/health"])
def test_7_health_without_login(anon, path):
    assert anon.get(path).status_code == 200


def test_7_ip_access_redirects_to_domain():
    ip = os.environ.get("SERVER_IP")
    if not ip:
        pytest.skip("SERVER_IP is not set")
    r = httpx.get(f"https://{ip}/netbox/", verify=False, follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == f"{BASE}/netbox/"


# --- 8. Honest monitoring: a stopped NetBox is "offline", not "works" ---
def _docker(method: str, path: str) -> httpx.Response:
    sock = env("DOCKER_SOCK")
    with httpx.Client(transport=httpx.HTTPTransport(uds=sock), base_url="http://docker", timeout=120) as d:
        return d.request(method, path)


def _netbox_status(admin: httpx.Client) -> str:
    time.sleep(6)  # "check now" is rate limited to once per 5 s
    return admin.post("/api/status/refresh").json()["systems"]["netbox"]["status"]


def test_8_stopped_netbox_is_offline(admin):
    assert _netbox_status(admin) in ("online", "degraded")
    assert _docker("POST", "/containers/netbox/stop").status_code in (204, 304)
    try:
        assert _netbox_status(admin) == "offline"
    finally:
        _docker("POST", "/containers/netbox/start")
    for _ in range(60):  # wait until NetBox is healthy again for the next tests
        if _docker("GET", "/containers/netbox/json").json()["State"].get("Health", {}).get("Status") == "healthy":
            break
        time.sleep(5)
    assert _netbox_status(admin) in ("online", "degraded")


# --- 9. A user without portal groups gets a 403 page ---
def test_9_user_without_groups_is_rejected():
    c = client(follow_redirects=True)
    r = c.get("/")
    r = c.post(login_form_action(r.text), data={"username": env("NOGROUP_USER"), "password": env("NOGROUP_PASS")})
    assert r.status_code == 403, f"expected 403, got {r.status_code} at {r.url}"
    assert "Нет доступа" in r.text
    assert "_rep_sso" not in c.cookies
