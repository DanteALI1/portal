# Параметры REP Portal — что и где менять

Единый справочник по всем настраиваемым параметрам развёртывания. Дополняет
[DEPLOY.md](DEPLOY.md) (процесс установки) и [SSO.md](SSO.md) (единый вход, LDAP/AD, Kerberos).

## Как устроены настройки

```
deploy/sso.env.example ──┐
                         ├─(install.sh → gen-env.sh)──► /opt/services/<сервис>/.env ──► контейнеры
/opt/services/sso.env  ──┘        секреты генерируются один раз, при повторе НЕ меняются
```

- **`/opt/services/sso.env`** — единственное место, где задаются **домен и имена групп**. `gen-env.sh`
  копирует их во все сервисы. Меняете здесь → повторяете `install.sh`.
- **`/opt/services/<сервис>/.env`** — рабочие настройки и секреты каждого сервиса. Пароли создаются
  автоматически при первой установке; повторный `install.sh` **никогда не перезаписывает** существующие значения.
- Файлы `deploy/**/env.example` в репозитории — это шаблоны/справка, сервер их не читает.

**Правило применения:** после правки `sso.env` или любого `.env` выполните
`sudo bash deploy/scripts/install.sh` (безопасно, идемпотентно) **или** перезапустите конкретный сервис:
`sudo systemctl restart <keycloak|oauth2-proxy|netbox|mediawiki|portal>`.

---

## 1. Задать ДО первой установки (важно)

| Параметр | Где | По умолчанию | Зачем |
|---|---|---|---|
| `DOMAIN` | `/opt/services/sso.env` (или `DOMAIN=` в `bootstrap.sh`/`install.sh`) | `rep.local.inion` | Имя портала. К нему привязан весь SSO; смена после установки требует переустановки и нового сертификата. |
| `SSO_GROUP_USERS` | `sso.env` | `portal-users` | Группа доступа к порталу (обычные пользователи). |
| `SSO_GROUP_PORTAL_ADMINS` | `sso.env` | `portal-admins` | Кто правит каталог и видит журнал портала. |
| `SSO_GROUP_NETBOX_ADMINS` | `sso.env` | `netbox-admins` | Суперпользователи NetBox (остальные — только чтение). |
| `SSO_GROUP_WIKI_ADMINS` | `sso.env` | `wiki-admins` | Sysop в MediaWiki. |
| **DNS / hosts** | клиенты + сервер | — | `DOMAIN` должен резолвиться в IP сервера на всех клиентах (SSO привязан к имени). |
| **SSL-сертификат** | `/etc/nginx/ssl/<DOMAIN>.{crt,key}` | самоподписанный | Для эксплуатации положите сертификат корпоративного УЦ (в `.crt` — цепочка до корня). |

> Быстрее всего задать это на пустом сервере через bootstrap:
> `sudo DOMAIN=corp.example SSO_GROUP_PORTAL_ADMINS=it-admins bash deploy/scripts/bootstrap.sh`

## 2. Keycloak — `/opt/services/keycloak/.env`

| Параметр | По умолчанию | Описание |
|---|---|---|
| `KEYCLOAK_ADMIN_USER` | `admin` | Логин консоли администратора `/auth/admin/`. |
| `KEYCLOAK_ADMIN_PASSWORD` | *(генерируется)* | Пароль консоли. Меняете — задайте своё значение и перезапустите Keycloak. |
| `KEYCLOAK_ADMIN_ALLOW` | `"127.0.0.1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"` | Сети, которым разрешён доступ к `/auth/admin/` (nginx allow-list). Здесь сузьте до админских подсетей. |
| `KC_SSO_SESSION_MAX` | `36000` (10 ч) | Максимум жизни SSO-сессии, сек. |
| `KC_SSO_SESSION_IDLE` | `1800` (30 мин) | Тайм-аут простоя сессии, сек. |
| `OIDC_CLIENT_SECRET` | *(генерируется)* | Секрет OIDC-клиента `rep-portal`. Должен совпадать с oauth2-proxy — синхронизируется автоматически. |
| `KC_DB_PASSWORD` | *(генерируется)* | Пароль БД Keycloak. Не менять после установки. |
| `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USERS_DN`, `LDAP_GROUPS_DN`, `LDAP_USER_FILTER` | пусто | Подключение каталога (AD/FreeIPA/ALD Pro). Подробно — в [SSO.md](SSO.md). |
| `LDAP_VENDOR` | `ad` | Тип каталога (`ad`, `rhds`, `other`…). |
| `LDAP_START_TLS` | `false` | StartTLS для LDAP. |
| `KERBEROS_ENABLED` / `KERBEROS_REALM` / `KERBEROS_PRINCIPAL` | `false` / пусто | Вход по Kerberos (SPNEGO), keytab кладётся в `deploy/keycloak/kerberos/`. |

После правок LDAP/Kerberos: `sudo bash deploy/scripts/install.sh` (перезапустит `configure.sh`).

## 3. NetBox — `/opt/services/netbox/.env`

| Параметр | По умолчанию | Описание |
|---|---|---|
| `VERSION` | `v4.7-5.1.1` | Тег образа netbox-docker. |
| `SUPERUSER_NAME` / `SUPERUSER_PASSWORD` | `admin` / *(генерируется)* | Локальный аварийный вход (через SSH-туннель на `127.0.0.1:8000`, мимо SSO). |
| `SUPERUSER_API_TOKEN` | *(генерируется)* | Токен для `…/netbox/api/` (`Authorization: Token …`). |
| `ALLOWED_HOSTS` | `"DOMAIN localhost 127.0.0.1 netbox <IP>"` | Разрешённые Host-заголовки Django. |
| `CSRF_TRUSTED_ORIGINS` | `https://DOMAIN https://<IP>` | Доверенные origin для CSRF. |
| `BASE_PATH` | `netbox/` | Портал монтирует NetBox по `/netbox/`. Менять только вместе с nginx-конфигом. |
| `REMOTE_AUTH_SUPERUSER_GROUPS` / `REMOTE_AUTH_STAFF_GROUPS` | `= SSO_GROUP_NETBOX_ADMINS` | Какие SSO-группы дают админ-права в NetBox (проставляются из `sso.env`). |
| `LOGIN_REQUIRED`, `METRICS_ENABLED`, `GRAPHQL_ENABLED` | `true`/`false`/`true` | Поведение NetBox. |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `API_TOKEN_PEPPER_1` | *(генерируются)* | Секреты. Не менять после установки. |

## 4. MediaWiki — `/opt/services/mediawiki/.env`

| Параметр | По умолчанию | Описание |
|---|---|---|
| `WIKI_SITENAME` | `"Корпоративная Вики"` | Название вики. |
| `WIKI_ADMIN_USER` / `WIKI_ADMIN_PASSWORD` | `WikiAdmin` / *(генерируется)* | Локальный аварийный вход (SSH-туннель на `127.0.0.1:8080`, мимо SSO). |
| `WIKI_DB_PASSWORD`, `MARIADB_ROOT_PASSWORD` | *(генерируются)* | Секреты БД. Не менять после установки. |

## 5. Портал и oauth2-proxy

| Параметр | Файл | По умолчанию | Описание |
|---|---|---|---|
| `PORTAL_ENV` | `/opt/services/portal/.env` | `prod` | `dev` включает подстановку пользователя без SSO (только для локальной разработки). |
| Оформление портала без пересборки | `/opt/services/portal/data/` → правится в UI; либо `portal/frontend/public/config.js` (домен, `supportContact`, интервалы, `slowThresholdMs`) | — | `config.js` отдаётся без кеша, применяется после перезагрузки страницы. |
| `OAUTH2_PROXY_CLIENT_SECRET` | `/opt/services/oauth2-proxy/.env` | *(= Keycloak)* | Синхронизируется с `OIDC_CLIENT_SECRET`. Не трогать вручную. |
| `OAUTH2_PROXY_COOKIE_SECRET`, `OAUTH2_PROXY_REDIS_PASSWORD` | там же | *(генерируются)* | Секреты сессий. Не менять после установки. |

## 6. Порты и сеть (обычно менять не нужно)

| Порт | Кто | Доступность |
|---|---|---|
| 80 / 443 | nginx | публично (80 → 301 на 443) |
| 3000 | портал (FastAPI) | только `127.0.0.1` |
| 4180 | oauth2-proxy | только `127.0.0.1` |
| 8000 | NetBox | только `127.0.0.1` (аварийный вход через SSH-туннель) |
| 8080 | MediaWiki | только `127.0.0.1` |
| 8081 | Keycloak | только `127.0.0.1` |

Docker-сеть `services-network` — `172.28.0.0/16` (шаг 4 `install.sh`). Меняется там же, если подсеть занята.

---

## Типовые сценарии

- **Свой домен и группы:** задать в `/opt/services/sso.env` (или через `bootstrap.sh`), затем `install.sh`.
- **Прод-сертификат:** положить в `/etc/nginx/ssl/<DOMAIN>.{crt,key}`, затем
  `sudo systemctl reload nginx && sudo docker restart oauth2-proxy portal`.
- **Ограничить консоль Keycloak:** сузить `KEYCLOAK_ADMIN_ALLOW` → `install.sh` (перегенерирует nginx allow-list).
- **Подключить AD/LDAP:** заполнить `LDAP_*` в `keycloak/.env` → `install.sh`; см. [SSO.md](SSO.md).
- **Сменить пароль админ-консоли Keycloak:** задать `KEYCLOAK_ADMIN_PASSWORD` → `sudo systemctl restart keycloak`.
- **Посмотреть все выданные пароли:** `sudo cat /opt/services/credentials-*.txt`.
