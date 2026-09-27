# REP Portal — единый серверный портал (Red OS 8)

Платформа для `https://rep.local.inion`:

| URL | Сервис |
|-----|--------|
| `/` | Портал (React + FastAPI) |
| `/netbox/` | NetBox DCIM/IPAM |
| `/wiki/` | MediaWiki |
| `/health` | Nginx healthcheck |

## Документация

- **[Исправленное ТЗ + полная инструкция](docs/TZ-PORTAL-RED-OS8.md)** — основной документ
- Конфиги: `deploy/`
- Код портала: `portal/`

## Быстрый старт на сервере

```bash
git clone <repo-url> portal && cd portal
sudo bash deploy/scripts/install.sh
sudo less /opt/services/credentials-*.txt
```

После установки откройте `https://rep.local.inion/` (для self-signed — принять сертификат в браузере).

## Локальная разработка портала

```bash
# API
cd portal/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PORTAL_DATA_DIR=./data PORTAL_STATIC_DIR=../frontend/dist \
  uvicorn app:app --reload --port 3000

# UI (другой терминал)
cd portal/frontend
npm install
npm run dev
```

## Состав репозитория

```
deploy/
  netbox/          # compose + configuration (BASE_PATH)
  mediawiki/       # compose + LocalSettings template
  nginx/           # vhost для rep.local.inion
  scripts/         # install.sh, backup, gen-env, ssl, wiki
  systemd/         # unit-файлы
portal/
  backend/         # FastAPI
  frontend/        # React (Vite)
docs/
  TZ-PORTAL-RED-OS8.md
```
