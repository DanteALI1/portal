#!/usr/bin/env bash
# Generate / complete .env files with strong secrets. Idempotent:
#   - missing keys are added, existing values (passwords!) are never changed;
#   - role group names from ${ROOT}/sso.env are copied to every service;
#   - the OIDC client secret is kept identical in Keycloak and oauth2-proxy.
# Usage: gen-env.sh [/opt/services]
set -euo pipefail

ROOT="${1:-/opt/services}"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

rand() { openssl rand -base64 48 | tr -d '/+=' | head -c "$1"; }
rand_hex() { openssl rand -hex "$1"; }

mkdir -p "${ROOT}"/{netbox,mediawiki,portal/data,keycloak,oauth2-proxy}

get_kv() { # file key -> value without surrounding quotes
  [[ -f "$1" ]] || return 0
  grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' || true
}
ensure_kv() { # file key value — add only if the key is missing
  local f="$1" k="$2" v="$3"
  touch "$f"
  grep -q "^${k}=" "$f" || printf '%s=%s\n' "$k" "$v" >> "$f"
}
set_kv() { # file key value — add or replace
  local f="$1" k="$2" v="$3" tmp
  touch "$f"
  tmp="$(mktemp)"
  grep -v "^${k}=" "$f" > "$tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  cat "$tmp" > "$f"
  rm -f "$tmp"
}

# --- Shared SSO settings: domain and role group names ---
# DOMAIN from the caller (install/bootstrap env) wins over a stale sso.env value.
SSO_ENV="${ROOT}/sso.env"
CALLER_DOMAIN="${DOMAIN:-}"
if [[ ! -f "${SSO_ENV}" ]]; then
  cp "${REPO_ROOT}/deploy/sso.env.example" "${SSO_ENV}"
  echo "[env] ${SSO_ENV} created from sso.env.example"
fi
chmod 644 "${SSO_ENV}"
set -a
# shellcheck disable=SC1090
source "${SSO_ENV}"
set +a
if [[ -n "${CALLER_DOMAIN}" ]]; then
  DOMAIN="${CALLER_DOMAIN}"
fi
DOMAIN="${DOMAIN:-rep.local.inion}"
set_kv "${SSO_ENV}" DOMAIN "${DOMAIN}"
GROUP_KEYS=(SSO_GROUP_USERS SSO_GROUP_PORTAL_ADMINS SSO_GROUP_NETBOX_ADMINS SSO_GROUP_WIKI_ADMINS)
SSO_GROUP_USERS="${SSO_GROUP_USERS:-portal-users}"
SSO_GROUP_PORTAL_ADMINS="${SSO_GROUP_PORTAL_ADMINS:-portal-admins}"
SSO_GROUP_NETBOX_ADMINS="${SSO_GROUP_NETBOX_ADMINS:-netbox-admins}"
SSO_GROUP_WIKI_ADMINS="${SSO_GROUP_WIKI_ADMINS:-wiki-admins}"
sync_groups() { local k; set_kv "$1" DOMAIN "${DOMAIN}"; for k in "${GROUP_KEYS[@]}"; do set_kv "$1" "$k" "${!k}"; done; }
echo "[env] DOMAIN=${DOMAIN}"

# Server IPv4 addresses (NetBox ALLOWED_HOSTS / CSRF for emergency access by IP)
HOST_IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v ':' | xargs || true)"
CSRF_ORIGINS="https://${DOMAIN}"
for ip in ${HOST_IPS}; do CSRF_ORIGINS="${CSRF_ORIGINS} https://${ip}"; done

# --- Keycloak ---
KC="${ROOT}/keycloak/.env"
NEW_KC=false; [[ -f "${KC}" ]] || NEW_KC=true
ensure_kv "${KC}" KC_DB_PASSWORD "$(rand 32)"
ensure_kv "${KC}" KEYCLOAK_ADMIN_USER admin
ensure_kv "${KC}" KEYCLOAK_ADMIN_PASSWORD "$(rand 24)"
ensure_kv "${KC}" OIDC_CLIENT_SECRET "$(rand 40)"
ensure_kv "${KC}" KC_SSO_SESSION_MAX 36000
ensure_kv "${KC}" KC_SSO_SESSION_IDLE 1800
ensure_kv "${KC}" KEYCLOAK_ADMIN_ALLOW '"127.0.0.1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"'
for k in LDAP_URL LDAP_BIND_DN LDAP_BIND_PASSWORD LDAP_USERS_DN LDAP_GROUPS_DN LDAP_USER_FILTER \
         KERBEROS_REALM KERBEROS_PRINCIPAL; do
  ensure_kv "${KC}" "$k" ""
done
ensure_kv "${KC}" LDAP_VENDOR ad
ensure_kv "${KC}" LDAP_START_TLS false
ensure_kv "${KC}" KERBEROS_ENABLED false
sync_groups "${KC}"
chmod 600 "${KC}"
${NEW_KC} && echo "[env] keycloak .env created" || echo "[env] keycloak .env completed (existing values kept)"

# --- oauth2-proxy (client secret always equals Keycloak's) ---
O2="${ROOT}/oauth2-proxy/.env"
set_kv "${O2}" OAUTH2_PROXY_CLIENT_SECRET "$(get_kv "${KC}" OIDC_CLIENT_SECRET)"
ensure_kv "${O2}" OAUTH2_PROXY_COOKIE_SECRET "$(openssl rand -base64 32 | tr -- '+/' '-_')"
ensure_kv "${O2}" OAUTH2_PROXY_REDIS_PASSWORD "$(rand 32)"
sync_groups "${O2}"
chmod 600 "${O2}"
echo "[env] oauth2-proxy .env ready"

# --- NetBox ---
NB="${ROOT}/netbox/.env"
NEW_NB=false; [[ -f "${NB}" ]] || NEW_NB=true
NB_PG="$(get_kv "${NB}" POSTGRES_PASSWORD)"; NB_PG="${NB_PG:-$(rand 32)}"
ensure_kv "${NB}" VERSION v4.7-5.1.1
ensure_kv "${NB}" POSTGRES_DB netbox
ensure_kv "${NB}" POSTGRES_USER netbox
ensure_kv "${NB}" POSTGRES_PASSWORD "${NB_PG}"
ensure_kv "${NB}" DB_HOST postgres
ensure_kv "${NB}" DB_NAME netbox
ensure_kv "${NB}" DB_USER netbox
ensure_kv "${NB}" DB_PASSWORD "${NB_PG}"
ensure_kv "${NB}" DB_WAIT_DEBUG 1
ensure_kv "${NB}" REDIS_HOST redis
ensure_kv "${NB}" REDIS_PORT 6379
ensure_kv "${NB}" REDIS_DATABASE 0
ensure_kv "${NB}" REDIS_PASSWORD "$(rand 32)"
ensure_kv "${NB}" REDIS_SSL false
ensure_kv "${NB}" REDIS_INSECURE_SKIP_TLS_VERIFY false
ensure_kv "${NB}" REDIS_CACHE_HOST redis-cache
ensure_kv "${NB}" REDIS_CACHE_PORT 6379
ensure_kv "${NB}" REDIS_CACHE_DATABASE 1
ensure_kv "${NB}" REDIS_CACHE_PASSWORD "$(rand 32)"
ensure_kv "${NB}" REDIS_CACHE_SSL false
ensure_kv "${NB}" REDIS_CACHE_INSECURE_SKIP_TLS_VERIFY false
ensure_kv "${NB}" SECRET_KEY "$(rand 64)"
ensure_kv "${NB}" ALLOWED_HOSTS "\"${DOMAIN} localhost 127.0.0.1 netbox ${HOST_IPS}\""
ensure_kv "${NB}" CSRF_TRUSTED_ORIGINS "\"${CSRF_ORIGINS}\""
ensure_kv "${NB}" BASE_PATH netbox/
ensure_kv "${NB}" CORS_ORIGIN_ALLOW_ALL False
ensure_kv "${NB}" SKIP_SUPERUSER false
ensure_kv "${NB}" SUPERUSER_NAME admin
ensure_kv "${NB}" SUPERUSER_EMAIL admin@local.inion
ensure_kv "${NB}" SUPERUSER_PASSWORD "$(rand 20)"
ensure_kv "${NB}" SUPERUSER_API_TOKEN "$(rand_hex 20)"
ensure_kv "${NB}" API_TOKEN_PEPPER_1 "$(rand 64)"
ensure_kv "${NB}" LOGIN_REQUIRED true
ensure_kv "${NB}" GRAPHQL_ENABLED true
ensure_kv "${NB}" METRICS_ENABLED false
ensure_kv "${NB}" MEDIA_ROOT /opt/netbox/netbox/media
ensure_kv "${NB}" RELEASE_CHECK_URL https://api.github.com/repos/netbox-community/netbox/releases
# Single sign-on via X-Remote-* headers from Nginx
set_kv "${NB}" REMOTE_AUTH_ENABLED True
set_kv "${NB}" REMOTE_AUTH_BACKEND netbox.authentication.RemoteUserBackend
set_kv "${NB}" REMOTE_AUTH_HEADER HTTP_X_REMOTE_USER
set_kv "${NB}" REMOTE_AUTH_USER_EMAIL HTTP_X_REMOTE_EMAIL
set_kv "${NB}" REMOTE_AUTH_AUTO_CREATE_USER True
set_kv "${NB}" REMOTE_AUTH_GROUP_SYNC_ENABLED True
set_kv "${NB}" REMOTE_AUTH_GROUP_HEADER HTTP_X_REMOTE_GROUPS
set_kv "${NB}" REMOTE_AUTH_GROUP_SEPARATOR ,
set_kv "${NB}" REMOTE_AUTH_AUTO_CREATE_GROUPS True
set_kv "${NB}" REMOTE_AUTH_SUPERUSER_GROUPS "${SSO_GROUP_NETBOX_ADMINS}"
set_kv "${NB}" REMOTE_AUTH_STAFF_GROUPS "${SSO_GROUP_NETBOX_ADMINS}"
sync_groups "${NB}"
chmod 600 "${NB}"
${NEW_NB} && echo "[env] netbox .env created" || echo "[env] netbox .env completed (existing values kept)"

# --- MediaWiki ---
MW="${ROOT}/mediawiki/.env"
NEW_MW=false; [[ -f "${MW}" ]] || NEW_MW=true
MW_DB="$(get_kv "${MW}" MARIADB_PASSWORD)"; MW_DB="${MW_DB:-$(rand 32)}"
ensure_kv "${MW}" WIKI_DB_NAME mediawiki
ensure_kv "${MW}" WIKI_DB_USER wiki
ensure_kv "${MW}" WIKI_DB_PASSWORD "${MW_DB}"
ensure_kv "${MW}" MARIADB_ROOT_PASSWORD "$(rand 32)"
ensure_kv "${MW}" MARIADB_DATABASE mediawiki
ensure_kv "${MW}" MARIADB_USER wiki
ensure_kv "${MW}" MARIADB_PASSWORD "${MW_DB}"
ensure_kv "${MW}" WIKI_ADMIN_USER WikiAdmin
ensure_kv "${MW}" WIKI_ADMIN_PASSWORD "$(rand 20)"
ensure_kv "${MW}" WIKI_SITENAME '"Корпоративная Вики"'
sync_groups "${MW}"
chmod 600 "${MW}"
${NEW_MW} && echo "[env] mediawiki .env created" || echo "[env] mediawiki .env completed (existing values kept)"

# --- Portal ---
PT="${ROOT}/portal/.env"
ensure_kv "${PT}" PORTAL_ENV prod
sync_groups "${PT}"
chmod 600 "${PT}"
echo "[env] portal .env ready"

# --- Credentials summary (0600). configure.sh appends SSO test users. ---
CREDS="${ROOT}/credentials-$(date +%Y%m%d).txt"
PREV="$(ls -1t "${ROOT}"/credentials-*.txt 2>/dev/null | head -1 || true)"
{
  echo "Generated: $(date -Is)"
  echo "Portal:        https://${DOMAIN}/   (single sign-on)"
  echo "Keycloak admin console: https://${DOMAIN}/auth/admin/  $(get_kv "${KC}" KEYCLOAK_ADMIN_USER) / $(get_kv "${KC}" KEYCLOAK_ADMIN_PASSWORD)"
  echo "NetBox local admin (emergency, SSH tunnel to 127.0.0.1:8000): $(get_kv "${NB}" SUPERUSER_NAME) / $(get_kv "${NB}" SUPERUSER_PASSWORD)"
  echo "NetBox API token: $(get_kv "${NB}" SUPERUSER_API_TOKEN)"
  echo "Wiki local admin (emergency, SSH tunnel to 127.0.0.1:8080): $(get_kv "${MW}" WIKI_ADMIN_USER) / $(get_kv "${MW}" WIKI_ADMIN_PASSWORD)"
  echo "Secrets: ${ROOT}/{keycloak,oauth2-proxy,netbox,mediawiki,portal}/.env"
  [[ -n "${PREV}" ]] && grep '^SSO test ' "${PREV}" || true
} > "${CREDS}.tmp"
mv "${CREDS}.tmp" "${CREDS}"
chmod 600 "${CREDS}"
echo "[env] credentials saved to ${CREDS}"
