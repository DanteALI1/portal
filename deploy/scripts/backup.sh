#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="/opt/services/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"
mkdir -p "${BACKUP_DIR}"

echo "[backup] starting ${BACKUP_DIR}"

# NetBox DB
if docker ps --format '{{.Names}}' | grep -qx netbox-postgres; then
  docker exec netbox-postgres pg_dump -U netbox netbox \
    | gzip > "${BACKUP_DIR}/netbox_db.sql.gz"
fi

# NetBox media
if docker volume ls --format '{{.Name}}' | grep -q 'netbox-media\|netbox_netbox-media'; then
  VOL="$(docker volume ls --format '{{.Name}}' | grep -E 'netbox[-_]netbox-media|netbox-media$' | head -1)"
  docker run --rm -v "${VOL}:/source:ro" -v "${BACKUP_DIR}:/backup" alpine \
    tar czf /backup/netbox_media.tar.gz -C /source .
fi

# MediaWiki DB
if [[ -f /opt/services/mediawiki/.env ]]; then
  # shellcheck disable=SC1091
  set -a
  source /opt/services/mediawiki/.env
  set +a
  if docker ps --format '{{.Names}}' | grep -qx wiki-mariadb; then
    docker exec wiki-mariadb mysqldump -u root -p"${MARIADB_ROOT_PASSWORD}" mediawiki \
      | gzip > "${BACKUP_DIR}/wiki_db.sql.gz"
  fi
fi

# Wiki images
if docker volume ls --format '{{.Name}}' | grep -q 'wiki-images\|mediawiki_wiki-images'; then
  VOL="$(docker volume ls --format '{{.Name}}' | grep -E 'mediawiki[-_]wiki-images|wiki-images$' | head -1)"
  docker run --rm -v "${VOL}:/source:ro" -v "${BACKUP_DIR}:/backup" alpine \
    tar czf /backup/wiki_images.tar.gz -C /source .
fi

# Configs (no private keys from /etc/nginx/ssl)
cp -a /opt/services/netbox/.env "${BACKUP_DIR}/netbox.env" 2>/dev/null || true
cp -a /opt/services/mediawiki/.env "${BACKUP_DIR}/mediawiki.env" 2>/dev/null || true
cp -a /opt/services/mediawiki/LocalSettings.php "${BACKUP_DIR}/" 2>/dev/null || true
cp -a /etc/nginx/conf.d/rep.local.inion.conf "${BACKUP_DIR}/" 2>/dev/null || true
cp -a /opt/services/portal/data/systems.json "${BACKUP_DIR}/" 2>/dev/null || true

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +

echo "[backup] completed ${BACKUP_DIR}"
