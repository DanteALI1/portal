// Browser scenarios of single sign-on (docs/CLAUDE-TASK-SSO.md, stage 8).
const { test, expect } = require('@playwright/test');

const ADMIN = { user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASS };
const USER = { user: process.env.USER_USER, pass: process.env.USER_PASS };
const NOGROUP = { user: process.env.NOGROUP_USER, pass: process.env.NOGROUP_PASS };

async function keycloakLogin(page, who) {
  await expect(page).toHaveURL(/\/auth\/realms\/inion\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(who.user);
  await page.locator('#password').fill(who.pass);
  await page.locator('#kc-login').click();
}

async function openPortal(page, who) {
  await page.goto('/');
  await keycloakLogin(page, who);
  await expect(page.getByRole('heading', { level: 1, name: 'Каталог систем' })).toBeVisible();
}

test('1. anonymous user lands on the Keycloak login page in portal style', async ({ page }) => {
  for (const path of ['/', '/netbox/', '/wiki/']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/realms\/inion\/protocol\/openid-connect\/auth/);
    await expect(page.locator('#kc-login')).toBeVisible();
  }
  await expect(page.locator('.rep-brand')).toBeVisible(); // custom login theme
});

test('2. one login gives the portal, NetBox and wiki without a second password', async ({ page }) => {
  await openPortal(page, USER);
  await page.getByRole('button', { name: /^Пользователь / }).click();
  await expect(page.getByRole('menu')).toContainText(USER.user);
  await expect(page.getByRole('menu')).toContainText('portal-users');

  await page.goto('/netbox/');
  await expect(page).toHaveURL(/\/netbox\/$/);
  await expect(page.locator('body')).toContainText(USER.user);

  await page.goto('/wiki/');
  await expect(page).toHaveURL(/\/wiki\//);
  await expect(page.locator('#pt-userpage-2, #pt-userpage').first()).toContainText(/user\.portal/i);
});

test('3. regular user sees no editing controls', async ({ page }) => {
  await openPortal(page, USER);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Добавить' })).toHaveCount(0);
  await expect(page.locator('.add-card')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Журнал действий' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Действия: NetBox/ }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Копировать ссылку' })).toBeVisible();
});

test('4. admin adds, edits, deletes and undoes; the audit log shows the author', async ({ page }) => {
  const name = `E2E ${Date.now().toString(36)}`;
  await openPortal(page, ADMIN);

  await page.locator('.topbar').getByRole('button', { name: 'Добавить' }).click();
  await page.locator('#sys-name').fill(name);
  await page.locator('#sys-url').fill(`/e2e-${Date.now().toString(36)}/`);
  await page.getByRole('button', { name: 'Добавить систему', exact: true }).click();
  const card = page.locator('.sys-card', { hasText: name });
  await expect(card).toBeVisible();

  await page.getByRole('button', { name: `Действия: ${name}` }).first().click();
  await page.getByRole('menuitem', { name: 'Редактировать' }).click();
  await page.locator('#sys-desc').fill('Изменено автотестом');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(card).toContainText('Изменено автотестом');

  await page.getByRole('button', { name: `Действия: ${name}` }).first().click();
  await page.getByRole('menuitem', { name: 'Удалить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(card).toBeVisible();

  // Survives a reload (stored on the server, not in the browser)
  await page.reload();
  await expect(page.locator('.sys-card', { hasText: name })).toBeVisible();

  await page.getByRole('link', { name: 'Журнал действий' }).click();
  const entry = page.locator('.timeline__item', { hasText: name }).first();
  await expect(entry).toContainText('Восстановление');
  await expect(entry).toContainText(ADMIN.user);

  // Clean up
  await page.goto('/#overview');
  await page.getByRole('button', { name: `Действия: ${name}` }).first().click();
  await page.getByRole('menuitem', { name: 'Удалить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.sys-card', { hasText: name })).toHaveCount(0);
});

test('5. logout from the portal logs out of NetBox and wiki too', async ({ page }) => {
  await openPortal(page, USER);
  await page.goto('/netbox/');
  await expect(page).toHaveURL(/\/netbox\/$/);
  await page.goto('/');
  await page.getByRole('button', { name: /^Пользователь / }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/auth\/realms\/inion\/protocol\/openid-connect\/auth/);
  for (const path of ['/netbox/', '/wiki/']) {
    await page.goto(path);
    await expect(page.locator('#kc-login')).toBeVisible();
  }
});

test('9. user without portal groups gets the 403 page', async ({ page }) => {
  await page.goto('/');
  await keycloakLogin(page, NOGROUP);
  await expect(page.locator('body')).toContainText('Нет доступа');
  await expect(page.getByRole('link', { name: 'Выйти' })).toBeVisible();
});
