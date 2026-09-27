#!/usr/bin/env bash
# Generate a self-signed certificate for lab / internal use.
# For production, replace with corporate CA-signed certs.
set -euo pipefail

SSL_DIR="${1:-/etc/nginx/ssl}"
DOMAIN="${2:-rep.local.inion}"
DAYS="${3:-825}"

sudo mkdir -p "${SSL_DIR}"
sudo chmod 700 "${SSL_DIR}"

if [[ -f "${SSL_DIR}/${DOMAIN}.crt" && -f "${SSL_DIR}/${DOMAIN}.key" ]]; then
  echo "[ssl] certificates already exist in ${SSL_DIR}"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

openssl req -x509 -nodes -newkey rsa:2048 -days "${DAYS}" \
  -keyout "${TMP}/${DOMAIN}.key" \
  -out "${TMP}/${DOMAIN}.crt" \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=INION/OU=IT/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"

sudo install -m 600 "${TMP}/${DOMAIN}.key" "${SSL_DIR}/${DOMAIN}.key"
sudo install -m 644 "${TMP}/${DOMAIN}.crt" "${SSL_DIR}/${DOMAIN}.crt"
sudo chown root:root "${SSL_DIR}/${DOMAIN}.key" "${SSL_DIR}/${DOMAIN}.crt"

echo "[ssl] created ${SSL_DIR}/${DOMAIN}.{crt,key}"
echo "[ssl] Install the CA/cert on client machines or accept the browser warning."
