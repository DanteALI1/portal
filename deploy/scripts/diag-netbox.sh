#!/usr/bin/env bash
# Collect NetBox stack diagnostics (paste the full output when asking for help).
# Usage: sudo bash deploy/scripts/diag-netbox.sh
set -euo pipefail

ROOT="${SERVICES_ROOT:-/opt/services}/netbox"
echo "===== host ====="
hostname -f 2>/dev/null || hostname
date -Is
echo "===== compose file healthcheck ====="
if [[ -f "${ROOT}/docker-compose.yml" ]]; then
  awk '/container_name: netbox$/,/^  [a-z]/{if (/healthcheck:/||/test:|start_period:|timeout:|interval:|retries:/) print}' \
    "${ROOT}/docker-compose.yml" || true
  grep -n 'timeout:\|start_period:\|netbox-worker\|condition: service_healthy' \
    "${ROOT}/docker-compose.yml" || true
else
  echo "MISSING ${ROOT}/docker-compose.yml"
fi

echo "===== docker compose ps ====="
if [[ -d "${ROOT}" ]]; then
  (cd "${ROOT}" && docker compose ps -a) || true
fi

echo "===== inspect health ====="
for c in netbox netbox-worker netbox-postgres netbox-redis netbox-redis-cache; do
  docker inspect -f \
    '{{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}} fails={{.State.Health.FailingStreak}}{{else}}n/a{{end}} started={{.State.StartedAt}}' \
    "${c}" 2>/dev/null || echo "${c}: missing"
done

echo "===== netbox health log (last probes) ====="
docker inspect -f '{{range .State.Health.Log}}{{.Start}} exit={{.ExitCode}} out={{printf "%.120s" .Output}}{{println}}{{end}}' netbox 2>/dev/null || true

echo "===== processes inside netbox ====="
docker exec netbox ps aux 2>&1 || echo 'ps failed'
if docker exec netbox sh -c 'ps -eo args= | grep -q "[m]anage.py migrate"' 2>/dev/null; then
  echo "NOTE: manage.py migrate still running — :8080 will stay down until it finishes."
  echo "      Do not docker compose down -v / recreate volumes; just wait and re-check."
fi
echo "===== listen ports inside netbox ====="
docker exec netbox sh -c 'ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true' 2>&1 || true
echo "===== OOM / restarts ====="
docker inspect -f 'OOM={{.State.OOMKilled}} restarts={{.RestartCount}} error={{.State.Error}} pid={{.State.Pid}}' netbox 2>/dev/null || true
echo "===== memory / disk ====="
free -h 2>/dev/null || true
df -h /var/lib/docker /opt/services 2>/dev/null || df -h

echo "===== curl login (container / host) ====="
docker exec netbox curl -sS -o /dev/null -w 'container:%{http_code} time=%{time_total}\n' \
  http://127.0.0.1:8080/netbox/login/ 2>&1 || echo 'container curl failed'
curl -sS -o /dev/null -w 'host:%{http_code} time=%{time_total}\n' \
  http://127.0.0.1:8000/netbox/login/ 2>&1 || echo 'host curl failed'

echo "===== docker logs netbox (tail 100) ====="
docker logs --tail=100 netbox 2>&1 || true
echo "===== grep granian / error in full log ====="
docker logs netbox 2>&1 | grep -E 'Starting granian|Listening at|Error|Traceback|Killed|OOM|GRANIAN' | tail -40 || true

echo "===== docker logs netbox-worker (tail 40) ====="
docker logs --tail=40 netbox-worker 2>&1 || true

echo "===== done ====="
