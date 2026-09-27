# ТЕХНИЧЕСКОЕ ЗАДАНИЕ (ИСПРАВЛЕННЫЙ ПРОМТ)
# Единый серверный портал на базе Red OS 8
# Домен: https://rep.local.inion

> **Как использовать этот документ**
> 1. Это готовый промт/ТЗ для развёртывания — передавайте его агенту или инженеру целиком.
> 2. В репозитории уже лежат рабочие конфиги и код портала (`deploy/`, `portal/`).
> 3. На чистом сервере Red OS 8 достаточно выполнить: `sudo bash deploy/scripts/install.sh`
> 4. Ниже — ручная пошаговая инструкция и список исправлений относительно исходного ТЗ.

================================================================================
## 0. ЧТО БЫЛО СЛОМАНО В ИСХОДНОМ ПРОМТЕ (ИСПРАВЛЕНО)
================================================================================

| # | Проблема | Почему не работало | Исправление |
|---|----------|--------------------|-------------|
| 1 | NetBox за `/netbox/` с `proxy_pass ...:8000/` | Префикс срезался, а `BASE_PATH` не задавался; в старых образах Unit не умел subpath | Образ **v4.7+ (Granian)** + `BASE_PATH=netbox/` в `extra.py` + Nginx **без** срезания пути |
| 2 | Неверные env-переменные NetBox (`POSTGRES_*` вместо `DB_*`) | Официальный образ читает `DB_NAME/DB_USER/DB_PASSWORD` и пароли Redis | Полный `.env` по схеме netbox-docker |
| 3 | Нет `netbox-worker` и паролей Redis | Очереди/фон ломаются, Redis без auth не совпадает с конфигом | Worker + `REDIS_PASSWORD` / `REDIS_CACHE_PASSWORD` |
| 4 | MediaWiki: `LocalSettings.php` монтировался до установки | Контейнер падает / визард недоступен | Двухфазная установка: `docker-compose.install.yml` → `install.php` → mount |
| 5 | MediaWiki short URLs без rewrite | `$wgArticlePath=/wiki/$1` требует rewrite; за proxy ломается | `$wgArticlePath=/wiki/index.php?title=$1` + strip `/wiki/` в Nginx |
| 6 | Портал = «скопируйте dist/» без исходников и API | Нельзя «добавлять/удалять системы» без бэкенда | React SPA + FastAPI, CRUD в `/data/systems.json` |
| 7 | Heredoc с отступами в `.env` | Пробелы в начале строк ломают переменные | Генератор `gen-env.sh` без ведущих пробелов |
| 8 | `curl https://...` без `-k` при self-signed | Ложные ошибки на проверках | В инструкции: `-k` для self-signed; prod — корпоративный CA |
| 9 | Healthcheck NetBox на `/` | При `BASE_PATH` login на `/netbox/login/` | Healthcheck и пробы обновлены |
| 10 | Нет единого install-скрипта | Ручные шаги легко пропустить | `deploy/scripts/install.sh` |

================================================================================
## 1. ОБЩЕЕ ОПИСАНИЕ
================================================================================

Развернуть на **одном сервере Red OS 8** единую платформу с централизованным
веб-доступом через `https://rep.local.inion` (SSL-терминация на Nginx).

Состав:
- **Портал** (React SPA + FastAPI) — каталог систем, статусы, CRUD
- **NetBox** — DCIM/IPAM
- **MediaWiki** — корпоративная wiki
- **Nginx** — reverse proxy + SSL
- **Docker Compose** — контейнеризация

Маршруты (обязательные):
```
https://rep.local.inion/          → Портал (:3000)
https://rep.local.inion/api/      → Portal API (:3000)
https://rep.local.inion/netbox/   → NetBox (:8000)   # путь СОХРАНЯЕТСЯ
https://rep.local.inion/wiki/     → MediaWiki (:8080) # путь СРЕЗАЕТСЯ
https://rep.local.inion/health    → 200 OK
```

Портал (тёмная тема, градиенты, анимации):
- список систем с описанием и статусом (online/offline);
- переход по клику;
- добавление системы через UI;
- удаление пользовательских систем (встроенные NetBox/Wiki/Portal нельзя удалить).

================================================================================
## 2. ТРЕБОВАНИЯ К СЕРВЕРУ
================================================================================

Аппаратные:
- CPU: ≥ 2 (рек. 4+)
- RAM: ≥ 4 GB (рек. 8–16 GB)
- Диск: ≥ 40 GB SSD (рек. 100+)
- Сеть: ≥ 100 Mbps

Программные:
- ОС: Red OS 8 (RHEL 8 / AlmaLinux 8 / Rocky 8 совместимы с этой инструкцией)
- Docker Engine 24+ и Docker Compose v2 (`docker compose`)
- Nginx 1.20+
- SSL для `rep.local.inion` (скрипт умеет выпустить self-signed)
- DNS A: `rep.local.inion` → IP сервера
- root/sudo

Порты:
| Порт | Назначение | Доступ |
|------|------------|--------|
| 80/tcp | HTTP→HTTPS | публично |
| 443/tcp | HTTPS | публично |
| 3000/tcp | Portal | только 127.0.0.1 |
| 8000/tcp | NetBox | только 127.0.0.1 |
| 8080/tcp | MediaWiki | только 127.0.0.1 |

================================================================================
## 3. АРХИТЕКТУРА
================================================================================

```
Пользователь
    │ HTTPS :443
    ▼
Nginx (SSL termination, /etc/nginx/conf.d/rep.local.inion.conf)
    ├── / , /api/  → 127.0.0.1:3000  portal (FastAPI + SPA)
    ├── /netbox/   → 127.0.0.1:8000  netbox   (BASE_PATH=netbox/)
    └── /wiki/     → 127.0.0.1:8080/ mediawiki (strip prefix)
```

Все контейнеры в Docker-сети `services-network` (172.28.0.0/16).

Структура на сервере:
```
/opt/services/
├── netbox/           # compose, .env, configuration/
├── mediawiki/        # compose, .env, LocalSettings.php
├── portal/           # Dockerfile, backend/, frontend/, data/
├── scripts/          # install, backup, gen-env, ssl
└── backups/

/etc/nginx/ssl/rep.local.inion.{crt,key}
/etc/nginx/conf.d/rep.local.inion.conf
```

Репозиторий (источник):
```
portal/                 # код портала
deploy/
  netbox/
  mediawiki/
  nginx/
  systemd/
  scripts/
docs/TZ-PORTAL-RED-OS8.md
```

================================================================================
## 4. БЫСТРЫЙ СТАРТ (РЕКОМЕНДУЕТСЯ)
================================================================================

На чистом сервере Red OS 8:

```bash
# 1) Скопировать репозиторий
sudo mkdir -p /opt/src && sudo chown "$USER":"$USER" /opt/src
cd /opt/src
git clone <URL_ЭТОГО_РЕПО> portal && cd portal

# 2) (Опционально) положить корпоративные сертификаты:
#    rep.local.inion.crt / rep.local.inion.key в текущий каталог
#    иначе будет создан self-signed

# 3) Установка
sudo bash deploy/scripts/install.sh

# 4) Пароли
sudo less /opt/services/credentials-*.txt
```

Проверка с клиента (DNS должен указывать на сервер):
```bash
curl -kI https://rep.local.inion/health
curl -kI https://rep.local.inion/
curl -kI https://rep.local.inion/netbox/
curl -kI https://rep.local.inion/wiki/
```

Дальше — подробная ручная инструкция (если нужно повторить шаги без `install.sh`).

================================================================================
## 5. ПОДГОТОВКА СЕРВЕРА
================================================================================

### 5.1 Обновление
```bash
sudo dnf update -y
sudo reboot
```

### 5.2 Базовые пакеты
```bash
sudo dnf install -y git curl wget vim htop net-tools tree openssl firewalld rsync
# На Red OS пакет epel-release может отсутствовать — это нормально.
# Ставьте epel только если пакет реально есть в репозиториях ОС:
# sudo dnf install -y epel-release || true
```

### 5.3 Hostname и hosts
```bash
sudo hostnamectl set-hostname rep.local.inion
echo "127.0.0.1 rep.local.inion" | sudo tee -a /etc/hosts
# На клиентских ПК: либо DNS A-запись, либо строка в их /etc/hosts
```

### 5.4 Firewall
```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 5.5 Каталоги
```bash
sudo mkdir -p /opt/services/{netbox,mediawiki,portal,configs,backups,scripts}
sudo mkdir -p /var/log/services
sudo chmod 700 /opt/services/backups
```

### 5.6 SELinux
```bash
sudo setsebool -P httpd_can_network_connect 1
sudo setsebool -P httpd_read_user_content 1
```

================================================================================
## 6. УСТАНОВКА DOCKER
================================================================================

```bash
# Podman конфликтует с Docker на Red OS — удалить
sudo dnf remove -y docker docker-client docker-client-latest docker-common \
  docker-latest docker-latest-logrotate docker-logrotate docker-engine \
  podman podman-docker runc 2>/dev/null || true

sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "storage-driver": "overlay2",
  "live-restore": true
}
EOF

sudo systemctl enable --now docker
docker --version
docker compose version

sudo usermod -aG docker "$USER"
# перелогиниться или: newgrp docker

docker network create \
  --driver bridge --subnet 172.28.0.0/16 --gateway 172.28.0.1 \
  services-network
```

================================================================================
## 7. NGINX + SSL
================================================================================

### 7.1 Установка Nginx
```bash
sudo dnf install -y nginx
sudo systemctl enable --now nginx
```

### 7.2 Сертификаты
```bash
# Вариант A: корпоративные
sudo mkdir -p /etc/nginx/ssl && sudo chmod 700 /etc/nginx/ssl
sudo cp rep.local.inion.crt /etc/nginx/ssl/
sudo cp rep.local.inion.key /etc/nginx/ssl/
sudo chmod 600 /etc/nginx/ssl/rep.local.inion.key
sudo chmod 644 /etc/nginx/ssl/rep.local.inion.crt

# Вариант B: self-signed из репозитория
sudo bash deploy/scripts/generate-ssl.sh /etc/nginx/ssl rep.local.inion
```

### 7.3 Конфиг
Скопировать `deploy/nginx/rep.local.inion.conf` → `/etc/nginx/conf.d/rep.local.inion.conf`

Критичные правила proxy (не перепутать!):

```nginx
# NetBox: путь СОХРАНЯЕМ (нет trailing slash, который режет префикс)
location /netbox/ {
    proxy_pass http://127.0.0.1:8000;   # ← без / на конце
    ...
}

# MediaWiki: путь СРЕЗАЕМ
location /wiki/ {
    proxy_pass http://127.0.0.1:8080/;  # ← со / на конце
    ...
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -kI https://rep.local.inion/health
```

================================================================================
## 8. NETBOX
================================================================================

### 8.1 Файлы
```bash
sudo rsync -a deploy/netbox/ /opt/services/netbox/
sudo bash deploy/scripts/gen-env.sh /opt/services
# или вручную: cp env.example .env и заменить CHANGE_ME_*
sudo chmod 600 /opt/services/netbox/.env
```

Обязательные параметры в `.env`:
- `DB_*` + `POSTGRES_*` (пароли совпадают)
- `REDIS_PASSWORD`, `REDIS_CACHE_PASSWORD`
- `SECRET_KEY` ≥ 50 символов
- `BASE_PATH=netbox/`
- `ALLOWED_HOSTS=rep.local.inion localhost 127.0.0.1`
- `SUPERUSER_*` только для первого запуска

`configuration/extra.py` должен содержать:
```python
from os import environ
BASE_PATH = environ.get("BASE_PATH", "netbox/")
```

### 8.2 Запуск
```bash
cd /opt/services/netbox
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f netbox
# Первый старт: 3–5 минут (миграции БД)
curl -fsS http://127.0.0.1:8000/netbox/login/ | head
curl -kI https://rep.local.inion/netbox/
```

Логин по умолчанию: `admin` / пароль из `/opt/services/credentials-*.txt`.

После первого успешного входа можно выставить `SKIP_SUPERUSER=true` и убрать
`SUPERUSER_PASSWORD` из `.env`, затем `docker compose up -d`.

================================================================================
## 9. MEDIAWIKI
================================================================================

**Не монтируйте LocalSettings.php до установки.**

```bash
sudo rsync -a deploy/mediawiki/ /opt/services/mediawiki/
# .env уже создан gen-env.sh

# Автоматически (рекомендуется):
sudo bash /opt/services/scripts/install-wiki.sh

# Или вручную:
cd /opt/services/mediawiki
docker compose -f docker-compose.yml -f docker-compose.install.yml up -d
# дождаться готовности mariadb + http://127.0.0.1:8080/
docker exec mediawiki php maintenance/install.php \
  --dbname=mediawiki --dbserver=mariadb \
  --dbuser=wiki --dbpass="$MARIADB_PASSWORD" --dbtype=mysql \
  --server="https://rep.local.inion" --scriptpath="/wiki" --lang=ru \
  --pass="$WIKI_ADMIN_PASSWORD" \
  "Корпоративная Вики" "WikiAdmin"
# собрать LocalSettings.php из шаблона (см. LocalSettings.template.php)
docker compose down && docker compose up -d
```

Ключевые параметры LocalSettings:
```php
$wgServer = "https://rep.local.inion";
$wgScriptPath = "/wiki";
$wgUsePathInfo = true;
$wgArticlePath = "/wiki/index.php?title=$1";
$wgDBserver = "mariadb";
$wgForceHTTPS = true;
```

Проверка: `curl -kI https://rep.local.inion/wiki/`

================================================================================
## 10. ПОРТАЛ
================================================================================

Исходники: `portal/` (backend FastAPI + frontend React/Vite).

API:
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | health |
| GET | `/api/systems` | список |
| POST | `/api/systems` | добавить |
| DELETE | `/api/systems/{id}` | удалить (не builtin) |
| GET | `/api/systems/{id}/status` | online/offline |
| GET | `/api/status` | статусы всех |

Данные: `/opt/services/portal/data/systems.json` (volume).

```bash
sudo rsync -a --delete portal/ /opt/services/portal/
sudo cp deploy/portal/docker-compose.yml /opt/services/portal/
cd /opt/services/portal
docker compose up -d --build
curl -fsS http://127.0.0.1:3000/api/health
curl -kI https://rep.local.inion/
```

UI: тёмная тема, градиентный фон, анимация появления карточек, пульс статуса,
модалка «Добавить». Встроенные системы (Портал/NetBox/Wiki) удалить нельзя.

================================================================================
## 11. SYSTEMD + БЭКАПЫ + HARDENING
================================================================================

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable netbox mediawiki portal

sudo cp deploy/scripts/backup.sh /opt/services/scripts/
sudo chmod +x /opt/services/scripts/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/services/scripts/backup.sh >> /var/log/services/backup.log 2>&1") | crontab -
```

Fail2Ban (опционально):
```bash
sudo dnf install -y fail2ban || true
# jail для nginx access/error логов домена — см. исходное ТЗ раздел 10
```

================================================================================
## 12. ДОБАВЛЕНИЕ НОВОЙ СИСТЕМЫ
================================================================================

1. Развернуть сервис в Docker на `127.0.0.1:NEW_PORT`, сеть `services-network`.
2. Добавить `location /new-service/` в Nginx (решить: strip path или нет).
3. `sudo nginx -t && sudo systemctl reload nginx`
4. В портале нажать **«Добавить»** (имя, URL, health URL).

Шаблон compose — в `docs`/чеклисте; не забывайте `external: true` для сети.

================================================================================
## 13. ПРОВЕРКА ПОСЛЕ УСТАНОВКИ
================================================================================

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

curl -kI https://rep.local.inion/health
curl -kI https://rep.local.inion/
curl -kI https://rep.local.inion/api/health
curl -kI https://rep.local.inion/netbox/
curl -kI https://rep.local.inion/wiki/

openssl s_client -connect rep.local.inion:443 -servername rep.local.inion </dev/null | head
```

Ожидание:
- `/health` → 200 OK
- `/` → 200, HTML портала
- `/netbox/` → 200/302 на login
- `/wiki/` → 200

================================================================================
## 14. ДИАГНОСТИКА
================================================================================

**502 Bad Gateway**
```bash
docker ps | egrep 'netbox|mediawiki|portal'
ss -tlnp | egrep '3000|8000|8080'
docker compose -f /opt/services/netbox/docker-compose.yml logs --tail=80 netbox
```

**NetBox CSS/redirect loop**
- Проверить `BASE_PATH=netbox/` и что Nginx **не** режет `/netbox/`
- `docker exec netbox printenv BASE_PATH`
- Открыть именно `https://rep.local.inion/netbox/` (со слэшем)

**Wiki белый экран / неправильные ссылки**
- `$wgServer` и `$wgScriptPath=/wiki`
- Nginx `proxy_pass http://127.0.0.1:8080/;` со слэшем
- LocalSettings смонтирован: `docker exec mediawiki ls -l /var/www/html/LocalSettings.php`

**SSL_ERROR на клиентах**
- Установить корпоративный CA **или** принять self-signed
- Проверить цепочку: `openssl s_client -connect rep.local.inion:443 -showcerts`

**Закончилось место**
```bash
docker system df
sudo du -sh /opt/services/* /var/lib/docker
# ОСТОРОЖНО: prune удалит неиспользуемые volume
```

================================================================================
## 15. ЧЕК-ЛИСТ
================================================================================

- [ ] `dnf update` выполнен
- [ ] Hostname / DNS: `rep.local.inion`
- [ ] Docker установлен, Podman удалён
- [ ] Сеть `services-network` создана
- [ ] SSL в `/etc/nginx/ssl/`
- [ ] `nginx -t` OK, открыты 80/443
- [ ] SELinux booleans выставлены
- [ ] NetBox отвечает на `/netbox/login/`
- [ ] MediaWiki установлена (LocalSettings после install.php)
- [ ] Портал открывается, CRUD систем работает
- [ ] systemd enable для трёх сервисов
- [ ] cron бэкапа в 03:00
- [ ] Пароли сохранены из `credentials-*.txt`
- [ ] Проверка с клиентской машины

================================================================================
## 16. ПРОМТ ДЛЯ АГЕНТА (КОРОТКАЯ ФОРМА)
================================================================================

Скопируйте блок ниже, если нужно поставить задачу другому агенту:

```
Разверни единый портал на Red OS 8 для домена https://rep.local.inion по репозиторию.

Стек: Nginx (SSL) + Docker Compose + сеть services-network.
Маршруты:
  /        → portal :3000 (React+FastAPI, CRUD систем в systems.json)
  /netbox/ → NetBox :8000 с BASE_PATH=netbox/ (НЕ срезать путь в proxy_pass)
  /wiki/   → MediaWiki :8080 (срезать /wiki/, LocalSettings только ПОСЛЕ install.php)

Используй готовые файлы из deploy/ и portal/.
На сервере запусти: sudo bash deploy/scripts/install.sh
Проверь curl -kI для /, /health, /netbox/, /wiki/, /api/health.
Сохрани пароли из /opt/services/credentials-*.txt.
Не используй heredoc с ведущими пробелами в .env.
Не монтируй пустой LocalSettings.php до установки MediaWiki.
NetBox образ v4.7+ (Granian), configuration/extra.py с BASE_PATH.
```

================================================================================
КОНЕЦ ДОКУМЕНТА
================================================================================
