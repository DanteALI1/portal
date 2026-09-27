# Idempotent NetBox post-install: read-only access for SSO groups + API token of the local admin.
# Run: docker exec -i netbox /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell < post-install.py
# ("shell" executes stdin as a whole; the interactive "nbshell" silently drops a trailing if/else block)
import os

from core.models import ObjectType
from users.models import Group, ObjectPermission, Token, User

# 1) Read-only access for SSO groups. NetBox 4.7 cannot express "view everything" in
#    REMOTE_AUTH_DEFAULT_PERMISSIONS (no wildcards), so it is an ObjectPermission bound to the groups.
groups = [
    os.environ.get("SSO_GROUP_USERS", "portal-users"),
    os.environ.get("SSO_GROUP_PORTAL_ADMINS", "portal-admins"),
    os.environ.get("SSO_GROUP_NETBOX_ADMINS", "netbox-admins"),
    os.environ.get("SSO_GROUP_WIKI_ADMINS", "wiki-admins"),
]
group_objs = [Group.objects.get_or_create(name=g)[0] for g in groups]
perm, created = ObjectPermission.objects.get_or_create(
    name="SSO: только просмотр",
    defaults={"description": "Просмотр всех объектов для пользователей единого входа", "actions": ["view"]},
)
perm.actions = ["view"]
perm.enabled = True
perm.constraints = None
perm.save()
perm.object_types.set(ObjectType.objects.public())
perm.groups.set(group_objs)
print(f"[netbox] read-only permission {'created' if created else 'updated'}: "
      f"{perm.object_types.count()} object types, groups: {', '.join(groups)}")

# 2) API token of the local admin from SUPERUSER_API_TOKEN. netbox-docker 5.x no longer creates it,
#    and without it automation and the "token API works without SSO" check have nothing to use.
name = os.environ.get("SUPERUSER_NAME", "admin")
plain = os.environ.get("SUPERUSER_API_TOKEN", "")
admin = User.objects.filter(username=name).first()
if admin and plain:
    if any(t.plaintext == plain for t in Token.objects.filter(user=admin, version=1)):
        print(f"[netbox] API token of {name}: present")
    else:
        Token(user=admin, version=1, token=plain, description="install.sh: SUPERUSER_API_TOKEN").save()
        print(f"[netbox] API token of {name}: created")
