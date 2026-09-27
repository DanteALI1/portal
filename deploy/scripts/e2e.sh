#!/usr/bin/env bash
# End-to-end tests of single sign-on on an installed server (run from the repository):
#   sudo bash deploy/scripts/e2e.sh            API (pytest) + browser (Playwright)
#   sudo bash deploy/scripts/e2e.sh api        API tests only
#   sudo bash deploy/scripts/e2e.sh browser    browser tests only
#   sudo bash deploy/scripts/e2e.sh api -k test_5     extra arguments go to pytest / Playwright
# Needs internet access to pip/npm registries and Docker Hub / mcr.microsoft.com.
# Scenario 8 stops the NetBox container for ~1 minute.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICES_ROOT="${SERVICES_ROOT:-/opt/services}"
WHAT="${1:-all}"
shift || true
EXTRA=("$@")
PY_IMAGE="docker.io/python:3.12.12-slim"
PW_IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
[[ -d "${REPO_ROOT}/tests" ]] || { echo "Run from the repository checkout (tests/ not found)" >&2; exit 1; }

env_get() { grep -m1 "^$2=" "$1" | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/'; }
set -a
# shellcheck disable=SC1091
source "${SERVICES_ROOT}/sso.env"
set +a
DOMAIN="${DOMAIN:-rep.local.inion}"
TEST_USERS="${SERVICES_ROOT}/keycloak/test-users.env"
[[ -f "${TEST_USERS}" ]] || { echo "No ${TEST_USERS}: test users exist only without LDAP" >&2; exit 1; }

NOGROUP_USER="nogroup.e2e"
NOGROUP_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 20)"
SERVER_IP="$(hostname -I | tr ' ' '\n' | grep -v ':' | grep -v '^127\.' | grep -v '^172\.' | head -1 || true)"

kc_admin() { # run a kcadm script from stdin inside the keycloak container
  { printf 'U=%q\nP=%q\n' "$(env_get "${SERVICES_ROOT}/keycloak/.env" KEYCLOAK_ADMIN_USER)" \
      "$(env_get "${SERVICES_ROOT}/keycloak/.env" KEYCLOAK_ADMIN_PASSWORD)"
    echo 'K=/opt/keycloak/bin/kcadm.sh; C=(--config /tmp/kcadm-e2e.config); trap "rm -f /tmp/kcadm-e2e.config" EXIT'
    echo '"$K" config credentials "${C[@]}" --server http://localhost:8080/auth --realm master --user "$U" --password "$P" >/dev/null'
    cat
  } | docker exec -i keycloak bash -s
}

cleanup() {
  printf 'N=%q\n%s\n' "${NOGROUP_USER}" \
    'id=$("$K" get users "${C[@]}" -r inion -q username=$N -q exact=true --fields id --format csv --noquotes); [ -z "$id" ] || "$K" delete users/$id "${C[@]}" -r inion' \
    | kc_admin >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[e2e] creating temporary user without portal groups: ${NOGROUP_USER}"
cleanup
printf 'N=%q\nPW=%q\n%s\n' "${NOGROUP_USER}" "${NOGROUP_PASS}" \
  '"$K" create users "${C[@]}" -r inion -s username=$N -s enabled=true -s email=$N@local.inion -s emailVerified=true -s firstName=Без -s lastName=Групп >/dev/null
   "$K" set-password "${C[@]}" -r inion --username "$N" --new-password "$PW"' | kc_admin

ENV_ARGS=(
  -e "BASE_URL=https://${DOMAIN}" -e CA_FILE=/ca.crt -e "SERVER_IP=${SERVER_IP}"
  -e "ADMIN_USER=$(env_get "${TEST_USERS}" TEST_ADMIN_USER)" -e "ADMIN_PASS=$(env_get "${TEST_USERS}" TEST_ADMIN_PASSWORD)"
  -e "USER_USER=$(env_get "${TEST_USERS}" TEST_USER_USER)" -e "USER_PASS=$(env_get "${TEST_USERS}" TEST_USER_PASSWORD)"
  -e "NOGROUP_USER=${NOGROUP_USER}" -e "NOGROUP_PASS=${NOGROUP_PASS}"
  -e "NETBOX_TOKEN=$(env_get "${SERVICES_ROOT}/netbox/.env" SUPERUSER_API_TOKEN)"
)
# --network host: the container uses this host's /etc/hosts (rep.local.inion -> 127.0.0.1)
COMMON=(--rm --network host -v "/etc/nginx/ssl/${DOMAIN}.crt:/ca.crt:ro")
RC=0

if [[ "${WHAT}" == all || "${WHAT}" == api ]]; then
  echo "[e2e] API tests (pytest)"
  docker run "${COMMON[@]}" "${ENV_ARGS[@]}" -e DOCKER_SOCK=/var/run/docker.sock \
    -v /var/run/docker.sock:/var/run/docker.sock -v "${REPO_ROOT}/tests/api:/tests:ro" -w /tests \
    -e PYTHONDONTWRITEBYTECODE=1 "${PY_IMAGE}" \
    sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore -r requirements.txt && python -m pytest -p no:cacheprovider -v "$@"' pytest "${EXTRA[@]}" \
    || RC=1
fi

if [[ "${WHAT}" == all || "${WHAT}" == browser ]]; then
  echo "[e2e] browser tests (Playwright)"
  docker run "${COMMON[@]}" "${ENV_ARGS[@]}" --ipc=host \
    -v "${REPO_ROOT}/tests/e2e:/src:ro" "${PW_IMAGE}" \
    sh -c 'cp -r /src /e2e && cd /e2e && npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' playwright "${EXTRA[@]}" \
    || RC=1
fi

if [[ ${RC} -eq 0 ]]; then echo "[e2e] ALL PASSED"; else echo "[e2e] FAILURES — see output above"; fi
exit ${RC}
