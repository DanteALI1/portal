#!/usr/bin/env bash
# Two-phase MediaWiki install for /wiki/ behind Nginx
set -euo pipefail

WIKI_DIR="${WIKI_DIR:-/opt/services/mediawiki}"
cd "${WIKI_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing ${WIKI_DIR}/.env" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

# Docker creates a DIRECTORY if the bind-mount source file is missing — remove it.
if [[ -d LocalSettings.php ]]; then
  echo "[wiki] removing accidental LocalSettings.php directory created by Docker"
  rm -rf LocalSettings.php
fi

if [[ -f LocalSettings.php ]]; then
  echo "[wiki] LocalSettings.php already present — starting stack"
  docker compose up -d
  exit 0
fi

echo "[wiki] phase 1: start without LocalSettings.php"
docker compose -f docker-compose.yml -f docker-compose.install.yml up -d

echo "[wiki] waiting for MariaDB + MediaWiki"
for i in $(seq 1 60); do
  if docker exec wiki-mariadb healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:8080/ >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

SECRET_KEY="$(openssl rand -hex 32)"
UPGRADE_KEY="$(openssl rand -hex 8)"

echo "[wiki] phase 2: CLI install.php"
docker exec mediawiki php maintenance/install.php \
  --dbname="${MARIADB_DATABASE:-mediawiki}" \
  --dbserver=mariadb \
  --dbuser="${MARIADB_USER:-wiki}" \
  --dbpass="${MARIADB_PASSWORD}" \
  --dbtype=mysql \
  --server="https://rep.local.inion" \
  --scriptpath="/wiki" \
  --lang=ru \
  --pass="${WIKI_ADMIN_PASSWORD}" \
  "${WIKI_SITENAME:-Корпоративная Вики}" \
  "${WIKI_ADMIN_USER:-WikiAdmin}"

echo "[wiki] extracting generated LocalSettings.php from container"
docker cp mediawiki:/var/www/html/LocalSettings.php ./LocalSettings.generated.php

# Prefer hardened template with proxy-aware settings
TEMPLATE="./LocalSettings.template.php"
if [[ -f "${TEMPLATE}" ]]; then
  sed \
    -e "s|__WIKI_SITENAME__|${WIKI_SITENAME:-Корпоративная Вики}|g" \
    -e "s|__WIKI_DB_NAME__|${MARIADB_DATABASE:-mediawiki}|g" \
    -e "s|__WIKI_DB_USER__|${MARIADB_USER:-wiki}|g" \
    -e "s|__WIKI_DB_PASSWORD__|${MARIADB_PASSWORD}|g" \
    -e "s|__WIKI_SECRET_KEY__|${SECRET_KEY}|g" \
    -e "s|__WIKI_UPGRADE_KEY__|${UPGRADE_KEY}|g" \
    "${TEMPLATE}" > LocalSettings.php
else
  cp LocalSettings.generated.php LocalSettings.php
  # Force correct public URL/path
  sed -i 's|^\$wgServer .*|$wgServer = "https://rep.local.inion";|' LocalSettings.php
  sed -i 's|^\$wgScriptPath .*|$wgScriptPath = "/wiki";|' LocalSettings.php
fi

chmod 640 LocalSettings.php

echo "[wiki] phase 3: recreate with LocalSettings mounted"
docker compose down
docker compose up -d

echo "[wiki] done. Admin: ${WIKI_ADMIN_USER:-WikiAdmin}"
echo "[wiki] Open https://rep.local.inion/wiki/"
