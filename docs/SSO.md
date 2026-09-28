# Единый вход (SSO) на rep.local.inion

Пользователь входит один раз и попадает в портал, NetBox и Вики без повторного ввода пароля.
Выход из любой системы завершает сессию везде.

## 1. Как это устроено

```
Браузер ──HTTPS──> Nginx (хост, :443, TLS)
                     │
                     ├─ /auth/           → Keycloak (127.0.0.1:8081)        без проверки сессии
                     ├─ /oauth2/         → oauth2-proxy (127.0.0.1:4180)    без проверки сессии
                     ├─ /health, /api/health                                без проверки сессии
                     ├─ /netbox/api/     → NetBox, вход по токену API       без SSO, X-Remote-* затираются
                     ├─ /netbox/static/  → статика NetBox
                     │
                     └─ всё остальное: auth_request /oauth2/auth
                          ├─ /          → портал (FastAPI, 127.0.0.1:3000)
                          ├─ /netbox/   → NetBox (REMOTE_AUTH по заголовку)
                          └─ /wiki/     → MediaWiki (Auth_remoteuser по заголовку)
```

1. На каждый запрос к защищённой странице Nginx спрашивает oauth2-proxy (`auth_request /oauth2/auth`),
   есть ли у браузера сессия (cookie `_rep_sso`, данные сессии хранятся в Redis `sso-redis`).
2. Сессии нет: oauth2-proxy отправляет браузер на страницу входа Keycloak (realm `inion`) и после входа
   возвращает на ту страницу, куда шёл пользователь.
3. Сессия есть: oauth2-proxy отдаёт Nginx имя, e-mail, группы и access-токен. Nginx передаёт их
   сервису в доверенных заголовках:

   | Заголовок | Значение |
   |---|---|
   | `X-Remote-User` | логин (`preferred_username`) |
   | `X-Remote-Email` | e-mail |
   | `X-Remote-Groups` | группы через запятую |
   | `X-Remote-Token` | access-токен Keycloak; из него портал и Вики берут полное имя (у oauth2-proxy нет заголовка с именем) |

4. Сервисы доверяют этим заголовкам, потому что слушают только `127.0.0.1`, а Nginx **затирает**
   `X-Remote-*` во всех `location`, в том числе без SSO (`/netbox/api/`, `/api/health`, `/oauth2/`, `/auth/`).
   Подставить себе чужого пользователя заголовком нельзя: это проверяет автотест 6.

Вход по IP (`https://192.168.1.48/...`) перенаправляется на `https://rep.local.inion/...`: cookie,
адрес Keycloak и redirect URI привязаны к имени. На клиентах имя должно резолвиться в IP сервера
(DNS или hosts).

Файлы:

| Что | Где в репозитории | Где на сервере |
|---|---|---|
| Keycloak, realm, тема входа, донастройка | `deploy/keycloak/` | `/opt/services/keycloak/` |
| oauth2-proxy, страница ошибки | `deploy/oauth2-proxy/` | `/opt/services/oauth2-proxy/` |
| vhost и snippets Nginx | `deploy/nginx/` | `/etc/nginx/conf.d/portal.conf`, `/etc/nginx/rep/` |
| Имена групп, домен | `deploy/sso.env.example` | `/opt/services/sso.env` |

## 2. Группы и права

| Группа | Портал | NetBox | Вики |
|---|---|---|---|
| `portal-users` | вход, просмотр каталога и мониторинга | только просмотр | чтение и правка |
| `portal-admins` | + добавление, изменение, удаление, импорт, сброс, журнал действий | только просмотр | чтение и правка |
| `netbox-admins` | вход | суперпользователь | чтение и правка |
| `wiki-admins` | вход | только просмотр | + группа `sysop` |

- Войти на домен может член **любой** из этих групп. Остальные после входа видят страницу «Нет доступа» (403).
- Права проверяются на сервере. Интерфейс портала лишь прячет недоступные кнопки.
- NetBox: группы синхронизируются при каждом входе (`REMOTE_AUTH_GROUP_SYNC_ENABLED`), члены `netbox-admins`
  становятся суперпользователями. «Только просмотр» — это право `SSO: только просмотр` (`ObjectPermission`,
  `actions=['view']` на все типы объектов), его создаёт `deploy/netbox/post-install.py`.
  В NetBox 4.7 `REMOTE_AUTH_DEFAULT_PERMISSIONS` не поддерживает маски вида `view_*`, поэтому право выдаётся группам.
- Вики: группа `sysop` выдаётся и снимается на каждом запросе по членству в `wiki-admins`.

Имена групп можно заменить в `/opt/services/sso.env` (например, на существующие группы AD) и повторить
`sudo bash deploy/scripts/install.sh`: `gen-env.sh` разнесёт их по всем сервисам.

## 3. Пользователи

### Локальные пользователи Keycloak (по умолчанию)

Без LDAP установщик создаёт двух тестовых пользователей, пароли — в `/opt/services/credentials-*.txt`:

| Логин | Группы |
|---|---|
| `admin.portal` | все четыре группы |
| `user.portal` | `portal-users` |

Добавить пользователя или администратора:

1. Консоль Keycloak: `https://rep.local.inion/auth/admin/` (логин `admin`, пароль — в `credentials-*.txt`).
   Консоль открывается только из сетей `KEYCLOAK_ADMIN_ALLOW` (`/opt/services/keycloak/.env`).
2. Выберите realm **inion** → *Users* → *Add user*. Укажите логин, e-mail, имя и фамилию,
   включите *Email verified*.
3. *Credentials* → *Set password* (не короче 12 символов; политика realm).
4. *Groups* → *Join group* → `portal-users`, для администратора дополнительно `portal-admins` и т. п.

Изменения групп применяются при следующем входе пользователя. Чтобы применить сразу, завершите его сессии:
*Users* → пользователь → *Sessions* → *Sign out*.

### LDAP / Active Directory / FreeIPA / ALD Pro

Заполните в `/opt/services/keycloak/.env` (значения с пробелами — в кавычках) и выполните
`sudo bash deploy/scripts/install.sh`:

| Переменная | Active Directory | FreeIPA / ALD Pro |
|---|---|---|
| `LDAP_URL` | `ldaps://dc1.example.ru:636` | `ldaps://ipa.example.ru:636` |
| `LDAP_VENDOR` | `ad` | `freeipa` (или `aldpro`) |
| `LDAP_BIND_DN` | `"CN=svc-keycloak,OU=Service,DC=example,DC=ru"` | `uid=svc-keycloak,cn=users,cn=accounts,dc=example,dc=ru` |
| `LDAP_BIND_PASSWORD` | пароль сервисной учётной записи | то же |
| `LDAP_USERS_DN` | `"OU=Users,DC=example,DC=ru"` | `cn=users,cn=accounts,dc=example,dc=ru` |
| `LDAP_GROUPS_DN` | `"OU=Groups,DC=example,DC=ru"` | `cn=groups,cn=accounts,dc=example,dc=ru` |
| `LDAP_USER_FILTER` | необязательно, например `(memberOf=CN=Portal,OU=Groups,DC=example,DC=ru)` | — |

`deploy/keycloak/configure.sh` создаёт (или обновляет) федерацию `ldap` в режиме **только чтение**
с маппером групп `groups` и запускает синхронизацию. Тестовые пользователи в этом режиме не создаются.

Сопоставление групп каталога с ролями: либо создайте в каталоге группы с именами из таблицы раздела 2,
либо укажите в `/opt/services/sso.env` имена существующих групп каталога:

```bash
SSO_GROUP_USERS=GG-Portal-Users
SSO_GROUP_PORTAL_ADMINS=GG-Portal-Admins
SSO_GROUP_NETBOX_ADMINS=GG-Network-Admins
SSO_GROUP_WIKI_ADMINS=GG-Wiki-Admins
```

Проверка: консоль Keycloak → *User federation* → `ldap` → *Test connection* / *Test authentication*,
затем *Users* → поиск по логину из каталога.

> Режим LDAP/AD и Kerberos на тестовом стенде не проверялся (нет каталога): проверьте его на своей инфраструктуре.

### Kerberos (вход без пароля с доменных рабочих станций)

1. В каталоге создайте сервисный принципал `HTTP/rep.local.inion@EXAMPLE.RU` и выгрузите keytab
   (AD: `ktpass`, FreeIPA: `ipa service-add` + `ipa-getkeytab`).
2. Положите keytab в `/opt/services/keycloak/kerberos/keycloak.keytab` (права 600; файл не попадает в git).
3. В `/opt/services/keycloak/.env`: `KERBEROS_ENABLED=true`, `KERBEROS_REALM=EXAMPLE.RU`,
   `KERBEROS_PRINCIPAL=HTTP/rep.local.inion@EXAMPLE.RU` (нужен также настроенный LDAP).
4. `sudo bash deploy/scripts/install.sh`: в федерации включится Kerberos, в browser flow — шаг *Kerberos* (ALTERNATIVE).
5. На клиентах добавьте `https://rep.local.inion` в доверенные для SPNEGO
   (групповая политика «Intranet zone» / `network.negotiate-auth.trusted-uris` в Firefox).

## 4. Имена пользователей в Вики

MediaWiki хранит имя с заглавной первой буквы: `user.portal` в Keycloak → `User.portal` в Вики.
Это та же учётная запись, её автоматически создаёт первый вход через SSO.
Логины вида `user@EXAMPLE.RU` и `EXAMPLE\user` обрезаются до `user`, символы `: > =` заменяются на `_`
(в именах MediaWiki они запрещены, см. `$wgInvalidUsernameCharacters`).
Если в каталоге есть логины, которые отличаются только регистром первой буквы, в Вики они совпадут.

## 5. Подключение к SSO новой системы

1. Поднимите контейнер системы в сети `services-network` с портом на `127.0.0.1`.
2. Добавьте `location` в `/etc/nginx/conf.d/portal.conf` (шаблон — `deploy/nginx/portal.conf`):

   ```nginx
   location /grafana/ {
       include /etc/nginx/rep/sso-protect.conf;   # вход через SSO, 302 на страницу входа
       proxy_pass http://127.0.0.1:3001;
       include /etc/nginx/rep/proxy-common.conf;
       include /etc/nginx/rep/sso-headers.conf;   # X-Remote-User/Email/Groups/Token
   }
   ```

   Для JSON API вместо `sso-protect.conf` подключайте `sso-protect-api.conf` (401/403 в JSON вместо редиректа).
   Для маршрутов **без** SSO обязательно подключайте `sso-strip.conf`, иначе клиент сможет передать
   сервису поддельный `X-Remote-User`.
3. `sudo nginx -t && sudo systemctl reload nginx`.
4. Настройте в самой системе вход по заголовку `X-Remote-User` (auth proxy / remote user) или оставьте
   её собственный вход — тогда SSO закрывает только доступ к адресу.
5. Добавьте систему на портале. В поле **«Внутренний адрес проверки»** укажите адрес внутри сети,
   например `http://grafana:3000/api/health`: через Nginx любая защищённая страница отвечает переадресацией
   на вход, и без внутреннего адреса статус будет «Нет данных».

## 6. Аварийный вход (SSO не работает)

- **NetBox:** локальный `admin` через SSH-туннель мимо Nginx:
  `ssh -L 8000:127.0.0.1:8000 svcsec@rep.local.inion`, затем `http://127.0.0.1:8000/netbox/login/`.
  Пароль — `SUPERUSER_PASSWORD` в `/opt/services/netbox/.env`.
- **Вики:** `ssh -L 8080:127.0.0.1:8080 ...`, затем `http://127.0.0.1:8080/index.php?title=Служебная:Вход`.
  Локальная учётная запись `WikiAdmin`, пароль — в `/opt/services/mediawiki/.env`.
  Страница входа скрыта расширением Auth_remoteuser; если она недоступна, временно поставьте
  `$wgAuthRemoteuserRemoveAuthPagesAndLinks = false;` в шаблоне и перезапустите `install-wiki.sh`.
- **Keycloak:** консоль `https://rep.local.inion/auth/admin/` (или туннель к `127.0.0.1:8081`),
  пользователь `admin` realm `master`.
- **API NetBox** работает по токену и без SSO: `Authorization: Token <SUPERUSER_API_TOKEN>`.

## 7. Типовые ошибки

| Симптом | Причина | Решение |
|---|---|---|
| 502 и в логе Nginx `upstream sent too big header` | большие cookie/токены с группами | уже увеличены `proxy_buffer_size` и `large_client_header_buffers`; при сотнях групп увеличьте ещё |
| 403 `invalid_scope ... groups` на `/oauth2/callback` | oauth2-proxy запрашивает scope `groups`, которого нет в realm | задан `--scope=openid email profile`, группы приходят из маппера клиента |
| Бесконечный редирект между порталом и Keycloak | cookie не сохраняется: вход по IP или http | открывайте `https://rep.local.inion`; проверьте время на сервере |
| `invalid issuer` / `failed to discover OIDC configuration` в логах oauth2-proxy | контейнер не видит Keycloak по имени или имя отличается | `extra_hosts: rep.local.inion:host-gateway`, `KC_HOSTNAME` должен совпадать с `--oidc-issuer-url` |
| `x509: certificate signed by unknown authority` в oauth2-proxy | сменили сертификат | `--provider-ca-file` смотрит на `/etc/nginx/ssl/rep.local.inion.crt`; после замены сертификата перезапустите oauth2-proxy и портал. Для сертификата корпоративного УЦ положите в этот файл цепочку с корневым сертификатом |
| После входа «Нет доступа» | пользователь не в группах портала | добавьте в `portal-users`, выйдите и войдите снова |
| Пользователь поменял группы, а права старые | группы берутся из токена при входе | выход/вход или завершение сессий в Keycloak |
| Статус системы на портале «Нет данных» | проверка упирается в страницу входа | задайте внутренний адрес проверки |
| `Invalid v1 token` в API NetBox | токена нет в базе (netbox-docker 5.x его не создаёт) | создаёт `post-install.py` из `SUPERUSER_API_TOKEN`; новые токены v2 работают благодаря `API_TOKEN_PEPPER_1` |

Логи: `sudo docker logs --tail 100 oauth2-proxy`, `... keycloak`, `/var/log/nginx/rep.local.inion.error.log`.

## 8. Проверка

```bash
sudo bash deploy/scripts/e2e.sh          # API (pytest) + браузер (Playwright)
sudo bash deploy/scripts/e2e.sh api      # только API
```

Сценарии: вход и переадресация на Keycloak, единый вход в три системы, права обычного пользователя,
действия администратора с журналом, единый выход, подделка заголовков, API по токену, честный мониторинг
при остановленном NetBox, пользователь без групп. Тесты создают и удаляют временного пользователя
`nogroup.e2e` и на ~1 минуту останавливают NetBox.
