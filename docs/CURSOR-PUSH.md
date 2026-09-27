# Выгрузка изменений в GitHub через Cursor

Как без ошибок отправить изменения проекта в `https://github.com/DanteALI1/portal`
с помощью Cursor: через агента или вручную.

Сейчас изменения лежат на сервере `192.168.1.48` в `/home/svcsec/portal`
и ещё не закоммичены. Есть два способа работы:

- **Вариант A (рекомендуется).** Cursor подключается к серверу по SSH и работает
  прямо с `/home/svcsec/portal`. Ничего не нужно копировать.
- **Вариант B.** Cursor работает на вашем компьютере, изменения переносятся
  patch-файлом.

---

## 0. Подготовка (один раз)

1. **Права на запись в репозиторий.** Ваш GitHub-аккаунт должен быть владельцем
   `DanteALI1/portal` или соавтором (Settings → Collaborators). Иначе будет
   `Permission denied` / `403`.
2. **Аутентификация.** GitHub **не принимает пароль** при `git push` по HTTPS.
   Подойдёт любой из способов:
   - `gh auth login` (GitHub CLI), затем `gh auth setup-git`;
   - Personal Access Token (GitHub → Settings → Developer settings → Tokens,
     право `repo`). Вводите его вместо пароля;
   - SSH-ключ, добавленный в GitHub, и remote вида `git@github.com:DanteALI1/portal.git`.
3. **Имя автора коммитов** (без него будет `Author identity unknown`):
   ```bash
   git config --global user.name  "Ваше Имя"
   git config --global user.email "you@example.com"
   ```

---

## Вариант A. Cursor по SSH к серверу

1. В Cursor: `Ctrl+Shift+P` → **Remote-SSH: Connect to Host…** → `svcsec@192.168.1.48`.
2. **File → Open Folder** → `/home/svcsec/portal`.
3. Откройте чат агента (`Ctrl+I`) и вставьте промт из раздела «Промт для агента Cursor» ниже.

## Вариант B. Cursor на своём компьютере

1. Скачайте patch с сервера:
   ```bash
   scp svcsec@192.168.1.48:~/portal-changes.patch .
   ```
2. Склонируйте репозиторий и откройте его в Cursor:
   ```bash
   git clone https://github.com/DanteALI1/portal.git
   cd portal
   ```
3. Примените patch:
   ```bash
   git apply --check ../portal-changes.patch
   git apply ../portal-changes.patch
   ```
   Если `--check` выдал ошибку, значит `main` на GitHub ушёл вперёд. Попробуйте
   `git apply --3way ../portal-changes.patch` и разрешите конфликты.
4. Дальше используйте тот же промт для агента.

> **Windows:** в репозитории есть `.gitattributes`, который заставляет git
> хранить `.sh`, `.py`, `.conf` и `.yml` с переводами строк LF. Не отключайте
> его. С CRLF скрипты на сервере падают с ошибкой `$'\r': command not found`.

---

## Промт для агента Cursor

Скопируйте целиком:

```text
Нужно выгрузить текущие незакоммиченные изменения этого репозитория в GitHub
(DanteALI1/portal) через отдельную ветку и Pull Request. Работай строго по шагам,
после каждого шага показывай вывод команды. При любой ошибке остановись и покажи её,
ничего не «чини» через force-push, reset --hard или удаление файлов.

1. Проверки:
   git status
   git remote -v            # должен быть github.com/DanteALI1/portal
   git config user.name && git config user.email   # если пусто — спроси меня

2. Убедись, что в коммит НЕ попадут секреты и мусор. Ни один из этих путей не должен
   быть в выводе `git status --porcelain`:
   .env, *.env (кроме env.example), LocalSettings.php, LocalSettings.generated.php,
   credentials-*.txt, node_modules/, dist/, portal/data/, *.log, *.bak, *.patch
   Дополнительно выполни:
   git diff | grep -nEi '(password|secret|token)\s*=\s*["'"'"']?[A-Za-z0-9]{12,}' || echo "no secrets"
   Если что-то нашлось — остановись и покажи мне.

3. Проверь синтаксис:
   for f in deploy/scripts/*.sh; do bash -n "$f" && echo "OK $f"; done
   python3 -c "import ast;ast.parse(open('portal/backend/app.py').read())"
   (если есть node) cd portal/frontend && npm ci && npm run build && cd ../..

4. Обнови main и создай ветку:
   git fetch origin
   git stash
   git checkout main && git pull --ff-only origin main
   git checkout -b fix/red-os-deploy
   git stash pop
   Если stash pop дал конфликт — остановись и покажи конфликтующие файлы.

5. Добавь файлы ЯВНО по списку (не `git add -A`):
   git add .gitattributes README.md docs/DEPLOY.md docs/CURSOR-PUSH.md \
     deploy/scripts/install.sh deploy/scripts/gen-env.sh deploy/scripts/install-wiki.sh \
     deploy/mediawiki/docker-compose.install.yml deploy/mediawiki/LocalSettings.template.php \
     deploy/nginx/rep.local.inion.conf \
     portal/backend/app.py portal/frontend/src/App.jsx portal/frontend/src/styles.css
   git status   # покажи, что staged только эти файлы

6. Коммит:
   git commit -m "Fix RED OS 8 deployment; allow deleting systems in portal" \
     -m "- install.sh: replace podman-docker shim with Docker CE from RED OS repos
   - install.sh: keep .env / LocalSettings.php on re-run; fix cron step under pipefail
   - gen-env.sh: quote values with spaces; add server IPs to ALLOWED_HOSTS / CSRF_TRUSTED_ORIGINS
   - mediawiki: !override volumes for install phase; LocalSettings readable by www-data; host-aware wgServer
   - nginx: serve NetBox static files at /netbox/static/
   - portal: fix 204 DELETE crash; delete any card incl. built-ins, confirm dialog, restore defaults
   - docs: DEPLOY.md (deployment guide), CURSOR-PUSH.md; .gitattributes for LF"

7. Отправка:
   git push -u origin fix/red-os-deploy
   Если спрашивает пароль — это нужен токен/gh auth, остановись и скажи мне.

8. Pull Request (если установлен gh):
   gh pr create --base main --head fix/red-os-deploy \
     --title "Fix RED OS 8 deployment; allow deleting systems in portal" \
     --body "См. docs/DEPLOY.md, раздел «Устранение неполадок». Проверено на RED OS 8.0.3."
   Если gh нет — дай мне ссылку https://github.com/DanteALI1/portal/compare/main...fix/red-os-deploy
```

---

## Частые ошибки при push

| Ошибка | Причина | Что делать |
|---|---|---|
| `Author identity unknown` | Не задано имя или email | `git config --global user.name/user.email` |
| `Support for password authentication was removed` | При HTTPS ввели пароль | Используйте токен или `gh auth login` |
| `Permission denied` / `403` | Нет прав на запись в репозиторий | Получить права соавтора или сделать fork и PR из него |
| `rejected ... (fetch first)` / `non-fast-forward` | На GitHub появились новые коммиты | `git pull --rebase origin <ветка>`, затем `git push`. **Не** `--force` |
| `$'\r': command not found` на сервере | Скрипты попали в репозиторий с CRLF | Проверить, что в репозитории есть `.gitattributes`; `git add --renormalize .` |
| `git apply: patch does not apply` | `main` изменился после создания patch | `git apply --3way`, разрешить конфликты |
| В PR попал `.env` или пароли | Использовали `git add -A` | Убрать файл из коммита и **сменить все пароли**: они уже утекли |

## Проверка результата

- На GitHub в ветке `fix/red-os-deploy` 13 изменённых или новых файлов, среди
  них нет `.env`, `LocalSettings.php` и `credentials-*.txt`.
- После слияния PR новая установка по [DEPLOY.md](DEPLOY.md) проходит без ручных правок.
