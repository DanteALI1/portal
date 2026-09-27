#!/usr/bin/env bash
# Nightly backup (cron 03:00): databases, uploaded files, SSO realm, configs. Keeps 30 days.
set -euo pipefail

ROOT="/opt/services"
BACKUP_ROOT="${ROOT}/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"
HELPER_IMAGE="docker.io/alpine:3.24.2"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

echo "[backup] starting ${BACKUP_DIR}"
running() { docker ps --format '{{.Names}}' | grep -qx "$1"; }
env_get() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/'; }
volume_tar() { # volume-name-regex archive-name
  local vol
  vol="$(docker volume ls --format '{{.Name}}' | grep -E "$1" | head -1 || true)"
  [[ -n "${vol}" ]] || return 0
  docker run --rm -v "${vol}:/source:ro" -v "${BACKUP_DIR}:/backup" "${HELPER_IMAGE}" \
    tar czf "/backup/$2" -C /source .
}

# NetBox DB + media
if running netbox-postgres; then
  docker exec netbox-postgres pg_dump -U netbox netbox | gzip > "${BACKUP_DIR}/netbox_db.sql.gz"
fi
volume_tar 'netbox[-_]netbox-media$' netbox_media.tar.gz

# MediaWiki DB + images (password via env, not argv)
if running wiki-mariadb; then
  docker exec -e MYSQL_PWD="$(env_get "${ROOT}/mediawiki/.env" MARIADB_ROOT_PASSWORD)" wiki-mariadb \
    mariadb-dump -u root --single-transaction mediawiki | gzip > "${BACKUP_DIR}/wiki_db.sql.gz"
fi
volume_tar 'mediawiki[-_]wiki-images$' wiki_images.tar.gz

# Keycloak DB (users, sessions config, federation) + realm export
if running keycloak-postgres; then
  docker exec keycloak-postgres pg_dump -U keycloak keycloak | gzip > "${BACKUP_DIR}/keycloak_db.sql.gz"
fi
if running keycloak; then
  KC_USER="$(env_get "${ROOT}/keycloak/.env" KEYCLOAK_ADMIN_USER)"
  KC_PASS="$(env_get "${ROOT}/keycloak/.env" KEYCLOAK_ADMIN_PASSWORD)"
  # Partial export: realm settings, groups, roles, clients (secrets are masked by Keycloak)
  printf 'U=%q\nP=%q\n' "${KC_USER:-admin}" "${KC_PASS}" | cat - <(cat <<'EOF'
K=/opt/keycloak/bin/kcadm.sh; C=(--config /tmp/kcadm-backup.config)
trap 'rm -f /tmp/kcadm-backup.config' EXIT
"$K" config credentials "${C[@]}" --server http://localhost:8080/auth --realm master --user "$U" --password "$P" >/dev/null 2>&1
"$K" create "realms/inion/partial-export?exportClients=true&exportGroupsAndRoles=true" "${C[@]}" -o
EOF
) | docker exec -i keycloak bash -s > "${BACKUP_DIR}/keycloak_realm_inion.json" 2>/dev/null \
    || echo "[backup] WARNING: Keycloak realm export failed (DB dump is still there)" >&2
fi

# Portal catalog and audit log
cp -a "${ROOT}/portal/data/systems.json" "${ROOT}/portal/data/audit.jsonl" "${BACKUP_DIR}/" 2>/dev/null || true

# Configs and secrets (the backup directory is 0700). TLS private keys are NOT copied.
mkdir -p "${BACKUP_DIR}/config"
for svc in netbox mediawiki keycloak oauth2-proxy portal; do
  cp -a "${ROOT}/${svc}/.env" "${BACKUP_DIR}/config/${svc}.env" 2>/dev/null || true
done
cp -a "${ROOT}/sso.env" "${ROOT}/keycloak/test-users.env" "${ROOT}/mediawiki/LocalSettings.php" \
  /etc/nginx/conf.d/rep.local.inion.conf "${BACKUP_DIR}/config/" 2>/dev/null || true
cp -a /etc/nginx/rep "${BACKUP_DIR}/config/nginx-snippets" 2>/dev/null || true

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +

echo "[backup] completed ${BACKUP_DIR}"
ls -la "${BACKUP_DIR}"
