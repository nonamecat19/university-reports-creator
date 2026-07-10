import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  // Shared across projects: starts `ng serve` for the mocked suite, and is reused
  // (not restarted) for the smoke suite if `make client-dev` is already running.
  webServer: {
    command: 'npm run start -- --port 4200',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  // Global (not per-project) by Playwright's design; skips itself for the
  // "mocked" project — see e2e/global-setup.ts for the actual condition.
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'mocked',
      testDir: './e2e/mocked',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4200' },
    },
    {
      name: 'smoke',
      testDir: './e2e/smoke',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4200',
      },
    },
  ],
});
