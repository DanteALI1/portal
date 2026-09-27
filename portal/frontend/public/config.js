/*
 * Настройки портала без пересборки. Отдаются с Cache-Control: no-cache,
 * изменения применяются после обновления страницы.
 */
window.PORTAL_CONFIG = {
  domain: 'rep.local.inion',
  title: 'Портал сервисов',
  organization: 'Корпоративная инфраструктура',
  // Интервал обновления статусов в браузере по умолчанию, сек. Сервер проверяет системы сам.
  healthInterval: 30,
  slowThresholdMs: 1500,
  supportContact: 'admin@local.inion',
  // Единый вход (Keycloak + oauth2-proxy)
  profileUrl: '/auth/realms/inion/account/',
  logoutUrl: '/oauth2/sign_out?rd=%2F',
};
