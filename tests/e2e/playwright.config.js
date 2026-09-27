// Runs inside mcr.microsoft.com/playwright:v1.63.0-noble with --network host (see deploy/scripts/e2e.sh)
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '/tmp/e2e-results',
  use: {
    baseURL: process.env.BASE_URL || 'https://rep.local.inion',
    // Self-signed certificate of the test server (API tests verify TLS with the CA file)
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
