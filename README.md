# REP Portal — единый серверный портал с единым входом (Red OS 8)

Платформа для `https://rep.local.inion`:

| URL | Сервис |
|-----|--------|
| `/` | Портал: каталог систем, мониторинг, журнал действий (React + FastAPI) |
| `/netbox/` | NetBox DCIM/IPAM |
| `/wiki/` | MediaWiki |
| `/auth/` | Keycloak — единый вход (SSO), профиль, консоль администратора |
| `/health` | Nginx healthcheck |

Пользователь входит один раз (Keycloak → oauth2-proxy → Nginx `auth_request`) и попадает в портал,
NetBox и Вики без повторного ввода пароля; выход из любой системы завершает сессию везде.
Права — по группам `portal-users`, `portal-admins`, `netbox-admins`, `wiki-admins`; каталог пользователей
можно подключить из LDAP / Active Directory / FreeIPA / ALD Pro.

## Документация

- **[Инструкция по развёртыванию](docs/DEPLOY.md)** — установка, пароли, проверка, управление, устранение неполадок
- **[Единый вход (SSO)](docs/SSO.md)** — схема, группы, LDAP/AD и Kerberos, новые системы, аварийный вход, типовые ошибки
- **[Параметры — что и где менять](docs/PARAMETERS.md)** — единый справочник по всем настройкам развёртывания
- [Выгрузка изменений в GitHub через Cursor](docs/CURSOR-PUSH.md)
- [Задача на SSO и новый интерфейс](docs/CLAUDE-TASK-SSO.md), [исходное ТЗ](docs/TZ-PORTAL-RED-OS8.md)

## Быстрый старт на сервере

```bash
# Пустой сервер — одна команда (git + клон + полная установка):
#   curl -fsSL https://raw.githubusercontent.com/DanteALI1/portal/main/deploy/scripts/bootstrap.sh | sudo DOMAIN=rep.local.inion bash
# Или вручную:
git clone https://github.com/DanteALI1/portal.git && cd portal
sudo bash deploy/scripts/install.sh
sudo cat /opt/services/credentials-*.txt
sudo bash deploy/scripts/e2e.sh          # автотесты (API + браузер)
```

Затем откройте `https://rep.local.inion/` и войдите как `admin.portal` (пароль — в `credentials-*.txt`).
Имя `rep.local.inion` должно резолвиться в IP сервера на клиентах (DNS или hosts).

## Локальная разработка портала

```bash
# API без SSO: пользователь подставляется из переменных (только при PORTAL_ENV=dev)
cd portal/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PORTAL_ENV=dev PORTAL_DEV_USER=dev.user PORTAL_DEV_GROUPS=portal-users,portal-admins \
PORTAL_DATA_DIR=./data PORTAL_STATIC_DIR=../frontend/dist \
  uvicorn app:app --reload --port 3000

# UI (другой терминал), /api проксируется на :3000
cd portal/frontend
npm ci
npm run dev
```

## Состав репозитория

```
deploy/
  keycloak/        # Keycloak: compose, realm inion, тема входа, configure.sh (LDAP / тестовые пользователи)
  oauth2-proxy/    # oauth2-proxy + Redis сессий, страница ошибки
  netbox/          # compose, configuration (BASE_PATH, REMOTE_AUTH), post-install.py
  mediawiki/       # свой образ с Auth_remoteuser, LocalSettings template
  nginx/           # vhost, snippets SSO, страница 403
  portal/          # compose портала
  scripts/         # install, uninstall, gen-env, ssl, wiki, backup, e2e
  systemd/         # unit-файлы
  sso.env.example  # домен и имена групп
portal/
  backend/         # FastAPI: SSO-пользователь, роли, каталог, журнал, мониторинг
  frontend/        # React 19 + Vite (интерфейс из design/ui-reference)
design/ui-reference/  # эталон интерфейса
tests/
  api/             # pytest: сценарии SSO через Nginx
  e2e/             # Playwright: те же сценарии в браузере
docs/
```
