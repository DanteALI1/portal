# Задача для Claude Code: SSO для всего rep.local.inion + новый интерфейс портала

Работаешь в репозитории `DanteALI1/portal` (Red OS 8, Docker Compose, Nginx на хосте).
Сейчас в нём есть портал (`portal/`: FastAPI + React/Vite), NetBox (`deploy/netbox`), MediaWiki (`deploy/mediawiki`),
vhost Nginx (`deploy/nginx/rep.local.inion.conf`) и установщик `deploy/scripts/install.sh`.

Нужно сделать две вещи:
1. **Единый вход (SSO)** для всех сервисов домена: портала, NetBox и Вики. Пользователь входит один раз
   и попадает во все системы без повторного ввода пароля. Выход из любой системы завершает сессию везде.
2. **Новый интерфейс портала.** Перенести эталонный UI из `design/ui-reference/`
   во фронтенд проекта, подключить его к бэкенду и ролям из SSO.

В результате всё должно ставиться одним `sudo bash deploy/scripts/install.sh` на чистый Red OS 8 и работать сразу.

---

## 0. Как работать

- Сначала прочитай весь репозиторий: `README.md`, `docs/DEPLOY.md`, `docs/TZ-PORTAL-RED-OS8.md`, `deploy/**`, `portal/**`,
  а также эталон `design/ui-reference/` (там `README.md`, `src/`, `nginx.conf`).
  Затем дай короткий план по этапам ниже и сразу приступай к работе. Останавливайся только на действительно спорных решениях.
- Работай в ветке `feat/sso-portal-ui`. Один этап — один коммит с понятным сообщением.
- Ничего не ломай из того, что уже работает. Учти, что в `docs/DEPLOY.md` описаны решения, найденные на реальной установке:
  `BASE_PATH` для NetBox, срезание префикса `/wiki/`, отдача `/netbox/static/`, `podman-docker`, SELinux.
- Секреты в git не коммить. Пароли генерирует `gen-env.sh`, в репозитории лежат только `*.example`.
- Все версии образов закрепи конкретным тегом (никаких `latest`). Перед тем как вписать тег, проверь, что он существует.
- `install.sh` и остальные скрипты должны быть идемпотентными: повторный запуск не теряет данные и пароли.

---

## 1. Целевая архитектура

```
Браузер ──HTTPS──> Nginx (хост, :443, TLS)
                     │
                     ├─ /auth/           → Keycloak (127.0.0.1:8081)       — без auth_request
                     ├─ /oauth2/         → oauth2-proxy (127.0.0.1:4180)   — без auth_request
                     ├─ /health, /api/health                               — без auth_request
                     ├─ /netbox/api/     → NetBox (токены API)             — без auth_request, X-Remote-* затираются
                     │
                     └─ всё остальное: auth_request /oauth2/auth
                          ├─ /          → Портал (FastAPI, 127.0.0.1:3000)
                          ├─ /netbox/   → NetBox (REMOTE_AUTH по заголовку)
                          └─ /wiki/     → MediaWiki (Auth_remoteuser по заголовку)

Keycloak (realm «inion») ── опционально: федерация LDAP/AD (FreeIPA, ALD Pro, AD) и Kerberos
```

Поставщик SSO — **Keycloak** в контейнере на том же сервере, публикуется под `https://rep.local.inion/auth/`.
Keycloak — единая точка входа: по умолчанию с локальными пользователями, а при заданных переменных `LDAP_*` —
с федерацией пользователей из корпоративного каталога.

Проверкой сессии на краю занимается **oauth2-proxy** (OIDC-клиент Keycloak) через `auth_request` в Nginx.
Nginx передаёт в сервисы доверенные заголовки: `X-Remote-User`, `X-Remote-Email`, `X-Remote-Name`, `X-Remote-Groups`.

Группы и роли (создаются в realm):

| Группа Keycloak | Права |
|---|---|
| `portal-users` | вход на портал, просмотр каталога, NetBox только на чтение, Вики — чтение и правка |
| `portal-admins` | добавление, изменение и удаление систем на портале, журнал действий |
| `netbox-admins` | суперпользователь NetBox |
| `wiki-admins` | группа `sysop` в MediaWiki |

Доступ к домену открыт только членам `portal-users` (или любой из групп выше). Остальные получают 403 с понятной страницей.

---

## 2. Этап 1 — Keycloak

Новая папка `deploy/keycloak/`:
- `docker-compose.yml`: `keycloak` (официальный образ `quay.io/keycloak/keycloak`, актуальный стабильный тег 26.x)
  и отдельная база `keycloak-postgres`. Сеть `services-network`, порт `127.0.0.1:8081:8080`, healthcheck.
- Запуск в production-режиме (`start --optimized` или `start`, но не `start-dev`), настройки:
  - `KC_HTTP_RELATIVE_PATH=/auth`, `KC_HOSTNAME=https://rep.local.inion/auth`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true`;
  - `KC_HEALTH_ENABLED=true`, логин и пароль начального администратора — из `.env`.
- `realm-inion.json`, импортируется при первом старте (`--import-realm`). В нём:
  - realm `inion`, язык интерфейса по умолчанию `ru`, включена защита от перебора паролей, политика паролей не слабее 12 символов;
  - группы из таблицы выше;
  - confidential-клиент `rep-portal` с redirect URI `https://rep.local.inion/oauth2/callback`,
    `post.logout.redirect.uris` = `https://rep.local.inion/*` и PKCE S256;
  - маппер `groups` (Group Membership, без полного пути) в ID token, access token и userinfo;
  - маппер `preferred_username`, стандартные `email` и `name`;
  - время жизни SSO-сессии — рабочий день (10 ч), idle — 30 мин (вынести в переменные).
- Секрет клиента и пароль администратора не хранятся в JSON: подставляются из `.env` при установке или через `kcadm.sh`.
- `deploy/keycloak/configure.sh` — идемпотентная донастройка через `kcadm.sh`:
  - если заданы `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USERS_DN` и прочие, создаёт или обновляет
    User Federation (read-only, группы через `group-ldap-mapper`, сопоставление групп каталога с группами из таблицы);
  - если LDAP не задан, создаёт двух тестовых пользователей (`admin.portal` в `portal-admins`/`netbox-admins`/`wiki-admins`,
    `user.portal` в `portal-users`) со случайными паролями и дописывает их в `credentials-*.txt`;
  - опционально (флаг `KERBEROS_ENABLED`) — вход по Kerberos/SPNEGO для доменных рабочих станций. Опиши в документации, что для этого нужно.
- Своя тема входа `deploy/keycloak/themes/rep/login` в стиле портала: тёмная, градиент синий→бирюзовый, логотип портала.
  Шрифты не тянуть из интернета.
- Консоль администратора `/auth/admin/` в Nginx закрыть списком разрешённых IP (переменная `KEYCLOAK_ADMIN_ALLOW`,
  по умолчанию локальные подсети).

## 3. Этап 2 — oauth2-proxy и Nginx

`deploy/oauth2-proxy/docker-compose.yml`: официальный образ `quay.io/oauth2-proxy/oauth2-proxy` (закреплённый тег 7.x),
порт `127.0.0.1:4180`. Ключевые параметры:
- `provider=keycloak-oidc`, `oidc-issuer-url=https://rep.local.inion/auth/realms/inion`, `client-id=rep-portal`,
  секрет — из `.env`, `code-challenge-method=S256`;
- `reverse-proxy=true`, `set-xauthrequest=true`, `skip-provider-button=true`, `email-domain=*`;
- `allowed-group=portal-users,portal-admins,netbox-admins,wiki-admins`, `oidc-groups-claim=groups`;
- cookie: имя `_rep_sso`, `cookie-secure=true`, `cookie-samesite=lax`, `cookie-expire=10h`, `cookie-refresh=5m`,
  `cookie-secret` из `.env`;
- `redirect-url=https://rep.local.inion/oauth2/callback`, `whitelist-domain=rep.local.inion`;
- `backend-logout-url` — выход из Keycloak (end_session с `id_token_hint`).
- Сессии хранить в Redis (отдельный контейнер `sso-redis` с паролем): с группами токены большие, cookie разрастаются.
- **Самоподписанный сертификат.** Контейнер oauth2-proxy должен резолвить `rep.local.inion` на хост
  (`extra_hosts: rep.local.inion:host-gateway`) и доверять сертификату из `/etc/nginx/ssl/` (`--provider-ca-file`).
  Проверь, что `generate-ssl.sh` выпускает сертификат с SAN `DNS:rep.local.inion` и IP сервера. Если нет — исправь скрипт.
  Отключать проверку TLS нельзя.

Nginx (`deploy/nginx/rep.local.inion.conf`):
- `location = /oauth2/auth` (internal) и `location /oauth2/` → oauth2-proxy;
- `location /auth/` → Keycloak, с `X-Forwarded-*`. Увеличить `proxy_buffer_size`, `proxy_buffers`,
  `large_client_header_buffers` — иначе будет 502 «upstream sent too big header»;
- в защищённых `location`:
  ```nginx
  auth_request /oauth2/auth;
  error_page 401 = @sso_login;          # 302 на /oauth2/start?rd=<текущий URL>
  auth_request_set $sso_user   $upstream_http_x_auth_request_preferred_username;
  auth_request_set $sso_email  $upstream_http_x_auth_request_email;
  auth_request_set $sso_groups $upstream_http_x_auth_request_groups;
  auth_request_set $sso_cookie $upstream_http_set_cookie;
  add_header Set-Cookie $sso_cookie;
  proxy_set_header X-Remote-User   $sso_user;
  proxy_set_header X-Remote-Email  $sso_email;
  proxy_set_header X-Remote-Groups $sso_groups;
  ```
  Общие куски вынести в `include`-файлы (`deploy/nginx/snippets/sso-protect.conf`, `sso-headers.conf`) и не копировать.
- **Защита от подмены заголовков (обязательно).** Во всех `location`, которые ведут к порталу, NetBox и Вики,
  в том числе без `auth_request` (например, `/netbox/api/`, `/api/health`), затирать `X-Remote-*`:
  `proxy_set_header X-Remote-User "";` и так далее. Иначе клиент подставит себе чужого пользователя.
  Этот сценарий проверяется в тестах этапа 7.
- `/netbox/logout/` и выход в Вики перенаправлять на единый выход: `/oauth2/sign_out?rd=<URL выхода Keycloak>`.
- Страница 403 для пользователя без нужной группы — простая HTML-страница в стиле портала с кнопкой «Выйти».
- Всё, что уже настроено (`/netbox/static/`, срезание `/wiki/`, security headers, редиректы `= /netbox`, `= /wiki`), сохранить.

## 4. Этап 3 — бэкенд портала (FastAPI)

`portal/backend/app.py` (при необходимости разбей на модули):
- **Пользователь из заголовков.** Зависимость `current_user()` читает `X-Remote-User/Email/Name/Groups`.
  Портал слушает только 127.0.0.1, поэтому заголовкам можно доверять.
  Для локальной разработки — `PORTAL_DEV_USER` и `PORTAL_DEV_GROUPS`, которые включаются только при `PORTAL_ENV=dev`.
- `GET /api/me` → `{ username, name, email, groups, isAdmin }`. `isAdmin` = член `portal-admins` (имя группы из переменной).
- Модель системы расширить до модели эталонного UI:
  `id, name, description, url, icon, accent, category, tags[], owner, healthUrl, internalHealthUrl, newTab, pinned, builtin, createdAt, updatedAt`.
  Старые записи в `/data/systems.json` мигрировать при чтении, подставляя значения по умолчанию.
- CRUD по контракту из `design/ui-reference/README.md`:
  `GET/POST /api/systems`, `PUT/DELETE /api/systems/{id}`, `PUT /api/systems` (замена всего списка),
  плюс существующий `POST /api/systems/restore-defaults`. Изменять данные может только `isAdmin`, остальным — 403.
  Проверки на сервере: обязательные поля, уникальность имени и `url`, формат `url` (`/…` или `http(s)://…`).
- **Журнал действий на сервере:** `GET /api/audit` (только для админов), файл `/data/audit.jsonl`, хранить последние N записей.
  Каждая запись: время, пользователь, действие (create/update/delete/import/reset), объект, изменённые поля.
- **Мониторинг.** `GET /api/status` проверяет сервисы **напрямую по внутренним адресам, в обход SSO**, иначе редирект
  на страницу входа даст 200 и выключенный сервис будет выглядеть рабочим. Для встроенных систем:
  - NetBox — `http://netbox:8080/netbox/login/`;
  - Вики — `http://mediawiki/index.php`;
  - портал — локальный `/api/health`;
  - Keycloak — `http://keycloak:8080/auth/health/ready`;
  - oauth2-proxy — `http://oauth2-proxy:4180/ping` (поправь имена хостов под реальные имена контейнеров).
  Для пользовательских систем используется `internalHealthUrl`, а если он не задан — `healthUrl`/`url` без редиректов;
  ответ 3xx на страницу входа не считается «работает». Проверки выполняются параллельно (`asyncio.gather`) с таймаутом,
  результат кешируется на 15–30 с. Ответ содержит `status`, `latencyMs`, `httpCode`, `checkedAt`.
  Добавь тот же фоновый опрос, чтобы история (последние 40 точек на систему) хранилась на сервере и отдавалась в `/api/status`.
- CORS `allow_origins=["*"]` убрать: фронтенд и API на одном домене.

## 5. Этап 4 — новый фронтенд

- Замени `portal/frontend/src` интерфейсом из `design/ui-reference/src`. Сборку оставь на **Vite** (`vite.config.js` уже есть):
  перенеси компоненты, стили и страницы, `build.mjs` из эталона не нужен. Ничего не грузить из CDN и Google Fonts:
  сеть закрытая.
- Хранилище — только API. Режим localStorage для каталога и журнала убери, localStorage оставь лишь для личных настроек
  (тема, вид, интервал обновления).
- Статусы брать из `GET /api/status` (опрос раз в N секунд), а не проверять из браузера.
- Шапка: аватар с инициалами, имя, e-mail, группы. Меню пользователя: «Профиль» (ссылка на
  `/auth/realms/inion/account/`) и «Выйти» (единый выход).
- Роли в интерфейсе: у обычного пользователя нет кнопок «Добавить», «Редактировать», «Удалить», импорта и сброса,
  журнал ему не виден. Бэкенд при этом всё равно проверяет права.
- Журнал действий читается из `/api/audit` и показывает автора каждого действия.
- Обработка ошибок: 401 или истёкшая сессия (ответ API с редиректом или 401) → перезагрузка на `/oauth2/start?rd=…`;
  403 → понятное сообщение.
- Эталонное поведение сохрани: тёмная и светлая тема, `Ctrl+K`, `/`, `N`, отмена удаления, адаптив под телефон,
  доступность с клавиатуры.
- Кнопку «Отменить удаление» реализуй через повторный `POST` исходной записи, сохранив её `id`.

## 6. Этап 5 — NetBox

- В `deploy/netbox/env.example` и `gen-env.sh`: `REMOTE_AUTH_ENABLED=True`, `REMOTE_AUTH_HEADER=HTTP_X_REMOTE_USER`,
  `REMOTE_AUTH_USER_EMAIL=HTTP_X_REMOTE_EMAIL`, `REMOTE_AUTH_AUTO_CREATE_USER=True`,
  `REMOTE_AUTH_GROUP_SYNC_ENABLED=True`, `REMOTE_AUTH_GROUP_HEADER=HTTP_X_REMOTE_GROUPS`,
  `REMOTE_AUTH_GROUP_SEPARATOR=,`, `REMOTE_AUTH_AUTO_CREATE_GROUPS=True`,
  `REMOTE_AUTH_SUPERUSER_GROUPS=netbox-admins`, `REMOTE_AUTH_STAFF_GROUPS=netbox-admins`.
- В `configuration/extra.py`: `REMOTE_AUTH_DEFAULT_PERMISSIONS` — только просмотр
  (`{'dcim.view_*'…}` или через `ObjectPermission` с `actions=['view']`). Как NetBox 4.7 это поддерживает, проверь по документации.
- Проверь, что `/netbox/api/` с токеном (`Authorization: Token …`) работает без SSO, а подставленный вручную `X-Remote-User`
  в этом location игнорируется (Nginx его затирает).
- Локальный `admin` остаётся аварийным входом: только через SSH-туннель на `127.0.0.1:8000`. Опиши это в документации.
- LDAP-заготовку в `configuration/ldap/` не удаляй, но и не используй: вход теперь идёт через SSO.

## 7. Этап 6 — MediaWiki

- Собери свой образ `deploy/mediawiki/Dockerfile`: `FROM mediawiki:1.41` (тег как сейчас) + расширение
  **Auth_remoteuser** ветки `REL1_41`. Скачивать при сборке с проверкой контрольной суммы или положить в `deploy/mediawiki/extensions/`.
  В `docker-compose.yml` вместо `image:` — `build:`.
- В `LocalSettings.template.php`:
  - `wfLoadExtension('Auth_remoteuser');`, имя пользователя из `$_SERVER['HTTP_X_REMOTE_USER']`;
  - e-mail и настоящее имя через `$wgAuthRemoteuserUserPrefsForced`;
  - `$wgGroupPermissions['*']['autocreateaccount'] = true;`, анонимный просмотр отключить, правка — для `user`;
  - хук, который по `HTTP_X_REMOTE_GROUPS` добавляет в `sysop` членов `wiki-admins` и убирает оттуда остальных;
  - `$wgAuthRemoteuserUserUrls['logout']` → единый выход;
  - `$wgAuthManagerAutoConfig`/`$wgInvalidUsernameCharacters`: учти, что MediaWiki делает первую букву имени заглавной
    и не допускает некоторые символы. Опиши, как это сопоставляется с логинами из каталога.
- `install-wiki.sh` должен работать с новым образом, причём и на чистой установке, и на уже существующей.

## 8. Этап 7 — установка, бэкапы, документация

- `install.sh`: новые шаги в правильном порядке. Сначала SSL, потом Keycloak (дождаться `health/ready`, импорт realm,
  `configure.sh`), потом oauth2-proxy, затем NetBox, Вики, портал и Nginx. Добавь проверки после установки (smoke checks).
- `gen-env.sh`: генерирует `KEYCLOAK_ADMIN_PASSWORD`, пароль БД Keycloak, `OIDC_CLIENT_SECRET` (одинаковый в Keycloak и oauth2-proxy),
  `OAUTH2_PROXY_COOKIE_SECRET` (32 байта, base64), пароль `sso-redis`. Всё записывает в `credentials-*.txt`.
- `backup.sh`: добавь `pg_dump` базы Keycloak и экспорт realm.
- systemd: юниты `keycloak.service` и `oauth2-proxy.service` по образцу существующих, порядок зависимостей.
- Документация:
  - `docs/SSO.md` — схема, группы, как подключить LDAP/AD (FreeIPA, ALD Pro, Active Directory) и Kerberos,
    как добавить пользователя или администратора, как подключить к SSO новую систему (шаблон `location` с `include`),
    аварийный вход, типовые ошибки (502 too big header, redirect loop, неверный issuer, самоподписанный сертификат);
  - обнови `docs/DEPLOY.md` и `README.md`.

## 9. Этап 8 — автотесты и проверка

Добавь `tests/e2e/` на Playwright (запуск в контейнере `mcr.microsoft.com/playwright`, скрипт `deploy/scripts/e2e.sh`)
и `tests/api/` на pytest. Сценарии:
1. Неавторизованный `GET /`, `/netbox/`, `/wiki/` → редирект на страницу входа Keycloak.
2. Вход под `user.portal` → портал открыт. Переход в NetBox и Вики **без повторного ввода пароля**, пользователь в обоих тот же.
3. `user.portal`: в интерфейсе нет «Добавить»; `POST /api/systems` → 403. В NetBox только просмотр.
4. `admin.portal`: добавляет систему, правит её, удаляет, отменяет удаление. В журнале отображается автор. В NetBox он суперпользователь, в Вики — `sysop`.
5. Выход с портала → `/netbox/` и `/wiki/` снова требуют входа.
6. Подмена заголовка: `curl -H 'X-Remote-User: admin' https://rep.local.inion/netbox/api/…` и то же для `/`, `/wiki/`
   без cookie → **не** авторизует.
7. `/netbox/api/` с токеном работает; `/health` и `/api/health` доступны без входа.
8. Остановленный контейнер NetBox → на портале статус «Недоступна» (а не «работает» из-за страницы входа).
9. Пользователь без нужных групп → 403-страница.

Все сценарии должны проходить на тестовой установке. Если нет доступа к реальному Red OS, прогони стек через Docker Compose
локально: Nginx в контейнере с тем же конфигом и самоподписанным сертификатом. Отдельно перечисли, что осталось
непроверенным именно на Red OS (SELinux, firewalld).

## 10. Критерии приёмки

- [ ] `sudo bash deploy/scripts/install.sh` на чистом Red OS 8 поднимает всё без ручных шагов; повторный запуск ничего не ломает.
- [ ] Один вход — доступ к порталу, NetBox и Вики; один выход — выход везде.
- [ ] Права по группам работают и на фронтенде, и на бэкенде.
- [ ] Заголовки `X-Remote-*` нельзя подделать ни в одном location.
- [ ] Статусы систем на портале честные: учтено, что SSO отвечает страницей входа.
- [ ] Новый интерфейс портала полностью перенесён, ничего не грузит из интернета, собирается в Dockerfile.
- [ ] LDAP/AD подключается переменными окружения без правки кода.
- [ ] Пароли и секреты не попали в git.
- [ ] Автотесты из этапа 8 зелёные, `docs/SSO.md` написан.

В конце дай краткий отчёт: что сделано, какие файлы добавлены или изменены, как запустить тесты, что проверить руками на сервере
и какие решения ты принял сам.
