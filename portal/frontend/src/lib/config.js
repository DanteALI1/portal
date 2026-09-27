// Конфигурация портала.
// Значения по умолчанию можно переопределить на сервере без пересборки —
// в файле /config.js (window.PORTAL_CONFIG), который не кешируется.

const defaults = {
  domain: 'rep.local.inion',
  title: 'Портал сервисов',
  organization: 'Корпоративная инфраструктура',
  // Как часто браузер забирает статусы с сервера, сек (сервер проверяет системы сам). 0 — только вручную.
  healthInterval: 30,
  // Порог «медленного» ответа, мс (подсказка в интерфейсе; статус считает сервер)
  slowThresholdMs: 1500,
  version: '2.0.0',
  supportContact: 'admin@local.inion',
  // Единый вход
  profileUrl: '/auth/realms/inion/account/',
  logoutUrl: '/oauth2/sign_out?rd=%2F',
};

export const config = { ...defaults, ...(typeof window !== 'undefined' ? window.PORTAL_CONFIG || {} : {}) };
