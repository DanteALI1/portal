#!/usr/bin/env bash
# Install TLS material for nginx (also mounted as CA trust for oauth2-proxy / portal).
#
# Usage:
#   generate-ssl.sh [SSL_DIR] [DOMAIN]
#
# How certificates are chosen (first match wins):
#   1. SSL_CERT + SSL_KEY already set in the environment  → install those files
#   2. SSL_MODE=selfsigned                               → generate a lab self-signed cert
#   3. SSL_MODE=own                                      → require SSL_CERT/SSL_KEY (fail if missing)
#   4. Interactive TTY available                         → ask the operator for paths (or self-signed)
#   5. Non-interactive / no TTY                          → self-signed (CI / unattended)
#
# Optional:
#   SSL_CHAIN=/path/to/chain.pem   — appended after the server cert into the installed .crt
#   SSL_FORCE=1                    — replace existing ${DOMAIN}.{crt,key} instead of keeping them
#
# The installed .crt MUST contain the server certificate plus the chain up to (and including)
# the issuing CA that oauth2-proxy and the portal should trust.
set -euo pipefail

SSL_DIR="${1:-/etc/nginx/ssl}"
DOMAIN="${2:-rep.local.inion}"
DAYS="${3:-825}"
SSL_MODE="${SSL_MODE:-}"          # own | selfsigned | (empty = auto)
SSL_FORCE="${SSL_FORCE:-0}"
CRT_DST="${SSL_DIR}/${DOMAIN}.crt"
KEY_DST="${SSL_DIR}/${DOMAIN}.key"

# Prefer a real console even when stdin is a pipe (curl … | sudo bash).
_tty() { [[ -r /dev/tty && -w /dev/tty ]]; }
_ask() { # prompt -> answer on stdout
  local prompt="$1" answer=""
  if _tty; then
    printf '%s' "${prompt}" > /dev/tty
    IFS= read -r answer < /dev/tty || true
  elif [[ -t 0 ]]; then
    read -r -p "${prompt}" answer || true
  fi
  printf '%s' "${answer}"
}

mkdir -p "${SSL_DIR}"
chmod 700 "${SSL_DIR}"

# --- helpers ---------------------------------------------------------------

_is_cert() { openssl x509 -in "$1" -noout >/dev/null 2>&1; }
_is_key()  { openssl pkey -in "$1" -noout >/dev/null 2>&1; }

_cert_key_match() {
  local crt="$1" key="$2" crt_pub key_pub
  crt_pub="$(openssl x509 -in "${crt}" -pubkey -noout 2>/dev/null | openssl md5 | awk '{print $NF}')"
  key_pub="$(openssl pkey -in "${key}" -pubout 2>/dev/null | openssl md5 | awk '{print $NF}')"
  [[ -n "${crt_pub}" && "${crt_pub}" == "${key_pub}" ]]
}

_cert_covers_domain() {
  local crt="$1" text sans cn
  text="$(openssl x509 -in "${crt}" -noout -text 2>/dev/null || true)"
  sans="$(printf '%s\n' "${text}" | awk '/Subject Alternative Name/{getline; print}' || true)"
  cn="$(openssl x509 -in "${crt}" -noout -subject -nameopt RFC2253 2>/dev/null \
        | sed -n 's/.*CN=\([^,]*\).*/\1/p' || true)"
  printf '%s\n' "${sans}" | grep -Fq "DNS:${DOMAIN}" && return 0
  [[ "${cn}" == "${DOMAIN}" ]] && return 0
  return 1
}

_chain_depth() {
  # Number of PEM certificates in the file (server + intermediates + root).
  local n
  n="$(grep -c -- 'BEGIN CERTIFICATE' "$1" 2>/dev/null || true)"
  echo "${n:-0}"
}

_validate_pair() {
  local crt="$1" key="$2"
  if [[ ! -f "${crt}" ]]; then
    echo "[ssl] ERROR: certificate not found: ${crt}" >&2
    return 1
  fi
  if [[ ! -f "${key}" ]]; then
    echo "[ssl] ERROR: private key not found: ${key}" >&2
    return 1
  fi
  if ! _is_cert "${crt}"; then
    echo "[ssl] ERROR: not a PEM X.509 certificate: ${crt}" >&2
    return 1
  fi
  if ! _is_key "${key}"; then
    echo "[ssl] ERROR: not a PEM private key: ${key}" >&2
    return 1
  fi
  if ! _cert_key_match "${crt}" "${key}"; then
    echo "[ssl] ERROR: certificate and private key do not match" >&2
    return 1
  fi
  if ! openssl x509 -in "${crt}" -noout -checkend 0 >/dev/null 2>&1; then
    echo "[ssl] WARNING: certificate appears expired." >&2
  fi
  if ! _cert_covers_domain "${crt}"; then
    echo "[ssl] WARNING: certificate does not list DNS:${DOMAIN} in SAN (or CN)." >&2
    echo "[ssl]          SSO is bound to this name — browsers will warn or refuse the site." >&2
  fi
  local depth subject issuer
  depth="$(_chain_depth "${crt}")"
  subject="$(openssl x509 -in "${crt}" -noout -subject 2>/dev/null || true)"
  issuer="$(openssl x509 -in "${crt}" -noout -issuer 2>/dev/null || true)"
  # Self-signed is a single cert and is fine; warn only for CA-signed leaf alone.
  if [[ "${depth}" -lt 2 && "${subject}" != "${issuer}" ]]; then
    echo "[ssl] WARNING: ${crt} has only the leaf certificate." >&2
    echo "[ssl]          Put the full chain (leaf + intermediates + root) into this file," >&2
    echo "[ssl]          or pass SSL_CHAIN=/path/to/ca-bundle.pem — oauth2-proxy/portal need it." >&2
  fi
  return 0
}

_build_fullchain() {
  # Writes leaf (+ optional SSL_CHAIN) into $1 (temp path).
  local out="$1" leaf="$2" chain="${3:-}"
  cat "${leaf}" > "${out}"
  if [[ -n "${chain}" ]]; then
    [[ -f "${chain}" ]] || { echo "[ssl] ERROR: SSL_CHAIN not found: ${chain}" >&2; return 1; }
    # Avoid duplicating if the leaf file already embeds the chain.
    if [[ "$(_chain_depth "${leaf}")" -lt 2 ]]; then
      printf '\n' >> "${out}"
      cat "${chain}" >> "${out}"
    else
      echo "[ssl] leaf already contains a chain — SSL_CHAIN ignored"
    fi
  fi
}

_install_pair() {
  local leaf="$1" key="$2" chain="${3:-}"
  local tmp
  tmp="$(mktemp -d)"
  if ! _build_fullchain "${tmp}/fullchain.crt" "${leaf}" "${chain}"; then
    rm -rf "${tmp}"
    return 1
  fi
  if ! _validate_pair "${tmp}/fullchain.crt" "${key}"; then
    rm -rf "${tmp}"
    return 1
  fi

  install -m 644 "${tmp}/fullchain.crt" "${CRT_DST}"
  install -m 600 "${key}" "${KEY_DST}"
  chown root:root "${CRT_DST}" "${KEY_DST}" 2>/dev/null || true
  rm -rf "${tmp}"

  echo "[ssl] installed ${CRT_DST} and ${KEY_DST}"
  openssl x509 -in "${CRT_DST}" -noout -subject -issuer -dates 2>/dev/null \
    | sed 's/^/[ssl] /' || true
  echo "[ssl] chain depth: $(_chain_depth "${CRT_DST}") (leaf + intermediates + root)"
}

_generate_selfsigned() {
  local tmp san
  tmp="$(mktemp -d)"

  # SAN: the domain, localhost and every IPv4 of this server. oauth2-proxy and the portal
  # verify this certificate (it is their CA file), so the names must match.
  san="DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"
  for ip in $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v ':' | grep -v '^127\.' || true); do
    san="${san},IP:${ip}"
  done

  openssl req -x509 -nodes -newkey rsa:2048 -days "${DAYS}" \
    -keyout "${tmp}/${DOMAIN}.key" \
    -out "${tmp}/${DOMAIN}.crt" \
    -subj "/C=RU/ST=Moscow/L=Moscow/O=INION/OU=IT/CN=${DOMAIN}" \
    -addext "subjectAltName=${san}"

  install -m 600 "${tmp}/${DOMAIN}.key" "${KEY_DST}"
  install -m 644 "${tmp}/${DOMAIN}.crt" "${CRT_DST}"
  chown root:root "${KEY_DST}" "${CRT_DST}" 2>/dev/null || true
  rm -rf "${tmp}"

  echo "[ssl] created self-signed ${CRT_DST} / ${KEY_DST} (SAN: ${san})"
  echo "[ssl] Install the CA/cert on client machines or accept the browser warning."
}

_prompt_own_certs() {
  local cert_path="" key_path="" chain_path=""
  echo ""
  echo "[ssl] Укажите пути к своим сертификатам для ${DOMAIN}."
  echo "[ssl] В .crt/.pem сервера желательна полная цепочка (или отдельно SSL_CHAIN)."
  echo ""
  while true; do
    cert_path="$(_ask "  Путь к сертификату (fullchain.crt / .pem): ")"
    key_path="$(_ask  "  Путь к приватному ключу (.key / .pem): ")"
    chain_path="$(_ask "  Путь к цепочке УЦ (Enter — пропустить): ")"
    if [[ -z "${cert_path}" || -z "${key_path}" ]]; then
      echo "[ssl] Нужны оба файла: сертификат и ключ." >&2
      continue
    fi
    # Expand leading ~ if the operator typed it literally.
    cert_path="${cert_path/#\~/$HOME}"
    key_path="${key_path/#\~/$HOME}"
    chain_path="${chain_path/#\~/$HOME}"
    if _install_pair "${cert_path}" "${key_path}" "${chain_path}"; then
      return 0
    fi
    echo "[ssl] Попробуйте снова или прервите установку (Ctrl+C)." >&2
  done
}

_prompt_mode() {
  local choice=""
  echo ""
  echo "[ssl] Сертификат TLS для https://${DOMAIN}/"
  echo "  1) Указать свои сертификаты (рекомендуется для эксплуатации)"
  echo "  2) Выпустить самоподписанный (лаборатория / тест)"
  echo ""
  choice="$(_ask "Выберите [1/2] (по умолчанию 1): ")"
  choice="${choice:-1}"
  case "${choice}" in
    2|s|S|self|selfsigned) _generate_selfsigned ;;
    *)                     _prompt_own_certs ;;
  esac
}

# --- main ------------------------------------------------------------------

if [[ -f "${CRT_DST}" && -f "${KEY_DST}" && "${SSL_FORCE}" != "1" ]]; then
  echo "[ssl] certificates already exist in ${SSL_DIR} (set SSL_FORCE=1 to replace)"
  # Still sanity-check what is on disk so a broken pair fails the install early.
  _validate_pair "${CRT_DST}" "${KEY_DST}" || {
    echo "[ssl] ERROR: existing pair is invalid — fix files or rerun with SSL_FORCE=1" >&2
    exit 1
  }
  exit 0
fi

# Explicit env paths always win (also covers SSL_MODE=own with paths pre-set).
if [[ -n "${SSL_CERT:-}" && -n "${SSL_KEY:-}" ]]; then
  echo "[ssl] using certificates from SSL_CERT / SSL_KEY"
  _install_pair "${SSL_CERT}" "${SSL_KEY}" "${SSL_CHAIN:-}"
  exit 0
fi

case "${SSL_MODE}" in
  selfsigned)
    _generate_selfsigned
    exit 0
    ;;
  own)
    echo "[ssl] ERROR: SSL_MODE=own but SSL_CERT / SSL_KEY are not set." >&2
    echo "[ssl]        Example: SSL_CERT=/path/fullchain.pem SSL_KEY=/path/privkey.pem \\" >&2
    echo "[ssl]                 sudo -E bash deploy/scripts/install.sh" >&2
    exit 1
    ;;
esac

# Interactive when a console is available; otherwise lab self-signed.
if _tty || [[ -t 0 ]]; then
  _prompt_mode
else
  echo "[ssl] no TTY — generating self-signed certificate (pass SSL_CERT/SSL_KEY to use your own)"
  _generate_selfsigned
fi
