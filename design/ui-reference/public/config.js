/*
 * Настройки портала без пересборки.
 * Файл отдаётся с Cache-Control: no-cache (см. nginx.conf), изменения
 * применяются после обновления страницы.
 */
window.PORTAL_CONFIG = {
  domain: 'rep.local.inion',
  title: 'Портал сервисов',
  organization: 'Корпоративная инфраструктура',

  // null — каталог хранится в браузере каждого пользователя.
  // '/api' — общий каталог через REST API (контракт описан в README.md).
  apiBase: null,

  gatewayHealthUrl: '/health',
  healthInterval: 60,      // секунд; 0 — без автопроверки
  slowThresholdMs: 1500,   // ответ дольше — статус «Медленно»
  supportContact: 'admin@local.inion',
  demo: false,
};
