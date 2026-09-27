"""Shared fixtures: real SSO logins through Nginx -> oauth2-proxy -> Keycloak.

Environment (set by deploy/scripts/e2e.sh):
  BASE_URL            https://rep.local.inion
  CA_FILE             certificate of the host Nginx (TLS is verified)
  ADMIN_USER/PASS     SSO user in all admin groups (admin.portal)
  USER_USER/PASS      SSO user in portal-users only (user.portal)
  NOGROUP_USER/PASS   SSO user without portal groups (created by e2e.sh)
  NETBOX_TOKEN        NetBox API token of the local admin
  DOCKER_SOCK         /var/run/docker.sock (scenario 8: stop NetBox)
"""

from __future__ import annotations

import html
import os
import re
import ssl

import httpx
import pytest

BASE = os.environ.get("BASE_URL", "https://rep.local.inion").rstrip("/")
CA = os.environ.get("CA_FILE", "/ca.crt")


def client(**kw) -> httpx.Client:
    # TLS is verified against the certificate of the host Nginx
    return httpx.Client(base_url=BASE, verify=ssl.create_default_context(cafile=CA), timeout=30, **kw)


def login_form_action(page: str) -> str | None:
    m = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', page)
    return html.unescape(m.group(1)) if m else None


def sso_login(username: str, password: str, start: str = "/") -> httpx.Client:
    """Log in like a browser. Returns a client holding the _rep_sso cookie."""
    c = client(follow_redirects=True)
    r = c.get(start)
    action = login_form_action(r.text)
    assert action, f"no Keycloak login form after GET {start} (landed on {r.url})"
    r = c.post(action, data={"username": username, "password": password, "credentialId": ""})
    assert "_rep_sso" in c.cookies, f"login of {username} failed, landed on {r.url} ({r.status_code})"
    return c


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        pytest.skip(f"{name} is not set")
    return v


@pytest.fixture(scope="session")
def admin() -> httpx.Client:
    return sso_login(env("ADMIN_USER"), env("ADMIN_PASS"))


@pytest.fixture(scope="session")
def user() -> httpx.Client:
    return sso_login(env("USER_USER"), env("USER_PASS"))


@pytest.fixture()
def anon() -> httpx.Client:
    return client(follow_redirects=False)
