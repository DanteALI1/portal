#!/usr/bin/env bash
# Generate .env files with strong secrets (no leading spaces!)
set -euo pipefail

ROOT="${1:-/opt/services}"

rand() { openssl rand -base64 48 | tr -d '/+=' | head -c "$1"; }
rand_hex() { openssl rand -hex "$1"; }

mkdir -p "${ROOT}/netbox" "${ROOT}/mediawiki" "${ROOT}/portal/data"

# --- NetBox ---
if [[ ! -f "${ROOT}/netbox/.env" ]]; then
  POSTGRES_PASSWORD="$(rand 32)"
  REDIS_PASSWORD="$(rand 32)"
  REDIS_CACHE_PASSWORD="$(rand 32)"
  SECRET_KEY="$(rand 64)"
  ADMIN_PASS="$(rand 20)"
  API_TOKEN="$(rand_hex 20)"
  # Allow access by server IPs too (https://<ip>/netbox/)
  HOST_IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v ':' | xargs || true)"
  CSRF_ORIGINS="https://rep.local.inion"
  for ip in ${HOST_IPS}; do CSRF_ORIGINS="${CSRF_ORIGINS} https://${ip}"; done

  cat > "${ROOT}/netbox/.env" <<EOF
VERSION=v4.7-5.1.1
POSTGRES_DB=netbox
POSTGRES_USER=netbox
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DB_HOST=postgres
DB_NAME=netbox
DB_USER=netbox
DB_PASSWORD=${POSTGRES_PASSWORD}
DB_WAIT_DEBUG=1
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DATABASE=0
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_SSL=false
REDIS_INSECURE_SKIP_TLS_VERIFY=false
REDIS_CACHE_HOST=redis-cache
REDIS_CACHE_PORT=6379
REDIS_CACHE_DATABASE=1
REDIS_CACHE_PASSWORD=${REDIS_CACHE_PASSWORD}
REDIS_CACHE_SSL=false
REDIS_CACHE_INSECURE_SKIP_TLS_VERIFY=false
SECRET_KEY=${SECRET_KEY}
ALLOWED_HOSTS="rep.local.inion localhost 127.0.0.1 ${HOST_IPS}"
CSRF_TRUSTED_ORIGINS="${CSRF_ORIGINS}"
BASE_PATH=netbox/
CORS_ORIGIN_ALLOW_ALL=True
SKIP_SUPERUSER=false
SUPERUSER_NAME=admin
SUPERUSER_EMAIL=admin@local.inion
SUPERUSER_PASSWORD=${ADMIN_PASS}
SUPERUSER_API_TOKEN=${API_TOKEN}
LOGIN_REQUIRED=true
GRAPHQL_ENABLED=true
METRICS_ENABLED=false
MEDIA_ROOT=/opt/netbox/netbox/media
RELEASE_CHECK_URL=https://api.github.com/repos/netbox-community/netbox/releases
EOF
  chmod 600 "${ROOT}/netbox/.env"
  echo "[env] netbox admin password: ${ADMIN_PASS}"
  echo "[env] netbox api token: ${API_TOKEN}"
else
  echo "[env] ${ROOT}/netbox/.env exists — skipped"
fi

# --- MediaWiki ---
if [[ ! -f "${ROOT}/mediawiki/.env" ]]; then
  WIKI_DB_PASS="$(rand 32)"
  WIKI_ROOT_PASS="$(rand 32)"
  WIKI_ADMIN_PASS="$(rand 20)"

  cat > "${ROOT}/mediawiki/.env" <<EOF
WIKI_DB_NAME=mediawiki
WIKI_DB_USER=wiki
WIKI_DB_PASSWORD=${WIKI_DB_PASS}
MARIADB_ROOT_PASSWORD=${WIKI_ROOT_PASS}
MARIADB_DATABASE=mediawiki
MARIADB_USER=wiki
MARIADB_PASSWORD=${WIKI_DB_PASS}
WIKI_ADMIN_USER=WikiAdmin
WIKI_ADMIN_PASSWORD=${WIKI_ADMIN_PASS}
WIKI_SITENAME="Корпоративная Вики"
EOF
  chmod 600 "${ROOT}/mediawiki/.env"
  echo "[env] wiki admin password: ${WIKI_ADMIN_PASS}"
else
  echo "[env] ${ROOT}/mediawiki/.env exists — skipped"
fi

# Persist credentials summary
CREDS="${ROOT}/credentials-$(date +%Y%m%d).txt"
{
  echo "Generated: $(date -Is)"
  echo "NetBox .env: ${ROOT}/netbox/.env"
  echo "MediaWiki .env: ${ROOT}/mediawiki/.env"
  if [[ -f "${ROOT}/netbox/.env" ]]; then
    # shellcheck disable=SC1091
    source "${ROOT}/netbox/.env"
    echo "NetBox admin: ${SUPERUSER_NAME} / ${SUPERUSER_PASSWORD}"
  fi
  if [[ -f "${ROOT}/mediawiki/.env" ]]; then
    # shellcheck disable=SC1091
    source "${ROOT}/mediawiki/.env"
    echo "Wiki admin: ${WIKI_ADMIN_USER} / ${WIKI_ADMIN_PASSWORD}"
  fi
} > "${CREDS}"
chmod 600 "${CREDS}"
echo "[env] credentials saved to ${CREDS}"
