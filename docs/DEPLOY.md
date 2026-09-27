# Развёртывание REP Portal на RED OS 8

Инструкция проверена на реальной установке: RED OS 8.0.3, SELinux Enforcing,
Docker CE 29 из репозитория RED OS. Результат — на одном сервере:

| Адрес | Сервис |
|---|---|
| `https://rep.local.inion/` | Портал (каталог систем, можно добавлять и удалять) |
| `https://rep.local.inion/netbox/` | NetBox (DCIM/IPAM) |
| `https://rep.local.inion/wiki/` | MediaWiki |
| `https://rep.local.inion/health` | Проверка nginx |

Все адреса работают и по IP сервера (`https://<IP>/...`).

---

## 1. Требования

- RED OS 8 (или другой RHEL-совместимый дистрибутив с `dnf`), x86_64.
- 4 ГБ RAM и больше, 20 ГБ свободного места на диске.
- Пользователь с правами `sudo`.
- Доступ в интернет: пакеты RED OS и образы Docker Hub
  (`netboxcommunity/netbox`, `postgres`, `redis`, `mediawiki`, `mariadb`, `node`, `python`).
- Свободны порты 80 и 443. Внутренние порты 3000, 8000 и 8080 слушают только `127.0.0.1`.

## 2. Установка

```bash
git clone https://github.com/DanteALI1/portal.git
cd portal
sudo bash deploy/scripts/install.sh 2>&1 | tee ~/portal-install.log
```

Установка занимает 10–20 минут, дольше всего скачиваются образы. Что делает скрипт:

| Шаг | Действие |
|---|---|
| 1 | Ставит базовые пакеты, задаёт hostname `rep.local.inion`, добавляет запись в `/etc/hosts` |
| 2 | Открывает http и https в firewalld |
| 3 | Включает SELinux-флаги `httpd_can_network_connect` и `httpd_read_user_content` |
| 4 | Ставит Docker CE и `docker compose` из репозитория RED OS. **Удаляет `podman-docker`**, если он стоит |
| 5 | Создаёт `/opt/services/*` и копирует туда конфиги. `.env` и `LocalSettings.php` при повторном запуске сохраняются |
| 6 | Ставит nginx, создаёт самоподписанный SSL-сертификат, устанавливает vhost |
| 7 | Генерирует пароли в `.env` и сохраняет их в `/opt/services/credentials-YYYYMMDD.txt` |
| 8 | Запускает NetBox и ждёт, пока он поднимется (первые миграции БД идут 3–5 минут) |
| 9 | Ставит MediaWiki: сначала `install.php`, затем создаёт `LocalSettings.php` из шаблона |
| 10 | Собирает и запускает портал, включает юниты systemd, добавляет в cron бэкап в 03:00 |

Скрипт можно запускать повторно: пароли и данные при этом не теряются.

> Если в `dnf` подключён недоступный репозиторий `docker-ce-stable`
> (download.docker.com), отключите его:
> `sudo dnf config-manager --set-disabled docker-ce-stable`.
> Docker ставится из репозитория RED OS `updates`.

## 3. Пароли

```bash
sudo cat /opt/services/credentials-*.txt
sudo grep SUPERUSER_API_TOKEN /opt/services/netbox/.env
```

- NetBox: `admin` / пароль из файла.
- MediaWiki: `WikiAdmin` / пароль из файла.

После первого входа смените пароли в веб-интерфейсе.

## 4. Проверка после установки

Код ответа 200 не гарантирует, что всё работает: страница ошибки MediaWiki тоже
отдаёт 200. Поэтому проверяйте содержимое страниц:

```bash
B=https://127.0.0.1
curl -ks $B/health                                   # OK
curl -ks $B/api/health                               # {"status":"ok",...}
curl -ks $B/ | grep -o '<title>[^<]*'                # REP · Корпоративный портал
curl -ksL $B/wiki/ | grep -o '<title>[^<]*'          # Корпоративная Вики
curl -ks $B/netbox/login/ | grep -o '<title>[^<]*'   # Home | NetBox
curl -ks -o /dev/null -w '%{http_code}\n' $B/netbox/static/setmode.js   # 200
sudo docker ps --format '{{.Names}}\t{{.Status}}'    # 8 контейнеров, Up / healthy
```

Затем проверьте в браузере: войдите в NetBox и Wiki, на портале добавьте и
удалите тестовую систему.

## 5. Доступ с клиентских компьютеров

- **По имени.** Добавьте в DNS A-запись `rep.local.inion` с IP сервера или строку
  в hosts на клиенте (`C:\Windows\System32\drivers\etc\hosts` или `/etc/hosts`):
  `192.168.1.48 rep.local.inion`.
- **По IP.** Работает сразу: `https://192.168.1.48/`.
- **Сертификат.** По умолчанию самоподписанный, браузер покажет предупреждение.
  Для рабочей эксплуатации положите сертификат корпоративного CA в
  `/etc/nginx/ssl/rep.local.inion.{crt,key}` и выполните `sudo systemctl reload nginx`.

### Если у сервера изменился IP

NetBox принимает только адреса из `ALLOWED_HOSTS`, для остальных возвращает 400.
Эти адреса прописываются при установке. После смены IP:

```bash
sudo vi /opt/services/netbox/.env
# ALLOWED_HOSTS="rep.local.inion localhost 127.0.0.1 <НОВЫЙ_IP>"
# CSRF_TRUSTED_ORIGINS="https://rep.local.inion https://<НОВЫЙ_IP>"
cd /opt/services/netbox && sudo docker compose up -d
```

Лучше закрепить за сервером статический IP.

## 6. Управление

| Задача | Команда |
|---|---|
| Статус контейнеров | `sudo docker ps` |
| Перезапуск сервиса | `sudo systemctl restart netbox` (или `mediawiki`, `portal`) |
| Логи | `sudo docker logs -f netbox` (или `mediawiki`, `portal`) |
| Логи nginx | `/var/log/nginx/rep.local.inion.{access,error}.log` |
| Бэкап вручную | `sudo /opt/services/scripts/backup.sh` |
| Где лежат бэкапы | `/opt/services/backups/<дата>/` |

### Обновление портала после изменений в репозитории

```bash
cd ~/portal && git pull
sudo rsync -a --delete --exclude node_modules --exclude dist --exclude .env \
  --exclude data --exclude docker-compose.yml portal/ /opt/services/portal/
cd /opt/services/portal && sudo docker compose up -d --build
```

Каталог систем портала хранится в `/opt/services/portal/data/systems.json`
и при обновлении не затирается.

### Обновление конфигов nginx

```bash
sudo install -m 644 ~/portal/deploy/nginx/rep.local.inion.conf /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Портал: добавление и удаление систем

- Кнопка **«Добавить»**: название, описание, URL (например `/grafana/` или
  `https://host/`) и, при желании, отдельный URL для проверки статуса.
- Кнопка **«✕ Удалить»** на карточке открывает окно подтверждения. Удалить
  можно любую карточку, в том числе встроенные (Портал, NetBox, MediaWiki).
  Удаляется только карточка, сам сервис продолжает работать.
- Кнопка **«Восстановить стандартные»** появляется, если удалена хотя бы одна
  встроенная карточка, и возвращает её на место.

API: `GET/POST /api/systems`, `DELETE /api/systems/{id}`,
`POST /api/systems/restore-defaults`, `GET /api/systems/{id}/status`.

## 8. Устранение неполадок

Ниже проблемы, которые встретились при реальной установке, и их решения.
Все они уже исправлены в скриптах репозитория.

| Симптом | Причина | Решение |
|---|---|---|
| `install.sh` падает на `systemctl enable --now docker` | `docker` — это эмуляция через podman (`podman-docker`) | Шаг 4 удаляет `podman-docker` и ставит Docker CE |
| `.env: строка N: localhost: команда не найдена` | Значения с пробелами в `.env` были без кавычек | `gen-env.sh` заключает их в кавычки |
| Wiki: `LocalSettings.php not readable` | Файл `root:root 640`, а веб-сервер в контейнере работает от `www-data` | `chown root:33 LocalSettings.php; chmod 640` |
| Wiki: `Failed opening required LocalSettings.php` при установке | Override-файл Compose объединял списки volumes, и Docker создал на месте файла каталог | `volumes: !override` в `docker-compose.install.yml` |
| NetBox: `Bad Request (400)` по IP | IP нет в `ALLOWED_HOSTS` | См. раздел 5, «Если у сервера изменился IP» |
| NetBox: `Ошибка статичных медиа ... setmode.js` | В контейнере статика отдаётся только по `/static/`, а NetBox ссылается на `/netbox/static/` | `location /netbox/static/` в nginx |
| Портал: 502, контейнер `portal` перезапускается | FastAPI: `Status code 204 must not have a response body` | Исправлено в `app.py` |
| Повторный `install.sh` ломает NetBox и Wiki (ошибки пароля БД) | `rsync --delete` стирал `.env`, генерировались новые пароли | `rsync --exclude .env --exclude LocalSettings.php` |
| `install.sh` падает на шаге cron | Пустой crontab, `grep -v` возвращает 1 при `pipefail` | `grep -v ... \|\| true` |

Общая диагностика:

```bash
sudo docker ps -a                     # какие контейнеры не Up
sudo docker logs --tail 50 <имя>      # причина падения
sudo nginx -t                         # синтаксис nginx
sudo ausearch -m avc -ts recent       # блокировки SELinux
sudo ss -ltnp | grep -E ':(80|443|3000|8000|8080)\b'
```

## 9. Полное удаление

**Внимание:** удаляются все данные NetBox и Wiki.

```bash
for s in portal mediawiki netbox; do
  sudo systemctl disable --now $s
  (cd /opt/services/$s && sudo docker compose down -v)
done
sudo rm -f /etc/systemd/system/{portal,mediawiki,netbox}.service /etc/nginx/conf.d/rep.local.inion.conf
sudo systemctl daemon-reload && sudo systemctl reload nginx
sudo rm -rf /opt/services
```
