import {
  DeleteTemplateRequest,
  DeleteTemplateResponse,
  ListTemplatesRequest,
  ListTemplatesResponse,
  ReportType,
} from '@gen/template/template';
import { newTemplate } from '../support/factory';
import { mockUnary } from '../support/grpc-mock';
import { pButton } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

function mockList(page: import('@playwright/test').Page, templates: ReturnType<typeof newTemplate>[]) {
  return mockUnary<ListTemplatesRequest, ListTemplatesResponse>(page, GATEWAY_URL, {
    service: 'template.TemplateService',
    method: 'ListTemplates',
    requestType: ListTemplatesRequest,
    responseType: ListTemplatesResponse,
    handler: () => ListTemplatesResponse.create({ templates, nextPageToken: '', totalCount: templates.length }),
  });
}

test('lists templates and filters by search text', async ({ authedPage: page }) => {
  await mockList(page, [
    newTemplate({ id: 't-1', name: 'Diploma Report', description: 'Final year thesis layout' }),
    newTemplate({ id: 't-2', name: 'Course Work', description: 'Semester assignment layout' }),
  ]);

  await page.getByTestId('sidebar-templates').click();
  await expect(page.getByTestId('templates-card')).toHaveCount(2);

  await page.getByTestId('templates-search-input').fill('Diploma');
  await expect(page.getByTestId('templates-card')).toHaveCount(1);
  await expect(page.getByTestId('templates-card')).toContainText('Diploma Report');
});

test('filters by report type', async ({ authedPage: page }) => {
  await mockList(page, [
    newTemplate({ id: 't-1', name: 'Diploma Report', reportType: ReportType.DIPLOMA }),
    newTemplate({ id: 't-2', name: 'Course Work', reportType: ReportType.COURSE }),
  ]);

  await page.getByTestId('sidebar-templates').click();
  await expect(page.getByTestId('templates-card')).toHaveCount(2);

  await page.getByTestId('templates-type-filter').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Diploma' }).click();

  await expect(page.getByTestId('templates-card')).toHaveCount(1);
  await expect(page.getByTestId('templates-card')).toContainText('Diploma Report');
});

test('navigates to template detail via View', async ({ authedPage: page }) => {
  await mockList(page, [newTemplate({ id: 't-1', name: 'Diploma Report' })]);

  await page.getByTestId('sidebar-templates').click();
  await pButton(page.getByTestId('templates-view-btn')).click();

  await expect(page).toHaveURL(/\/templates\/t-1$/);
});

test('deletes a template from the list', async ({ authedPage: page }) => {
  await mockList(page, [newTemplate({ id: 't-1', name: 'Diploma Report' })]);
  await page.getByTestId('sidebar-templates').click();
  await expect(page.getByTestId('templates-card')).toHaveCount(1);

  await mockUnary<DeleteTemplateRequest, DeleteTemplateResponse>(page, GATEWAY_URL, {
    service: 'template.TemplateService',
    method: 'DeleteTemplate',
    requestType: DeleteTemplateRequest,
    responseType: DeleteTemplateResponse,
    handler: () => DeleteTemplateResponse.create({}),
  });

  await pButton(page.getByTestId('templates-delete-btn')).click();
  await expect(page.getByTestId('templates-card')).toHaveCount(0);
});
