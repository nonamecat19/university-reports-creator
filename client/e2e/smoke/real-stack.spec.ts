import { expect, test } from '@playwright/test';
import { pButton, pInput } from '../support/prime';

/**
 * Real-stack smoke test — no gRPC-web mocking. Exercises the actual wire:
 * client -> service-gateway -> service-auth -> service-document. Requires
 * `make dev` (backend) and `make client-dev` (Angular) already running;
 * see e2e/global-setup.ts for the precondition check.
 *
 * This is a deliberately reduced slice of the full NFR-21 journey
 * (register -> template -> document -> sections/tables/citations -> share ->
 * comment/suggest -> accept -> export with track changes -> download) since
 * most of that journey isn't built yet (no document editor route, no
 * sharing/comments/suggestions/export). Grow this test as those features land.
 */
test('register, log in, and create a document against the real backend', async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `E2E Smoke ${unique}`;
  const email = `e2e-smoke-${unique}@example.test`;
  const password = 'a-secure-password-1';
  const documentTitle = `Smoke Test Document ${unique}`;

  await page.goto('/auth/login');
  await page.getByTestId('login-toggle-mode').click();
  await page.getByTestId('login-name-input').fill(name);
  await page.getByTestId('login-email-input').fill(email);
  await pInput(page.getByTestId('login-password-input')).fill(password);
  await pButton(page.getByTestId('login-submit')).click();

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByTestId('dashboard-welcome')).toContainText(name);

  await pButton(page.getByTestId('dashboard-new-document')).click();
  await expect(page).toHaveURL(/\/documents$/);

  await pButton(page.getByTestId('documents-new-btn')).click();
  await page.getByTestId('documents-create-title-input').fill(documentTitle);
  await pButton(page.getByTestId('documents-create-confirm')).click();

  await expect(page.getByTestId('documents-grid')).toContainText(documentTitle, { timeout: 15_000 });
});
