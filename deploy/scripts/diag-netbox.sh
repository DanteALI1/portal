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

echo "===== curl login (container / host) ====="
docker exec netbox curl -sS -o /dev/null -w 'container:%{http_code} time=%{time_total}\n' \
  http://127.0.0.1:8080/netbox/login/ 2>&1 || echo 'container curl failed'
curl -sS -o /dev/null -w 'host:%{http_code} time=%{time_total}\n' \
  http://127.0.0.1:8000/netbox/login/ 2>&1 || echo 'host curl failed'

echo "===== docker logs netbox (tail 60) ====="
docker logs --tail=60 netbox 2>&1 || true

echo "===== docker logs netbox-worker (tail 40) ====="
docker logs --tail=40 netbox-worker 2>&1 || true

echo "===== done ====="
