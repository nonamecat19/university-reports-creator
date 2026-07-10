import { ListTemplatesRequest, ListTemplatesResponse } from '@gen/template/template';
import { newTemplate } from '../support/factory';
import { mockUnary } from '../support/grpc-mock';
import { pButton } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

test('shows the welcome header and navigates to documents via the header button', async ({
  authedPage: page,
}) => {
  await expect(page.getByTestId('dashboard-welcome')).toContainText('Test User');
  await pButton(page.getByTestId('dashboard-new-document')).click();
  await expect(page).toHaveURL(/\/documents$/);
});

test('shows an empty state when there are no templates yet', async ({ authedPage: page }) => {
  await expect(page.getByTestId('dashboard-template-count')).toHaveText('0');
  await expect(page.locator('.empty-state')).toContainText('No templates available');
});

test('lists up to 5 recent templates and navigates to a template via "View all"', async ({ authedPage: page }) => {
  const templates = Array.from({ length: 7 }, (_, i) => newTemplate({ id: `t-${i}`, name: `Template ${i}` }));

  await mockUnary<ListTemplatesRequest, ListTemplatesResponse>(page, GATEWAY_URL, {
    service: 'template.TemplateService',
    method: 'ListTemplates',
    requestType: ListTemplatesRequest,
    responseType: ListTemplatesResponse,
    handler: () => ListTemplatesResponse.create({ templates, nextPageToken: '', totalCount: templates.length }),
  });

  // TemplateService.list() is only triggered by the templates route today —
  // the dashboard reads whatever TemplateService already holds. Navigating via
  // the sidebar (client-side routing) to /templates first populates it, then
  // navigating back preserves that in-memory state — a page.goto() here would
  // force a full reload and lose it, same as the access token.
  await page.getByTestId('sidebar-templates').click();
  await expect(page.getByTestId('templates-grid')).toBeVisible();

  await page.getByTestId('sidebar-dashboard').click();
  await expect(page.getByTestId('dashboard-template-count')).toHaveText('7');
  await expect(page.getByTestId('dashboard-recent-template-item')).toHaveCount(5);

  await pButton(page.getByTestId('dashboard-view-all')).click();
  await expect(page).toHaveURL(/\/templates$/);
});
