#!/usr/bin/env bash
# Idempotent Keycloak post-configuration via kcadm.sh (runs on the host, as root).
#   - client secret for rep-portal (same as oauth2-proxy), redirect URIs for $DOMAIN
#   - SSO session lifetimes, role groups
#   - LDAP / AD user federation if LDAP_URL is set (+ optional Kerberos)
#   - otherwise test users admin.portal / user.portal with random passwords
# Usage: bash configure.sh            (reads ./.env and ../sso.env)
set -euo pipefail

KC_DIR="${KC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
SERVICES_ROOT="${SERVICES_ROOT:-$(dirname "${KC_DIR}")}"
cd "${KC_DIR}"

set -a
# shellcheck disable=SC1091
source ./.env
# shellcheck disable=SC1091
[[ -f "${SERVICES_ROOT}/sso.env" ]] && source "${SERVICES_ROOT}/sso.env"
set +a

DOMAIN="${DOMAIN:-rep.local.inion}"
G_USERS="${SSO_GROUP_USERS:-portal-users}"
G_PORTAL_ADMINS="${SSO_GROUP_PORTAL_ADMINS:-portal-admins}"
G_NETBOX_ADMINS="${SSO_GROUP_NETBOX_ADMINS:-netbox-admins}"
G_WIKI_ADMINS="${SSO_GROUP_WIKI_ADMINS:-wiki-admins}"

log() { echo "[keycloak] $*"; }

log "waiting for Keycloak to become ready"
for _ in $(seq 1 90); do
  # /health/ready answers 200 only when fully up (503 while bootstrapping)
  if docker exec keycloak bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000 && printf "GET /auth/health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3 && head -1 <&3 | grep -q " 200 "' 2>/dev/null; then
    READY=true
    break
  fi
  sleep 5
done
[[ "${READY:-false}" == true ]] || { echo "[keycloak] ERROR: not ready after 7.5 min" >&2; exit 1; }

# --- Test users: passwords are generated once and kept in test-users.env (0600) ---
TEST_USERS_FILE="${KC_DIR}/test-users.env"
CREATE_TEST_USERS=false
if [[ -z "${LDAP_URL:-}" ]]; then
  CREATE_TEST_USERS=true
  touch "${TEST_USERS_FILE}" && chmod 600 "${TEST_USERS_FILE}"
  # shellcheck disable=SC1090
  source "${TEST_USERS_FILE}"
  rand() { openssl rand -base64 48 | tr -d '/+=' | head -c 20; }
  NEW_ADMIN_PW=false NEW_USER_PW=false
  if [[ -z "${TEST_ADMIN_PASSWORD:-}" ]]; then TEST_ADMIN_PASSWORD="$(rand)"; NEW_ADMIN_PW=true; fi
  if [[ -z "${TEST_USER_PASSWORD:-}" ]]; then TEST_USER_PASSWORD="$(rand)"; NEW_USER_PW=true; fi
  cat > "${TEST_USERS_FILE}" <<EOF
TEST_ADMIN_USER=admin.portal
TEST_ADMIN_PASSWORD=${TEST_ADMIN_PASSWORD}
TEST_USER_USER=user.portal
TEST_USER_PASSWORD=${TEST_USER_PASSWORD}
EOF
fi

q() { printf '%q' "$1"; }

# Everything below runs inside the container; values are passed on stdin, not argv.
{
  echo "set -euo pipefail"
  for v in KEYCLOAK_ADMIN_USER KEYCLOAK_ADMIN_PASSWORD OIDC_CLIENT_SECRET DOMAIN \
           KC_SSO_SESSION_MAX KC_SSO_SESSION_IDLE G_USERS G_PORTAL_ADMINS G_NETBOX_ADMINS G_WIKI_ADMINS \
           LDAP_URL LDAP_VENDOR LDAP_BIND_DN LDAP_BIND_PASSWORD LDAP_USERS_DN LDAP_GROUPS_DN \
           LDAP_USER_FILTER LDAP_START_TLS KERBEROS_ENABLED KERBEROS_REALM KERBEROS_PRINCIPAL \
           CREATE_TEST_USERS TEST_ADMIN_PASSWORD TEST_USER_PASSWORD NEW_ADMIN_PW NEW_USER_PW; do
    echo "${v}=$(q "${!v:-}")"
  done
  cat <<'INNER'
KC=/opt/keycloak/bin/kcadm.sh
CFG=(--config /tmp/kcadm-configure.config)
R=(-r inion)
trap 'rm -f /tmp/kcadm-configure.config' EXIT
kc() { "$KC" "$@" "${CFG[@]}"; }
csv() { kc "$@" --format csv --noquotes; }

kc config credentials --server http://localhost:8080/auth --realm master \
  --user "${KEYCLOAK_ADMIN_USER:-admin}" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

# Realm: session lifetimes
kc update realms/inion \
  -s "ssoSessionMaxLifespan=${KC_SSO_SESSION_MAX:-36000}" \
  -s "ssoSessionIdleTimeout=${KC_SSO_SESSION_IDLE:-1800}"
echo "[keycloak] realm sessions: max=${KC_SSO_SESSION_MAX:-36000}s idle=${KC_SSO_SESSION_IDLE:-1800}s"

# Client rep-portal: secret + URIs for the configured domain
CID="$(csv get clients "${R[@]}" -q clientId=rep-portal --fields id)"
[ -n "$CID" ] || { echo "client rep-portal not found (realm import failed?)" >&2; exit 1; }
kc update "clients/$CID" "${R[@]}" \
  -s "secret=$OIDC_CLIENT_SECRET" \
  -s "rootUrl=https://$DOMAIN" \
  -s "redirectUris=[\"https://$DOMAIN/oauth2/callback\"]" \
  -s "webOrigins=[\"https://$DOMAIN\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=https://$DOMAIN/*" \
  -s 'attributes."pkce.code.challenge.method"=S256'
echo "[keycloak] client rep-portal configured"

# Role groups
# The Keycloak image has no awk: pick "id,name" CSV fields with bash
field_match() { local id val; while IFS=, read -r id val; do [ "$val" = "$1" ] && { echo "$id"; return; }; done; }
group_id() { csv get groups "${R[@]}" --fields id,name | field_match "$1"; }
for g in "$G_USERS" "$G_PORTAL_ADMINS" "$G_NETBOX_ADMINS" "$G_WIKI_ADMINS"; do
  if [ -z "$(group_id "$g")" ]; then
    kc create groups "${R[@]}" -s "name=$g" >/dev/null
    echo "[keycloak] group created: $g"
  fi
done

ensure_user() { # username email first last password new_password groups...
  local u="$1" email="$2" first="$3" last="$4" pw="$5" newpw="$6"; shift 6
  local uid
  uid="$(csv get users "${R[@]}" -q "username=$u" -q exact=true --fields id)"
  if [ -z "$uid" ]; then
    kc create users "${R[@]}" -s "username=$u" -s enabled=true -s "email=$email" -s emailVerified=true \
      -s "firstName=$first" -s "lastName=$last" >/dev/null
    uid="$(csv get users "${R[@]}" -q "username=$u" -q exact=true --fields id)"
    newpw=true
    echo "[keycloak] user created: $u"
  fi
  if [ "$newpw" = true ]; then
    kc set-password "${R[@]}" --userid "$uid" --new-password "$pw"
  fi
  local g gid
  for g in "$@"; do
    gid="$(group_id "$g")"
    kc update "users/$uid/groups/$gid" "${R[@]}" -s realm=inion -s "userId=$uid" -s "groupId=$gid" -n
  done
}

if [ "$CREATE_TEST_USERS" = true ]; then
  ensure_user admin.portal admin.portal@local.inion "Администратор" "Портала" "$TEST_ADMIN_PASSWORD" "$NEW_ADMIN_PW" \
    "$G_USERS" "$G_PORTAL_ADMINS" "$G_NETBOX_ADMINS" "$G_WIKI_ADMINS"
  ensure_user user.portal user.portal@local.inion "Пользователь" "Портала" "$TEST_USER_PASSWORD" "$NEW_USER_PW" \
    "$G_USERS"
fi

# LDAP / AD federation
if [ -n "${LDAP_URL:-}" ]; then
  REALM_ID="$(csv get realms/inion --fields id)"
  case "${LDAP_VENDOR:-ad}" in
    ad)
      VENDOR=ad USERNAME_ATTR=sAMAccountName RDN_ATTR=cn UUID_ATTR=objectGUID
      USER_CLASSES="person, organizationalPerson, user"; GROUP_CLASSES=group
      MEMBER_USER_ATTR=sAMAccountName; GROUP_STRATEGY=LOAD_GROUPS_BY_MEMBER_ATTRIBUTE_RECURSIVELY ;;
    freeipa|aldpro)
      VENDOR=rhds USERNAME_ATTR=uid RDN_ATTR=uid UUID_ATTR=ipaUniqueID
      USER_CLASSES="inetOrgPerson, organizationalPerson"; GROUP_CLASSES=groupOfNames
      MEMBER_USER_ATTR=uid; GROUP_STRATEGY=LOAD_GROUPS_BY_MEMBER_ATTRIBUTE ;;
    *)
      VENDOR=other USERNAME_ATTR=uid RDN_ATTR=uid UUID_ATTR=entryUUID
      USER_CLASSES="inetOrgPerson, organizationalPerson"; GROUP_CLASSES=groupOfNames
      MEMBER_USER_ATTR=uid; GROUP_STRATEGY=LOAD_GROUPS_BY_MEMBER_ATTRIBUTE ;;
  esac
  LDAP_ARGS=(
    -s name=ldap -s providerId=ldap -s providerType=org.keycloak.storage.UserStorageProvider -s "parentId=$REALM_ID"
    -s "config.enabled=[\"true\"]" -s "config.vendor=[\"$VENDOR\"]"
    -s "config.connectionUrl=[\"$LDAP_URL\"]" -s "config.startTls=[\"${LDAP_START_TLS:-false}\"]"
    -s 'config.authType=["simple"]' -s "config.bindDn=[\"$LDAP_BIND_DN\"]"
    -s "config.bindCredential=[\"$LDAP_BIND_PASSWORD\"]"
    -s "config.usersDn=[\"$LDAP_USERS_DN\"]" -s "config.customUserSearchFilter=[\"${LDAP_USER_FILTER:-}\"]"
    -s 'config.searchScope=["2"]' -s 'config.editMode=["READ_ONLY"]'
    -s "config.usernameLDAPAttribute=[\"$USERNAME_ATTR\"]" -s "config.rdnLDAPAttribute=[\"$RDN_ATTR\"]"
    -s "config.uuidLDAPAttribute=[\"$UUID_ATTR\"]" -s "config.userObjectClasses=[\"$USER_CLASSES\"]"
    -s 'config.importEnabled=["true"]' -s 'config.syncRegistrations=["false"]' -s 'config.trustEmail=["true"]'
    -s 'config.pagination=["true"]' -s 'config.fullSyncPeriod=["86400"]' -s 'config.changedSyncPeriod=["3600"]'
  )
  if [ "${KERBEROS_ENABLED:-false}" = true ]; then
    LDAP_ARGS+=(
      -s 'config.allowKerberosAuthentication=["true"]' -s "config.kerberosRealm=[\"$KERBEROS_REALM\"]"
      -s "config.serverPrincipal=[\"$KERBEROS_PRINCIPAL\"]" -s 'config.keyTab=["/etc/keycloak-kerberos/keycloak.keytab"]'
      -s 'config.useKerberosForPasswordAuthentication=["false"]'
    )
  else
    LDAP_ARGS+=(-s 'config.allowKerberosAuthentication=["false"]')
  fi
  LDAP_ID="$(csv get components "${R[@]}" -q name=ldap -q type=org.keycloak.storage.UserStorageProvider --fields id)"
  if [ -z "$LDAP_ID" ]; then
    kc create components "${R[@]}" "${LDAP_ARGS[@]}" >/dev/null
    LDAP_ID="$(csv get components "${R[@]}" -q name=ldap -q type=org.keycloak.storage.UserStorageProvider --fields id)"
    echo "[keycloak] LDAP federation created ($VENDOR, $LDAP_URL)"
  else
    kc update "components/$LDAP_ID" "${R[@]}" "${LDAP_ARGS[@]}"
    echo "[keycloak] LDAP federation updated ($VENDOR, $LDAP_URL)"
  fi

  if [ -n "${LDAP_GROUPS_DN:-}" ]; then
    MAPPER_ARGS=(
      -s name=groups -s providerId=group-ldap-mapper
      -s providerType=org.keycloak.storage.ldap.mappers.LDAPStorageMapper -s "parentId=$LDAP_ID"
      -s "config.\"groups.dn\"=[\"$LDAP_GROUPS_DN\"]" -s 'config."group.name.ldap.attribute"=["cn"]'
      -s "config.\"group.object.classes\"=[\"$GROUP_CLASSES\"]" -s 'config."preserve.group.inheritance"=["false"]'
      -s 'config."membership.ldap.attribute"=["member"]' -s 'config."membership.attribute.type"=["DN"]'
      -s "config.\"membership.user.ldap.attribute\"=[\"$MEMBER_USER_ATTR\"]"
      -s 'config.mode=["READ_ONLY"]' -s "config.\"user.roles.retrieve.strategy\"=[\"$GROUP_STRATEGY\"]"
      -s 'config."drop.non.existing.groups.during.sync"=["false"]' -s 'config."groups.path"=["/"]'
    )
    MAPPER_ID="$(csv get components "${R[@]}" -q name=groups -q "parent=$LDAP_ID" --fields id)"
    if [ -z "$MAPPER_ID" ]; then
      kc create components "${R[@]}" "${MAPPER_ARGS[@]}" >/dev/null
      MAPPER_ID="$(csv get components "${R[@]}" -q name=groups -q "parent=$LDAP_ID" --fields id)"
    else
      kc update "components/$MAPPER_ID" "${R[@]}" "${MAPPER_ARGS[@]}"
    fi
    kc create "user-storage/$LDAP_ID/mappers/$MAPPER_ID/sync?direction=fedToKeycloak" "${R[@]}" >/dev/null || true
    echo "[keycloak] LDAP group mapper synced ($LDAP_GROUPS_DN)"
  fi
  kc create "user-storage/$LDAP_ID/sync?action=triggerFullSync" "${R[@]}" >/dev/null || \
    echo "[keycloak] WARNING: LDAP full sync failed — check LDAP_* settings" >&2

  # Kerberos in the browser flow: ALTERNATIVE when enabled, DISABLED otherwise
  KRB_REQ=DISABLED; [ "${KERBEROS_ENABLED:-false}" = true ] && KRB_REQ=ALTERNATIVE
  KRB_EXEC="$(csv get authentication/flows/browser/executions "${R[@]}" --fields id,providerId | field_match auth-spnego)"
  if [ -n "$KRB_EXEC" ]; then
    kc update authentication/flows/browser/executions "${R[@]}" -b "{\"id\":\"$KRB_EXEC\",\"requirement\":\"$KRB_REQ\"}"
    echo "[keycloak] Kerberos in browser flow: $KRB_REQ"
  fi
fi
echo "[keycloak] configuration done"
INNER
} | docker exec -i keycloak bash -s

# Record test users in the credentials summary
if [[ "${CREATE_TEST_USERS}" == true ]]; then
  CREDS="$(ls -1t "${SERVICES_ROOT}"/credentials-*.txt 2>/dev/null | head -1 || true)"
  if [[ -n "${CREDS}" ]]; then
    grep -v -e '^SSO test ' "${CREDS}" > "${CREDS}.tmp" || true
    {
      echo "SSO test admin (portal/netbox/wiki admin): admin.portal / ${TEST_ADMIN_PASSWORD}"
      echo "SSO test user  (portal user, read-only NetBox): user.portal / ${TEST_USER_PASSWORD}"
    } >> "${CREDS}.tmp"
    mv "${CREDS}.tmp" "${CREDS}" && chmod 600 "${CREDS}"
  fi
fi
