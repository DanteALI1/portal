#!/usr/bin/env bash
# =============================================================================
# REP Portal — полное удаление всего, что ставит install.sh / bootstrap.sh.
#
# Уничтожает данные NetBox, Вики, Keycloak, портала, SSO-сессии и бэкапы.
#
# Использование (из корня репозитория или из /opt/services/scripts):
#   sudo bash deploy/scripts/uninstall.sh --yes
#   sudo bash deploy/scripts/uninstall.sh --yes --purge
#   sudo bash deploy/scripts/uninstall.sh --yes --purge --remove-src
#
# Флаги:
#   --yes          обязательно: подтверждение разрушительного действия
#   --purge        также снять Docker CE и nginx, вернуть podman-docker,
#                  убрать firewall http/https, сбросить SELinux-булевы
#                  и /etc/docker (состояние «почти чистого» RED OS)
#   --remove-src   удалить каталог исходников bootstrap (/opt/portal-src)
#   --keep-certs   не удалять /etc/nginx/ssl (свои сертификаты)
#   -h|--help      справка
#
# Без --purge остаются: пакеты Docker/nginx, firewalld, git/curl и т.п.,
# hostname и SELinux-булевы (их могли поставить не только для портала).
# =============================================================================
set -euo pipefail

SERVICES_ROOT="${SERVICES_ROOT:-/opt/services}"
CHECKOUT_DIR="${CHECKOUT_DIR:-/opt/portal-src}"
YES=false
PURGE=false
REMOVE_SRC=false
KEEP_CERTS=false

usage() {
  awk 'NR==1{next} /^[^#]/{exit} {sub(/^# ?/,""); print}' "$0"
}

for a in "$@"; do
  case "$a" in
    --yes) YES=true ;;
    --purge) PURGE=true ;;
    --remove-src) REMOVE_SRC=true ;;
    --keep-certs) KEEP_CERTS=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || { echo "Run as root: sudo bash $0 --yes" >&2; exit 1; }
${YES} || {
  echo "This deletes ALL portal data (NetBox, Wiki, Keycloak, portal, backups)." >&2
  echo "Re-run with --yes to confirm. Optional: --purge --remove-src --keep-certs" >&2
  exit 1
}

log() { echo -e "\n==> [uninstall] $*\n"; }
ok()  { echo "  [ok] $*"; }
skip(){ echo "  [skip] $*"; }

# DOMAIN: from sso.env before we wipe SERVICES_ROOT, else default.
DOMAIN=""
if [[ -f "${SERVICES_ROOT}/sso.env" ]]; then
  DOMAIN="$(grep -m1 '^DOMAIN=' "${SERVICES_ROOT}/sso.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
fi
DOMAIN="${DOMAIN:-rep.local.inion}"

UNITS=(portal mediawiki netbox oauth2-proxy keycloak)
COMPOSE_SVCS=(portal mediawiki netbox oauth2-proxy keycloak)
# Known container_name values from deploy/*/docker-compose.yml (fallback if compose files gone)
CONTAINERS=(
  portal
  mediawiki wiki-mariadb
  netbox netbox-worker netbox-postgres netbox-redis netbox-redis-cache
  oauth2-proxy sso-redis
  keycloak keycloak-postgres
)
TOTAL=8
${PURGE} && TOTAL=$((TOTAL + 1))
${REMOVE_SRC} && TOTAL=$((TOTAL + 1))
STEP=0
step() { STEP=$((STEP + 1)); log "${STEP}/${TOTAL} $*"; }

have_docker() {
  command -v docker >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1 \
    && ! rpm -q podman-docker >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
step "Stop and remove systemd units"
for u in "${UNITS[@]}"; do
  systemctl disable --now "${u}.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/${u}.service"
  ok "${u}.service"
done
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed 2>/dev/null || true

# ---------------------------------------------------------------------------
step "Stop Compose stacks and remove volumes"
if have_docker; then
  for svc in "${COMPOSE_SVCS[@]}"; do
    if [[ -f "${SERVICES_ROOT}/${svc}/docker-compose.yml" ]]; then
      (cd "${SERVICES_ROOT}/${svc}" && docker compose down -v --remove-orphans) 2>/dev/null || true
      ok "compose down -v: ${svc}"
    else
      skip "no compose file for ${svc}"
    fi
  done
  # Fallback: force-remove named containers / hanging volumes if compose was already gone
  for c in "${CONTAINERS[@]}"; do
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "${c}"; then
      docker rm -f "${c}" 2>/dev/null || true
      ok "removed leftover container ${c}"
    fi
  done
else
  skip "Docker Engine not available (or podman-docker shim)"
fi

# ---------------------------------------------------------------------------
step "Remove Docker network and unused images/volumes"
if have_docker; then
  docker network rm services-network 2>/dev/null && ok "services-network" || skip "services-network already gone"
  # Drop dangling + unused images/volumes left by this stack (dedicated host assumed)
  docker system prune -af --volumes >/dev/null 2>&1 || true
  ok "docker system prune -af --volumes"
else
  skip "Docker Engine not available"
fi

# ---------------------------------------------------------------------------
step "Remove backup cron job"
if command -v crontab >/dev/null 2>&1; then
  # Matches both /opt/services/scripts/backup.sh and any SERVICES_ROOT path
  { crontab -l 2>/dev/null | grep -vE "(${SERVICES_ROOT}|/opt/services)/scripts/backup\.sh" || true; } | crontab - || true
  ok "crontab cleaned"
else
  skip "crontab not installed"
fi

# ---------------------------------------------------------------------------
step "Remove /opt/services, logs and credentials"
rm -rf "${SERVICES_ROOT}" /var/log/services
ok "removed ${SERVICES_ROOT} and /var/log/services"

# ---------------------------------------------------------------------------
step "Remove Nginx portal configs, snippets and error page"
rm -f /etc/nginx/conf.d/portal.conf \
      /etc/nginx/conf.d/rep.local.inion.conf \
      /etc/nginx/conf.d/"${DOMAIN}".conf 2>/dev/null || true
rm -rf /etc/nginx/rep /usr/share/nginx/rep
# Access/error logs written by the portal vhost
rm -f /var/log/nginx/"${DOMAIN}".access.log \
      /var/log/nginx/"${DOMAIN}".error.log \
      /var/log/nginx/rep.local.inion.access.log \
      /var/log/nginx/rep.local.inion.error.log 2>/dev/null || true
if ! ${KEEP_CERTS}; then
  rm -rf /etc/nginx/ssl
  ok "SSL certificates removed (/etc/nginx/ssl)"
else
  skip "keeping /etc/nginx/ssl (--keep-certs)"
fi
if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || true
    ok "nginx reloaded"
  else
    # Empty conf.d is fine; if nginx -t still fails, leave it for --purge
    systemctl reload nginx 2>/dev/null || true
    skip "nginx -t reported issues (will be fixed by --purge if used)"
  fi
fi

# ---------------------------------------------------------------------------
step "Remove DOMAIN from /etc/hosts"
if [[ -f /etc/hosts ]]; then
  # Only the loopback line install.sh adds: "127.0.0.1 <DOMAIN>"
  if grep -qE "^[[:space:]]*127\.0\.0\.1[[:space:]]+${DOMAIN}([[:space:]]|\$)" /etc/hosts; then
    sed -i -E "/^[[:space:]]*127\.0\.0\.1[[:space:]]+${DOMAIN}([[:space:]]|\$)/d" /etc/hosts
    ok "removed 127.0.0.1 ${DOMAIN} from /etc/hosts"
  else
    skip "no 127.0.0.1 ${DOMAIN} entry in /etc/hosts"
  fi
fi

# ---------------------------------------------------------------------------
step "Summary of host tweaks left in place (unless --purge)"
echo "  hostname:     $(hostname 2>/dev/null || echo '?')  (install may have set it to ${DOMAIN})"
echo "  firewalld:    http/https may still be allowed"
echo "  SELinux:      httpd_can_network_connect / httpd_read_user_content may stay on"
echo "  base packages: git curl wget vim openssl firewalld rsync (not removed)"
echo "  Use --purge to revert Docker/nginx packages, firewall, SELinux booleans and /etc/docker."

# ---------------------------------------------------------------------------
if ${PURGE}; then
  step "Purge Docker CE, Nginx; restore podman-docker; revert firewall & SELinux"

  systemctl disable --now docker.socket docker.service containerd.service nginx.service 2>/dev/null || true

  dnf remove -y \
    docker-ce docker-ce-cli docker-compose docker-compose-switch \
    containerd containerd.io docker-compose-plugin \
    'nginx*' 2>/dev/null || true

  rm -rf /var/lib/docker /var/lib/containerd /etc/docker /etc/nginx
  rm -f /etc/yum.repos.d/docker-ce.repo \
        /etc/yum.repos.d/docker-ce.repo.rpmnew 2>/dev/null || true

  # Restore the Red OS default docker shim if available
  dnf install -y podman-docker >/dev/null 2>&1 && ok "podman-docker restored" || skip "podman-docker not available"

  # Firewall: remove http/https opened by install.sh
  if systemctl is-active --quiet firewalld 2>/dev/null || command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --remove-service=http 2>/dev/null || true
    firewall-cmd --permanent --remove-service=https 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    ok "firewalld: removed http/https services"
  fi

  # SELinux booleans set by install.sh (best-effort; may have been on before)
  if command -v getenforce >/dev/null && [[ "$(getenforce)" != "Disabled" ]]; then
    setsebool -P httpd_can_network_connect 0 2>/dev/null || true
    setsebool -P httpd_read_user_content 0 2>/dev/null || true
    ok "SELinux httpd_* booleans reset to 0"
  fi
fi

# ---------------------------------------------------------------------------
if ${REMOVE_SRC}; then
  step "Remove bootstrap source checkout (${CHECKOUT_DIR})"
  if [[ -d "${CHECKOUT_DIR}" ]]; then
    # Safe on Linux even if this script lives under CHECKOUT_DIR: bash already
    # holds the open inode; the tree is unlinked after the script finishes reading.
    rm -rf "${CHECKOUT_DIR}"
    ok "removed ${CHECKOUT_DIR}"
  else
    skip "${CHECKOUT_DIR} not present"
  fi
fi

cat <<EOF

============================================================
UNINSTALL COMPLETE
============================================================
Removed:
  - systemd units: ${UNITS[*]}
  - Docker Compose stacks + volumes + services-network
  - ${SERVICES_ROOT} (configs, .env, credentials, backups, data)
  - /var/log/services
  - Nginx portal vhost, snippets, 403 page$({ ${KEEP_CERTS} && echo " (certs kept)"; } || echo ", SSL certs")
  - cron backup job
  - /etc/hosts entry for ${DOMAIN}
$(${PURGE} && echo "  - Docker CE + nginx packages; podman-docker restored
  - firewalld http/https; SELinux httpd_* booleans
  - /var/lib/docker, /etc/docker, /etc/nginx")
$(${REMOVE_SRC} && echo "  - source checkout ${CHECKOUT_DIR}")

Reinstall:
  sudo bash deploy/scripts/install.sh
  # or empty host:
  # curl -fsSL …/bootstrap.sh | sudo DOMAIN=${DOMAIN} bash
============================================================
EOF
