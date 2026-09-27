#!/usr/bin/env bash
# MediaWiki for /wiki/ behind Nginx with single sign-on (Auth_remoteuser).
# Idempotent, works both on a clean install and on an existing wiki:
#   1. build the image (MediaWiki + vendored Auth_remoteuser)
#   2. if the database has no wiki yet -> CLI install.php (without LocalSettings.php)
#   3. ALWAYS render LocalSettings.php from LocalSettings.template.php
#      (secrets live in .env; for old installs they are taken from the existing file)
#   4. start with LocalSettings.php mounted and run update.php
set -euo pipefail

WIKI_DIR="${WIKI_DIR:-/opt/services/mediawiki}"
cd "${WIKI_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing ${WIKI_DIR}/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

DOMAIN="${DOMAIN:-rep.local.inion}"
WIKI_ADMIN_GROUP="${SSO_GROUP_WIKI_ADMINS:-wiki-admins}"
DB_NAME="${MARIADB_DATABASE:-mediawiki}"

set_env() { # key value — add or replace a line in .env
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" >> .env
  fi
}

# Docker creates a DIRECTORY if the bind-mount source file is missing — remove it.
if [[ -d LocalSettings.php ]]; then
  echo "[wiki] removing accidental LocalSettings.php directory created by Docker"
  rm -rf LocalSettings.php
fi

# Secrets: keep existing ones (from .env or from an old LocalSettings.php), otherwise generate
if [[ -z "${WIKI_SECRET_KEY:-}" && -f LocalSettings.php ]]; then
  WIKI_SECRET_KEY="$(grep -oP '^\$wgSecretKey\s*=\s*"\K[^"]+' LocalSettings.php || true)"
fi
if [[ -z "${WIKI_UPGRADE_KEY:-}" && -f LocalSettings.php ]]; then
  WIKI_UPGRADE_KEY="$(grep -oP '^\$wgUpgradeKey\s*=\s*"\K[^"]+' LocalSettings.php || true)"
fi
WIKI_SECRET_KEY="${WIKI_SECRET_KEY:-$(openssl rand -hex 32)}"
WIKI_UPGRADE_KEY="${WIKI_UPGRADE_KEY:-$(openssl rand -hex 8)}"
set_env WIKI_SECRET_KEY "${WIKI_SECRET_KEY}"
set_env WIKI_UPGRADE_KEY "${WIKI_UPGRADE_KEY}"

echo "[wiki] building image (MediaWiki + Auth_remoteuser)"
docker compose build --quiet mediawiki

db_ready() { docker exec wiki-mariadb healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; }
wiki_installed() {
  docker exec -e MYSQL_PWD="${MARIADB_ROOT_PASSWORD}" wiki-mariadb \
    mariadb -u root -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='page'" \
    2>/dev/null | grep -qx 1
}
wait_for() { # description command...
  local what="$1"; shift
  for _ in $(seq 1 60); do "$@" && return 0; sleep 3; done
  echo "[wiki] ERROR: timeout waiting for ${what}" >&2
  return 1
}

echo "[wiki] starting MariaDB"
docker compose up -d mariadb
wait_for "MariaDB" db_ready

if ! wiki_installed; then
  echo "[wiki] clean install: phase 1 — start without LocalSettings.php"
  rm -f LocalSettings.php
  docker compose -f docker-compose.yml -f docker-compose.install.yml up -d --force-recreate mediawiki
  wait_for "MediaWiki" curl -fsS -o /dev/null http://127.0.0.1:8080/

  echo "[wiki] phase 2: CLI install.php"
  docker exec mediawiki php maintenance/install.php \
    --dbname="${DB_NAME}" \
    --dbserver=mariadb \
    --dbuser="${MARIADB_USER:-wiki}" \
    --dbpass="${MARIADB_PASSWORD}" \
    --dbtype=mysql \
    --server="https://${DOMAIN}" \
    --scriptpath="/wiki" \
    --lang=ru \
    --pass="${WIKI_ADMIN_PASSWORD}" \
    "${WIKI_SITENAME:-Корпоративная Вики}" \
    "${WIKI_ADMIN_USER:-WikiAdmin}"
else
  echo "[wiki] existing wiki found in database '${DB_NAME}' — skipping install.php"
fi

echo "[wiki] rendering LocalSettings.php from template"
esc() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
sed \
  -e "s|__DOMAIN__|$(esc "${DOMAIN}")|g" \
  -e "s|__WIKI_SITENAME__|$(esc "${WIKI_SITENAME:-Корпоративная Вики}")|g" \
  -e "s|__WIKI_DB_NAME__|$(esc "${DB_NAME}")|g" \
  -e "s|__WIKI_DB_USER__|$(esc "${MARIADB_USER:-wiki}")|g" \
  -e "s|__WIKI_DB_PASSWORD__|$(esc "${MARIADB_PASSWORD}")|g" \
  -e "s|__WIKI_SECRET_KEY__|$(esc "${WIKI_SECRET_KEY}")|g" \
  -e "s|__WIKI_UPGRADE_KEY__|$(esc "${WIKI_UPGRADE_KEY}")|g" \
  -e "s|__WIKI_ADMIN_GROUP__|$(esc "${WIKI_ADMIN_GROUP}")|g" \
  LocalSettings.template.php > LocalSettings.php.new
# Readable by www-data (uid/gid 33) inside the container, not world-readable
chown root:33 LocalSettings.php.new
chmod 640 LocalSettings.php.new
mv LocalSettings.php.new LocalSettings.php

echo "[wiki] phase 3: start with LocalSettings.php mounted"
docker compose up -d --force-recreate mediawiki
wait_for "MediaWiki" docker exec mediawiki php -r 'exit(file_exists("/var/www/html/LocalSettings.php") ? 0 : 1);'

echo "[wiki] update.php (schema of core and extensions)"
docker exec mediawiki php maintenance/update.php --quick >/dev/null

echo "[wiki] done. Local admin (emergency only): ${WIKI_ADMIN_USER:-WikiAdmin}"
echo "[wiki] Open https://${DOMAIN}/wiki/ (single sign-on)"
