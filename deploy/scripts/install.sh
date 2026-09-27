#!/usr/bin/env bash
# Full install of REP unified portal on Red OS 8 / RHEL 8 compatible hosts.
# Usage (from repo root, as a user with sudo):
#   sudo bash deploy/scripts/install.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICES_ROOT="${SERVICES_ROOT:-/opt/services}"
DOMAIN="${DOMAIN:-rep.local.inion}"

log() { echo -e "\n==> $*\n"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

log "0/10 Preflight"
command -v dnf >/dev/null || { echo "dnf required (Red OS / RHEL family)"; exit 1; }

log "1/10 Packages & hostname"
dnf install -y git curl wget vim openssl firewalld || true
hostnamectl set-hostname "${DOMAIN}" || true
grep -q "${DOMAIN}" /etc/hosts || echo "127.0.0.1 ${DOMAIN}" >> /etc/hosts

log "2/10 Firewall"
if systemctl is-active --quiet firewalld || systemctl enable --now firewalld; then
  firewall-cmd --permanent --add-service=http || true
  firewall-cmd --permanent --add-service=https || true
  firewall-cmd --reload || true
fi

log "3/10 SELinux booleans"
if command -v getenforce >/dev/null && [[ "$(getenforce)" != "Disabled" ]]; then
  setsebool -P httpd_can_network_connect 1 || true
  setsebool -P httpd_read_user_content 1 || true
fi

log "4/10 Docker Engine"
# On Red OS `docker` may be the podman-docker shim — treat it as "no Docker".
if ! command -v docker >/dev/null || rpm -q podman-docker >/dev/null 2>&1; then
  dnf remove -y podman-docker 2>/dev/null || true
  # Red OS ships docker-ce and docker-compose (cli plugin) in its own repos.
  if ! dnf install -y docker-ce docker-ce-cli docker-compose; then
    dnf remove -y docker docker-client docker-client-latest docker-common \
      docker-latest docker-latest-logrotate docker-logrotate docker-engine \
      podman podman-docker runc 2>/dev/null || true
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
    dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
fi
docker compose version

mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "storage-driver": "overlay2",
  "live-restore": true
}
EOF
systemctl enable --now docker

docker network inspect services-network >/dev/null 2>&1 || \
  docker network create --driver bridge --subnet 172.28.0.0/16 --gateway 172.28.0.1 services-network

log "5/10 Directory layout"
mkdir -p \
  "${SERVICES_ROOT}"/{netbox,mediawiki,portal/data,configs,backups,scripts} \
  /var/log/services
chmod 700 "${SERVICES_ROOT}/backups"

# Sync deploy assets
rsync -a --delete --exclude .env "${REPO_ROOT}/deploy/netbox/" "${SERVICES_ROOT}/netbox/"
rsync -a --delete --exclude .env --exclude LocalSettings.php --exclude LocalSettings.generated.php "${REPO_ROOT}/deploy/mediawiki/" "${SERVICES_ROOT}/mediawiki/"
rsync -a "${REPO_ROOT}/deploy/scripts/" "${SERVICES_ROOT}/scripts/"
# Portal application sources
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .env \
  "${REPO_ROOT}/portal/" "${SERVICES_ROOT}/portal/"
cp "${REPO_ROOT}/deploy/portal/docker-compose.yml" "${SERVICES_ROOT}/portal/docker-compose.yml"
chmod +x "${SERVICES_ROOT}/scripts/"*.sh

log "6/10 Nginx + SSL"
dnf install -y nginx
bash "${SERVICES_ROOT}/scripts/generate-ssl.sh" /etc/nginx/ssl "${DOMAIN}"
install -m 644 "${REPO_ROOT}/deploy/nginx/rep.local.inion.conf" \
  /etc/nginx/conf.d/rep.local.inion.conf
# Disable default server if it conflicts
rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "7/10 Generate secrets"
bash "${SERVICES_ROOT}/scripts/gen-env.sh" "${SERVICES_ROOT}"

log "8/10 Start NetBox"
cd "${SERVICES_ROOT}/netbox"
docker compose pull
docker compose up -d
echo "Waiting for NetBox health (up to ~5 min)..."
for i in $(seq 1 60); do
  if curl -kfsS "https://127.0.0.1/netbox/login/" -H "Host: ${DOMAIN}" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:8000/netbox/login/" >/dev/null 2>&1; then
    echo "NetBox is up"
    break
  fi
  sleep 5
done

log "9/10 Start MediaWiki"
bash "${SERVICES_ROOT}/scripts/install-wiki.sh"

log "10/10 Start Portal + systemd + backup cron"
cd "${SERVICES_ROOT}/portal"
docker compose up -d --build

install -m 644 "${REPO_ROOT}/deploy/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable netbox.service mediawiki.service portal.service

# Cron backup at 03:00
CRON_LINE="0 3 * * * ${SERVICES_ROOT}/scripts/backup.sh >> /var/log/services/backup.log 2>&1"
{ crontab -l 2>/dev/null | grep -v backup.sh || true; echo "${CRON_LINE}"; } | crontab -

systemctl reload nginx || systemctl restart nginx

log "Smoke checks"
set +e
curl -kI "https://${DOMAIN}/health"
curl -kI "https://${DOMAIN}/"
curl -kI "https://${DOMAIN}/api/health"
curl -kI "https://${DOMAIN}/netbox/"
curl -kI "https://${DOMAIN}/wiki/"
set -e

cat <<EOF

============================================================
INSTALL COMPLETE
============================================================
Portal:   https://${DOMAIN}/
NetBox:   https://${DOMAIN}/netbox/
Wiki:     https://${DOMAIN}/wiki/
Health:   https://${DOMAIN}/health

Credentials: ${SERVICES_ROOT}/credentials-*.txt
Configs:     ${SERVICES_ROOT}/

DNS: ensure ${DOMAIN} points to this server IP on clients.
SSL: self-signed by default — replace under /etc/nginx/ssl/ for production.
============================================================
EOF
