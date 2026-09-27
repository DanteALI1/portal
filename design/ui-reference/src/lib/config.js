// Конфигурация портала.
// Значения по умолчанию можно переопределить на сервере без пересборки —
// в файле /config.js (window.PORTAL_CONFIG), который не кешируется.

const defaults = {
  domain: 'rep.local.inion',
  title: 'Портал сервисов',
  organization: 'Корпоративная инфраструктура',
  // null → список систем хранится в браузере пользователя (localStorage).
  // '/api' → общий список для всех через REST API (см. README).
  apiBase: null,
  // Путь проверки шлюза Nginx
  gatewayHealthUrl: '/health',
  // Интервал автоматической проверки доступности, сек. 0 — выключено.
  healthInterval: 60,
  // Порог «медленного» ответа, мс
  slowThresholdMs: 1500,
  // Демо-режим: статусы систем имитируются (для превью вне сервера)
  demo: false,
  version: '1.0.0',
  supportContact: 'admin@local.inion',
};

export const config = { ...defaults, ...(typeof window !== 'undefined' ? window.PORTAL_CONFIG || {} : {}) };
