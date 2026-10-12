import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (Playwright).
 *
 * Normalmente o stack já está no ar via `docker compose up` — aí basta
 * `npm run test:e2e`. Para subir o stack automaticamente, exporte
 * `E2E_WEBSERVER` com o comando (ex.: `docker compose up -d --build`).
 *
 *   E2E_BASE_URL=http://localhost:3999 npm run test:e2e
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3999';
const webServer = process.env.E2E_WEBSERVER;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(webServer
    ? { webServer: { command: webServer, url: baseURL, reuseExistingServer: true, timeout: 240_000 } }
    : {}),
});
