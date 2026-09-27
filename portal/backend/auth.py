"""Current user from the SSO headers set by Nginx (oauth2-proxy -> auth_request).

The portal listens on 127.0.0.1 only and Nginx overwrites (or wipes) every X-Remote-*
header, so these headers can be trusted here.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, Request

PORTAL_ENV = os.environ.get("PORTAL_ENV", "prod")
GROUP_USERS = os.environ.get("SSO_GROUP_USERS", "portal-users")
GROUP_ADMINS = os.environ.get("SSO_GROUP_PORTAL_ADMINS", "portal-admins")
GROUP_NETBOX_ADMINS = os.environ.get("SSO_GROUP_NETBOX_ADMINS", "netbox-admins")
GROUP_WIKI_ADMINS = os.environ.get("SSO_GROUP_WIKI_ADMINS", "wiki-admins")
ALL_GROUPS = [GROUP_USERS, GROUP_ADMINS, GROUP_NETBOX_ADMINS, GROUP_WIKI_ADMINS]


@dataclass
class User:
    username: str
    name: str
    email: str
    groups: list[str] = field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return GROUP_ADMINS in self.groups

    def public(self) -> dict:
        return {
            "username": self.username,
            "name": self.name,
            "email": self.email,
            "groups": self.groups,
            "isAdmin": self.is_admin,
        }


def _jwt_claims(token: str) -> dict:
    """Payload of the Keycloak access token (signature is not checked: Nginx is trusted)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:  # noqa: BLE001
        return {}


def _split_groups(raw: str) -> list[str]:
    # oauth2-proxy joins groups with ","; strip a leading "/" in case full paths are sent
    return [g.strip().lstrip("/") for g in raw.split(",") if g.strip()]


def current_user(request: Request) -> User:
    h = request.headers
    username = h.get("x-remote-user", "").strip()
    groups = _split_groups(h.get("x-remote-groups", ""))
    email = h.get("x-remote-email", "").strip()
    claims = _jwt_claims(h.get("x-remote-token", ""))

    if not username and PORTAL_ENV == "dev":
        # Local development without Nginx/SSO only
        username = os.environ.get("PORTAL_DEV_USER", "dev.user")
        groups = _split_groups(os.environ.get("PORTAL_DEV_GROUPS", f"{GROUP_USERS},{GROUP_ADMINS}"))
        email = f"{username}@local.inion"

    if not username:
        raise HTTPException(status_code=401, detail="Требуется вход")

    name = (
        claims.get("name")
        or " ".join(x for x in (claims.get("given_name"), claims.get("family_name")) if x)
        or username
    )
    return User(username=username, name=name, email=email or claims.get("email", ""), groups=groups)


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=403,
            detail=f"Изменять каталог могут только участники группы {GROUP_ADMINS}",
        )
    return user
