#!/usr/bin/env bash
# Remove the REP portal stack from this server. DESTROYS ALL DATA (NetBox, Wiki, Keycloak, portal).
#   sudo bash uninstall.sh --yes            containers, volumes, images, configs, units, cron, certs
#   sudo bash uninstall.sh --yes --purge    also remove Docker CE and Nginx packages and restore
#                                           podman-docker (state of a fresh Red OS host)
set -euo pipefail

SERVICES_ROOT="${SERVICES_ROOT:-/opt/services}"
YES=false PURGE=false
for a in "$@"; do
  case "$a" in
    --yes) YES=true ;;
    --purge) PURGE=true ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
${YES} || { echo "This deletes ALL portal data. Re-run with --yes to confirm." >&2; exit 1; }

log() { echo "[uninstall] $*"; }

UNITS=(portal mediawiki netbox oauth2-proxy keycloak)
for u in "${UNITS[@]}"; do systemctl disable --now "${u}.service" 2>/dev/null || true; done
for u in "${UNITS[@]}"; do rm -f "/etc/systemd/system/${u}.service"; done
systemctl daemon-reload
log "systemd units removed"

if command -v docker >/dev/null && docker info >/dev/null 2>&1 && ! rpm -q podman-docker >/dev/null 2>&1; then
  for svc in portal mediawiki netbox oauth2-proxy keycloak; do
    if [[ -f "${SERVICES_ROOT}/${svc}/docker-compose.yml" ]]; then
      (cd "${SERVICES_ROOT}/${svc}" && docker compose down -v --remove-orphans 2>/dev/null) || true
    fi
  done
  docker network rm services-network 2>/dev/null || true
  docker system prune -af --volumes >/dev/null
  log "containers, volumes, images and network removed"
fi

{ crontab -l 2>/dev/null | grep -v "${SERVICES_ROOT}/scripts/backup.sh" || true; } | crontab -
rm -rf "${SERVICES_ROOT}" /var/log/services
rm -rf /etc/nginx/conf.d/portal.conf /etc/nginx/conf.d/rep.local.inion.conf \
  /etc/nginx/rep /usr/share/nginx/rep /etc/nginx/ssl
if systemctl is-active --quiet nginx; then systemctl reload nginx || true; fi
log "configs, certificates, credentials and cron removed"

if ${PURGE}; then
  systemctl disable --now docker.socket docker.service containerd.service nginx.service 2>/dev/null || true
  dnf remove -y docker-ce docker-ce-cli docker-compose docker-compose-switch containerd containerd.io \
    docker-compose-plugin 'nginx*' 2>/dev/null || true
  rm -rf /var/lib/docker /var/lib/containerd /etc/docker /etc/nginx
  dnf install -y podman-docker >/dev/null 2>&1 || true
  log "Docker CE and Nginx removed, podman-docker restored"
fi
log "done"
