# Развёртывание REP Portal на RED OS 8

Инструкция проверена на реальной установке «с нуля»: RED OS 8.0.3, SELinux Enforcing,
Docker CE 29 из репозитория RED OS. Результат — на одном сервере с единым входом (SSO):

| Адрес | Сервис |
|---|---|
| `https://rep.local.inion/` | Портал: каталог систем, мониторинг, журнал действий |
| `https://rep.local.inion/netbox/` | NetBox (DCIM/IPAM) |
| `https://rep.local.inion/wiki/` | MediaWiki |
| `https://rep.local.inion/auth/` | Keycloak: страница входа, профиль, консоль администратора |
| `https://rep.local.inion/health` | Проверка nginx |

Вход один на все системы, выход из любой завершает сессию везде. Устройство SSO, роли, подключение
LDAP/AD и Kerberos — в [SSO.md](SSO.md).

---

## 1. Требования

- RED OS 8 (или другой RHEL-совместимый дистрибутив с `dnf`), x86_64.
- 6 ГБ RAM и больше (Keycloak — Java), 25 ГБ свободного места.
- Пользователь с правами `sudo`.
- Доступ в интернет на время установки: пакеты RED OS, Docker Hub, quay.io
  (Keycloak, oauth2-proxy), npm и PyPI (сборка портала).
- Свободны порты 80 и 443. Внутренние порты 3000, 4180, 8000, 8080 и 8081 слушают только `127.0.0.1`.
- **Имя `rep.local.inion` должно резолвиться в IP сервера на всех клиентах** (DNS или hosts).
  Единый вход привязан к имени: запросы по IP перенаправляются на `https://rep.local.inion/`.

## 2. Установка

```bash
git clone https://github.com/DanteALI1/portal.git
cd portal
# Интерактивно: шаг Nginx+SSL спросит пути к вашему .crt/.pem и ключу
# (либо предложит самоподписанный). Без запроса:
#   sudo SSL_CERT=/path/fullchain.pem SSL_KEY=/path/privkey.pem \
#        bash deploy/scripts/install.sh
sudo bash deploy/scripts/install.sh 2>&1 | tee ~/portal-install.log
```

На чистом сервере установка занимает 20–30 минут, дольше всего скачиваются образы.
В конце скрипт выполняет проверки и печатает `PASS`/`FAIL`; код возврата 0, только если прошли все.

| Шаг | Действие |
|---|---|
| 1–3 | Пакеты, hostname `rep.local.inion`, firewalld (http/https), SELinux-флаги для nginx |
| 4 | Docker CE и `docker compose` из репозитория RED OS. **Удаляет `podman-docker`**, если он стоит |
| 5 | Каталоги `/opt/services/*`, копирование конфигов. `.env`, `LocalSettings.php`, данные при повторном запуске сохраняются |
| 6 | Пароли и секреты в `.env` (только недостающие: существующие не меняются), сводка в `/opt/services/credentials-*.txt` |
| 7 | Nginx + SSL: запрос ваших сертификатов (или `SSL_CERT`/`SSL_KEY`), иначе самоподписанный; vhost из `portal.conf` с подстановкой `DOMAIN` |
| 8 | Keycloak: realm `inion`, группы, клиент, тема входа; `configure.sh` — секрет клиента, сессии, LDAP или тестовые пользователи |
| 9 | oauth2-proxy + Redis сессий; проверка, что вход перенаправляет на Keycloak |
| 10 | NetBox с входом по SSO; `post-install.py` — право «только просмотр» для групп и API-токен администратора |
| 11 | MediaWiki (свой образ с Auth_remoteuser): установка базы при первом запуске, `LocalSettings.php` из шаблона |
| 12 | Портал: сборка образа (React + FastAPI) |
| 13 | systemd-юниты, cron бэкапа в 03:00 |
| 14 | Smoke-проверки |

Скрипт можно запускать повторно (обновление конфигов, после `git pull`): пароли, пользователи и данные не теряются.

> Если в `dnf` подключён недоступный репозиторий `docker-ce-stable` (download.docker.com), отключите его:
> `sudo dnf config-manager --set-disabled docker-ce-stable`. Docker ставится из репозитория RED OS `updates`.

## 3. Пароли и первый вход

```bash
sudo cat /opt/services/credentials-*.txt
```

| Учётная запись | Для чего |
|---|---|
| `admin.portal` | тестовый администратор SSO: портал (правка каталога, журнал), NetBox (суперпользователь), Вики (sysop) |
| `user.portal` | тестовый пользователь SSO: просмотр портала, NetBox только чтение, Вики — чтение и правка |
| `admin` (Keycloak) | консоль `https://rep.local.inion/auth/admin/` — управление пользователями и группами |
| `admin` (NetBox), `WikiAdmin` | локальные аварийные входы мимо SSO, см. [SSO.md](SSO.md), раздел 6 |
| NetBox API token | `Authorization: Token …` для `https://rep.local.inion/netbox/api/` (работает без SSO) |

Откройте `https://rep.local.inion/`, войдите как `admin.portal`, затем создайте в консоли Keycloak
настоящих пользователей (или подключите LDAP/AD) и **отключите или удалите тестовых**.

## 4. Проверка после установки

Smoke-проверки выполняются в конце установки. Полные автотесты (API + браузер, 9 сценариев из
`docs/CLAUDE-TASK-SSO.md`):

```bash
sudo bash deploy/scripts/e2e.sh
```

Тесты временно создают пользователя `nogroup.e2e` и примерно на минуту останавливают NetBox
(проверка честного мониторинга). Им нужен доступ к Docker Hub, mcr.microsoft.com, PyPI и npm.

Быстрая ручная проверка:

```bash
curl -k https://rep.local.inion/health                     # OK
curl -k https://rep.local.inion/api/health                 # {"status":"ok",...}
curl -kI https://rep.local.inion/netbox/ | grep -i location # на /auth/realms/inion/... (вход)
sudo docker ps --format '{{.Names}}\t{{.Status}}'          # 13 контейнеров, Up / healthy
```

## 5. Доступ с клиентских компьютеров

- **DNS или hosts:** `192.168.1.48 rep.local.inion`
  (`C:\Windows\System32\drivers\etc\hosts` или `/etc/hosts`).
- **Сертификат.** При установке скрипт предлагает указать свои файлы (или передайте
  `SSL_CERT` / `SSL_KEY` / опционально `SSL_CHAIN`). В `.crt` должна быть цепочка до корня УЦ —
  тот же файл монтируется в oauth2-proxy и портал как CA. Если выбрали самоподписанный,
  браузер покажет предупреждение. Замена после установки:

  ```bash
  sudo SSL_FORCE=1 SSL_CERT=/path/fullchain.pem SSL_KEY=/path/privkey.pem \
    bash /opt/services/scripts/generate-ssl.sh /etc/nginx/ssl "$(grep -m1 '^DOMAIN=' /opt/services/sso.env | cut -d= -f2-)"
  sudo systemctl reload nginx
  sudo docker restart oauth2-proxy portal
  ```

  Если в сертификате только leaf (без цепочки УЦ) — передайте ещё `SSL_CHAIN=/path/ca-bundle.pem`,
  иначе oauth2-proxy/портал могут получить `x509: certificate signed by unknown authority`.

### Если у сервера изменился IP

Клиентам нужно обновить DNS/hosts. Перевыпустите самоподписанный сертификат с новым IP (или оставьте
старый: доступ идёт по имени) и повторите установку:

```bash
sudo rm -f /etc/nginx/ssl/"$(grep -m1 '^DOMAIN=' /opt/services/sso.env | cut -d= -f2-)".*
sudo DOMAIN=… bash deploy/scripts/install.sh
```

## 6. Управление

| Задача | Команда |
|---|---|
| Статус контейнеров | `sudo docker ps` |
| Перезапуск сервиса | `sudo systemctl restart keycloak` (или `oauth2-proxy`, `netbox`, `mediawiki`, `portal`) |
| Логи | `sudo docker logs -f <keycloak\|oauth2-proxy\|netbox\|mediawiki\|portal>` |
| Логи nginx | `/var/log/nginx/<DOMAIN>.{access,error}.log` |
| Бэкап вручную | `sudo /opt/services/scripts/backup.sh` |
| Где лежат бэкапы | `/opt/services/backups/<дата>/` (базы NetBox, Вики, Keycloak, экспорт realm, файлы, `.env`) |
| Пользователи и группы | консоль Keycloak, см. [SSO.md](SSO.md) |

### Обновление после изменений в репозитории

```bash
cd ~/portal && git pull
sudo bash deploy/scripts/install.sh
```

Каталог систем и журнал портала — в `/opt/services/portal/data/`, при обновлении не затираются.

## 7. Портал

- **Права:** изменять каталог (добавление, правка, удаление, импорт, сброс) и смотреть журнал могут только
  члены `portal-admins`. Остальные видят каталог и мониторинг. Права проверяет сервер.
- **Удаление:** меню «⋯» на карточке → «Удалить» → подтверждение. 8 секунд можно отменить из уведомления.
  Встроенные системы (NetBox, Вики) тоже можно удалить, «Настройки → Сброс» возвращает исходный состав.
- **Мониторинг:** сервер портала проверяет системы напрямую по внутренним адресам, в обход SSO
  (через Nginx любая страница отвечает переадресацией на вход). Для новой системы укажите
  «Внутренний адрес проверки», например `http://grafana:3000/api/health`, иначе статус будет «Нет данных».
- **Журнал действий** хранится на сервере и показывает автора каждого изменения.
- Горячие клавиши: `Ctrl+K` — поиск и команды, `/` — поиск по каталогу, `N` — добавить систему.

API (за SSO): `GET /api/me`, `GET/POST /api/systems`, `PUT/DELETE /api/systems/{id}`, `PUT /api/systems`,
`POST /api/systems/restore-defaults`, `GET /api/audit`, `GET /api/status`, `POST /api/status/refresh`.
Без входа: `GET /api/health`.

## 8. Устранение неполадок

Проблемы, найденные на реальных установках. Все исправлены в скриптах репозитория.

| Симптом | Причина | Решение |
|---|---|---|
| `install.sh` падает на `systemctl enable --now docker` | `docker` — это эмуляция через podman (`podman-docker`) | шаг 4 удаляет `podman-docker` и ставит Docker CE |
| `.env: строка N: localhost: команда не найдена` | значения с пробелами в `.env` без кавычек | `gen-env.sh` заключает их в кавычки |
| Вики: `LocalSettings.php not readable` | файл `root:root 640`, а веб-сервер в контейнере — `www-data` | `chown root:33`, `chmod 640` (делает `install-wiki.sh`) |
| Вики: `Failed opening required LocalSettings.php` при установке | override Compose объединял списки volumes, и Docker создавал каталог | `volumes: !override` в `docker-compose.install.yml` |
| NetBox: `Ошибка статичных медиа ... setmode.js` | статика в контейнере отдаётся только по `/static/` | `location /netbox/static/` в nginx |
| Портал: 502, контейнер перезапускается | FastAPI: `Status code 204 must not have a response body` | исправлено в `app.py` |
| Повторный `install.sh` ломает NetBox и Вики | `rsync --delete` стирал `.env` | `.env`, `LocalSettings.php`, данные исключены из синхронизации |
| `install.sh` падает на шаге cron | пустой crontab + `pipefail` | `grep -v ... \|\| true` |
| 403 `invalid_scope` после входа в Keycloak | oauth2-proxy запрашивал scope `groups`, которого нет в realm | `--scope=openid email profile` |
| API NetBox: `Invalid v1 token` | netbox-docker 5.x не создаёт токен из `SUPERUSER_API_TOKEN`; токены v2 требуют pepper | `post-install.py` создаёт токен, `API_TOKEN_PEPPER_1` включает v2 |
| `nginx: open() "/etc/nginx/mime.types" failed` | `/etc/nginx` удалён вручную, а пакеты nginx остались | `install.sh` переустанавливает пакеты `nginx*`, если нет их файлов |
| Keycloak «healthy», но `kcadm` получает 503 | проверка готовности искала `"UP"` и срабатывала на вложенных проверках | проверяется HTTP 200 от `/health/ready` |

Ошибки единого входа (redirect loop, 502 too big header, неверный issuer, сертификат) — в [SSO.md](SSO.md), раздел 7.

Общая диагностика:

```bash
sudo docker ps -a                     # какие контейнеры не Up
sudo docker logs --tail 50 <имя>      # причина падения
sudo nginx -t                         # синтаксис nginx
sudo ausearch -m avc -ts recent       # блокировки SELinux
```

## 9. Полное удаление

**Внимание:** удаляются все данные NetBox, Вики, Keycloak, портала и бэкапы в `/opt/services`.

```bash
# Стек портала (контейнеры, тома, образы, /opt/services, nginx vhost, SSL, cron, юниты, запись в /etc/hosts)
sudo bash deploy/scripts/uninstall.sh --yes

# Как выше + пакеты Docker CE и nginx, возврат podman-docker, сброс firewall http/https и SELinux httpd_*
sudo bash deploy/scripts/uninstall.sh --yes --purge

# Плюс каталог исходников bootstrap (/opt/portal-src)
sudo bash deploy/scripts/uninstall.sh --yes --purge --remove-src

# Сохранить свои сертификаты в /etc/nginx/ssl
sudo bash deploy/scripts/uninstall.sh --yes --keep-certs
```

Что снимается по шагам: systemd-юниты → `docker compose down -v` по всем сервисам → сеть
`services-network` и prune → cron бэкапа → `/opt/services` и `/var/log/services` → конфиги nginx
портала и SSL → строка `127.0.0.1 <DOMAIN>` в `/etc/hosts` → (с `--purge`) пакеты и откат
окружения хоста.

Без `--purge` остаются пакеты Docker/nginx, `firewalld`, базовые утилиты (`git`, `curl`…),
hostname и SELinux-булевы — их могли использовать не только портал.
