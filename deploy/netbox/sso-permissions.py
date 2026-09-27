# Idempotent: read-only access for SSO groups in NetBox.
# Run: docker exec -i netbox /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py nbshell < sso-permissions.py
import os

from core.models import ObjectType
from users.models import Group, ObjectPermission

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
