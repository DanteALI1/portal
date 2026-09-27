#!/usr/bin/env bash
# =============================================================================
# REP Portal — bootstrap для ПУСТОГО сервера: одна команда от начала до конца.
#
# Скрипт можно скопировать на чистый RED OS 8 / RHEL-совместимый сервер и
# запустить единственной командой — он поставит git, склонирует репозиторий,
# задаст домен (и, при желании, имена групп) и выполнит полную установку
# (deploy/scripts/install.sh): Docker, сеть, секреты, Keycloak, oauth2-proxy,
# NetBox, MediaWiki, портал, nginx+SSL, systemd, smoke-тесты.
#
# Быстрый старт на пустом сервере (одной строкой):
#   curl -fsSL https://raw.githubusercontent.com/DanteALI1/portal/main/deploy/scripts/bootstrap.sh \
#     | sudo DOMAIN=rep.local.inion bash
#
# Или, если файл уже скопирован на сервер:
#   sudo DOMAIN=rep.local.inion bash bootstrap.sh
#
# Параметры (переменные окружения):
#   DOMAIN                 — доменное имя портала            (по умолчанию rep.local.inion)
#   REPO_URL               — откуда клонировать               (по умолчанию https://github.com/DanteALI1/portal.git)
#   REPO_REF               — ветка/тег/коммит                 (по умолчанию main)
#   CHECKOUT_DIR           — куда клонировать                 (по умолчанию /opt/portal-src)
#   SSO_GROUP_USERS        — группа обычных пользователей     (по умолчанию portal-users)
#   SSO_GROUP_PORTAL_ADMINS— группа админов портала           (по умолчанию portal-admins)
#   SSO_GROUP_NETBOX_ADMINS— группа админов NetBox            (по умолчанию netbox-admins)
#   SSO_GROUP_WIKI_ADMINS  — группа админов Вики              (по умолчанию wiki-admins)
#   SKIP_INSTALL=1         — только подготовить репозиторий и sso.env, install.sh не запускать
#
# Идемпотентно: повторный запуск обновляет репозиторий (git pull) и заново
# прогоняет install.sh; сгенерированные пароли, данные и сертификаты сохраняются.
# =============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-rep.local.inion}"
REPO_URL="${REPO_URL:-https://github.com/DanteALI1/portal.git}"
REPO_REF="${REPO_REF:-main}"
CHECKOUT_DIR="${CHECKOUT_DIR:-/opt/portal-src}"
SERVICES_ROOT="${SERVICES_ROOT:-/opt/services}"

SSO_GROUP_USERS="${SSO_GROUP_USERS:-portal-users}"
SSO_GROUP_PORTAL_ADMINS="${SSO_GROUP_PORTAL_ADMINS:-portal-admins}"
SSO_GROUP_NETBOX_ADMINS="${SSO_GROUP_NETBOX_ADMINS:-netbox-admins}"
SSO_GROUP_WIKI_ADMINS="${SSO_GROUP_WIKI_ADMINS:-wiki-admins}"

log() { echo -e "\n==> $*\n"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запустите от root: sudo DOMAIN=${DOMAIN} bash $0" >&2
  exit 1
fi

command -v dnf >/dev/null || { echo "Нужен dnf (RED OS / RHEL-совместимый дистрибутив)"; exit 1; }

log "1/4 Пакет git"
command -v git >/dev/null || dnf install -y git

log "2/4 Репозиторий ${REPO_URL} (${REPO_REF}) -> ${CHECKOUT_DIR}"
if [[ -d "${CHECKOUT_DIR}/.git" ]]; then
  git -C "${CHECKOUT_DIR}" remote set-url origin "${REPO_URL}"
  git -C "${CHECKOUT_DIR}" fetch --depth 1 origin "${REPO_REF}"
  git -C "${CHECKOUT_DIR}" checkout -f "${REPO_REF}"
  git -C "${CHECKOUT_DIR}" reset --hard "origin/${REPO_REF}" 2>/dev/null || true
else
  mkdir -p "$(dirname "${CHECKOUT_DIR}")"
  git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" "${CHECKOUT_DIR}"
fi

log "3/4 Общие настройки SSO (домен и группы) -> ${SERVICES_ROOT}/sso.env"
# Задаём sso.env ДО install.sh, чтобы домен и группы попали во все сервисы с первого раза.
# Существующий sso.env не трогаем (чтобы не перетереть ручные правки при повторном запуске).
mkdir -p "${SERVICES_ROOT}"
if [[ -f "${SERVICES_ROOT}/sso.env" ]]; then
  echo "sso.env уже существует — оставляю как есть (правьте вручную при необходимости)."
else
  cat > "${SERVICES_ROOT}/sso.env" <<EOF
# Создан bootstrap.sh $(date -Is). Общие настройки единого входа (не секрет).
DOMAIN=${DOMAIN}
SSO_GROUP_USERS=${SSO_GROUP_USERS}
SSO_GROUP_PORTAL_ADMINS=${SSO_GROUP_PORTAL_ADMINS}
SSO_GROUP_NETBOX_ADMINS=${SSO_GROUP_NETBOX_ADMINS}
SSO_GROUP_WIKI_ADMINS=${SSO_GROUP_WIKI_ADMINS}
EOF
  chmod 644 "${SERVICES_ROOT}/sso.env"
  echo "Домен: ${DOMAIN}; группы: ${SSO_GROUP_USERS}/${SSO_GROUP_PORTAL_ADMINS}/${SSO_GROUP_NETBOX_ADMINS}/${SSO_GROUP_WIKI_ADMINS}"
fi

if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
  log "SKIP_INSTALL=1 — установка не запускается. Запустите вручную:"
  echo "  sudo DOMAIN=${DOMAIN} bash ${CHECKOUT_DIR}/deploy/scripts/install.sh"
  exit 0
fi

log "4/4 Полная установка (deploy/scripts/install.sh)"
cd "${CHECKOUT_DIR}"
DOMAIN="${DOMAIN}" SERVICES_ROOT="${SERVICES_ROOT}" bash deploy/scripts/install.sh
