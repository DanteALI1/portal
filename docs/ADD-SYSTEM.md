# Как добавить новую систему в портал

Есть два разных случая. Выберите нужный.

- **A. Просто карточка‑ссылка** на уже существующий или внешний сервис — правок файлов не нужно, всё делается в интерфейсе портала.
- **B. Новый сервис за единым входом** (например, Grafana на `https://rep.local.inion/grafana/`) — нужно добавить контейнер, маршрут nginx и (по желанию) карточку. Ниже — по шагам, с указанием файлов.

Термины и адреса берутся из [DEPLOY.md](DEPLOY.md), [PARAMETERS.md](PARAMETERS.md) и [SSO.md](SSO.md).

---

## A. Карточка‑ссылка (без правки файлов)

Войдите как член `portal-admins` → на портале **«＋ Добавить»** (или клавиша `N`) и заполните форму:

| Поле | Что вписать |
|---|---|
| **Название** | до 60 символов |
| **Адрес или маршрут** | внутренний маршрут `/<name>/` (если сервис уже за шлюзом) **или** полный внешний `https://…` |
| **Описание, Категория, Ответственный, Теги** | по желанию (описание до 240 символов, до 8 тегов) |
| **Иконка, Цвет** | из наборов |
| **Дополнительно → Адрес проверки доступности** | путь для health‑проверки (`/<name>/health`) |
| **Дополнительно → Внутренний адрес проверки** | адрес **внутри сети**, в обход SSO: `http://<container>:<port>/health`. Без него у маршрута за единым входом статус будет «Нет данных» |
| **Открывать в новой вкладке / В избранное** | флажки |

Каталог общий и хранится на сервере (`/opt/services/portal/data/systems.json`), карточку увидят все. «Настройки → Сброс» вернёт только встроенные системы (NetBox, Вики).

> Чтобы система была **встроенной** (появлялась у всех по умолчанию и возвращалась после «Сброса»), пропишите её в коде — см. раздел **B, шаг 5, вариант 2**.

---

## B. Новый сервис за единым входом

Пример: добавляем `grafana` на `https://rep.local.inion/grafana/`, контейнер слушает порт `3000`.
Наружу публикуем только на loopback как `127.0.0.1:3001` (свободный хостовый порт).

### Шаг 1. Контейнер сервиса — новый файл `deploy/grafana/docker-compose.yml`

Ключевое: сервис входит во **внешнюю** сеть `services-network` и слушает только `127.0.0.1`.

```yaml
services:
  grafana:
    image: docker.io/grafana/grafana:11.2.0
    container_name: grafana            # по этому имени другие контейнеры видят его в сети
    env_file: .env
    environment:
      GF_SERVER_ROOT_URL: https://rep.local.inion/grafana/
      GF_SERVER_SERVE_FROM_SUB_PATH: "true"
      # Доверять личности из заголовков шлюза (единый вход):
      GF_AUTH_PROXY_ENABLED: "true"
      GF_AUTH_PROXY_HEADER_NAME: X-Remote-User
      GF_AUTH_PROXY_HEADER_PROPERTY: username
      GF_AUTH_PROXY_HEADERS: "Email:X-Remote-Email"
      GF_AUTH_PROXY_AUTO_SIGN_UP: "true"
    ports:
      - "127.0.0.1:3001:3000"          # ХОСТ:КОНТЕЙНЕР — наружу только через nginx
    restart: unless-stopped
    networks:
      - services-network

networks:
  services-network:
    external: true
```

Личность приходит в заголовках `X-Remote-User`, `X-Remote-Email`, `X-Remote-Groups`, `X-Remote-Token`
(их проставляет nginx из oauth2-proxy, см. `deploy/nginx/snippets/sso-headers.conf`). Настройте приём
этих заголовков средствами самого сервиса (у Grafana — auth proxy, как выше).

### Шаг 2. Маршрут nginx — правка `deploy/nginx/portal.conf`

Добавьте `location` внутри `server { server_name __DOMAIN__; … }` (рядом с блоками `/netbox/`, `/wiki/`):

```nginx
# Grafana на /grafana/
location = /grafana { return 301 /grafana/; }

location /grafana/ {
    include /etc/nginx/rep/sso-protect.conf;      # требуем вход, отправляем на Keycloak если сессии нет
    proxy_pass http://127.0.0.1:3001;             # ХОСТОВЫЙ порт из шага 1
    include /etc/nginx/rep/proxy-common.conf;     # Host / X-Forwarded-* заголовки
    include /etc/nginx/rep/sso-headers.conf;      # X-Remote-User/Email/Groups/Token
    proxy_redirect off;
}

# (по желанию) выход из Grafana = выход везде
location = /grafana/logout { return 302 /oauth2/sign_out?rd=%2F; }
```

**Сохранять или срезать префикс `/grafana/`:**
- `proxy_pass http://127.0.0.1:3001;` (без пути) — префикс **сохраняется**, сервис должен уметь работать в подпапке (как NetBox с `BASE_PATH`, Grafana с `serve_from_sub_path`).
- `proxy_pass http://127.0.0.1:3001/;` (со `/` на конце) — префикс **срезается**, сервис отвечает от корня (как MediaWiki `/wiki/` → `proxy_pass …:8080/`).

**Исключения без единого входа** (если у сервиса есть токен‑API или публичная статика) — отдельные `location`
**выше** основного, с `include /etc/nginx/rep/sso-strip.conf;` вместо `sso-protect.conf`/`sso-headers.conf`
(так сделано для `/netbox/api/` и `/netbox/static/`): `sso-strip.conf` затирает `X-Remote-*`, чтобы клиент
не мог подделать личность.

### Шаг 3. (по желанию) Секреты — `deploy/grafana/env.example` + блок в `deploy/scripts/gen-env.sh`

Если сервису нужны пароли, добавьте `env.example` и блок генерации в `gen-env.sh` (по образцу
`--- MediaWiki ---`): `ensure_kv "$GF" GF_SECURITY_ADMIN_PASSWORD "$(rand 20)"`. Тогда пароль создастся один
раз и попадёт в `/opt/services/credentials-*.txt`. Простой случай — просто положить `deploy/grafana/.env` руками.

### Шаг 4. (по желанию) Автозапуск и включение в установщик

- **systemd:** новый `deploy/systemd/grafana.service` по образцу `portal.service` (WorkingDirectory `…/grafana`,
  `ExecStart=/usr/bin/docker compose up -d`, `ExecStop=… down`).
- **install.sh:** чтобы `install.sh` сам разворачивал сервис, добавьте в `deploy/scripts/install.sh`:
  - в блок `rsync` (шаг 5) строку синка `deploy/grafana/` → `${SERVICES_ROOT}/grafana/` (с `"${KEEP[@]}"`);
  - шаг подъёма рядом с другими: `cd "${SERVICES_ROOT}/grafana" && docker compose pull -q && docker compose up -d`;
  - имя юнита в `systemctl enable` (шаг 13);
  - при желании — smoke‑проверку в шаге 14: `check "grafana → Keycloak login" "https://${DOMAIN}/grafana/" 302 "${KC_LOGIN}"`.

Без этого сервис поднимается вручную (см. шаг 6) — это тоже нормально.

### Шаг 5. Карточка в каталоге портала

**Вариант 1 (обычный, ничего не коммитить):** админ на портале **«＋ Добавить»**, поля как в разделе A:
- **Адрес** = `/grafana/`
- **Внутренний адрес проверки** = `http://grafana:3000/api/health` (имя контейнера + внутренний порт, в обход SSO).

**Вариант 2 (встроенная система, для всех и после «Сброса»):** правка кода портала —
`portal/backend/store.py`:
- добавьте запись в список `DEFAULT_SYSTEMS` (`id`, `name`, `url: "/grafana/"`, `icon`, `accent`, `category`,
  `tags`, `owner`, `internalHealthUrl: "http://grafana:3000/api/health"`, `newTab: False`, `pinned: True`, `builtin: True`);
- продублируйте внутренний адрес в словарь `BUILTIN_INTERNAL` (`"/grafana/": "http://grafana:3000/api/health"`);
- допустимые значения `icon`/`accent` — множества `ICONS`/`ACCENTS` в том же файле.
Портал пересоберётся при `install.sh` (шаг 12) или `cd /opt/services/portal && docker compose up -d --build`.

### Шаг 6. Применить

```bash
# Полный путь (синк конфигов, перегенерация nginx allow-list, подъём сервисов, проверки):
sudo bash deploy/scripts/install.sh

# ИЛИ вручную (быстро, без переустановки):
cd /opt/services/grafana && sudo docker compose up -d
sudo nginx -t && sudo systemctl reload nginx
```

Проверка: `https://rep.local.inion/grafana/` без сессии отвечает 302 на страницу входа Keycloak; после входа —
открывает Grafana; в мониторинге портала система становится «Работает» (если задан внутренний адрес проверки).

---

## Чек‑лист «новый сервис за SSO»

- [ ] `deploy/<name>/docker-compose.yml` — сеть `services-network`, порт только `127.0.0.1:<host>:<cont>`
- [ ] Сервис принимает `X-Remote-User/Email/Groups` (если нужна личность из SSO)
- [ ] `location /<name>/` в `deploy/nginx/portal.conf` (`sso-protect.conf` + `sso-headers.conf`)
- [ ] При необходимости — `location` без SSO (`sso-strip.conf`) для токен‑API / статики
- [ ] Секреты в `gen-env.sh` или `deploy/<name>/.env` (по желанию)
- [ ] systemd‑юнит и шаги в `install.sh` (по желанию, для автоподъёма)
- [ ] Карточка: через UI или `DEFAULT_SYSTEMS` в `portal/backend/store.py`
- [ ] `install.sh` **или** `docker compose up -d` + `nginx -t && systemctl reload nginx`
