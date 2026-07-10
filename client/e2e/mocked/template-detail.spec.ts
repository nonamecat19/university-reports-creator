import { GetTemplateRequest, TemplateResponse, Visibility } from '@gen/template/template';
import { newTemplate } from '../support/factory';
import { GrpcStatus, mockUnary } from '../support/grpc-mock';
import { pButton } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

test('loads a template by id and renders its fields', async ({ authedPage: page }) => {
  const template = newTemplate({
    id: 't-1',
    name: 'Diploma Report',
    description: 'Final year thesis layout',
    visibility: Visibility.PUBLIC,
    currentVersion: 3,
    ownerId: 'user-1',
  });

  await mockUnary<GetTemplateRequest, TemplateResponse>(page, GATEWAY_URL, {
    service: 'template.TemplateService',
    method: 'GetTemplate',
    requestType: GetTemplateRequest,
    responseType: TemplateResponse,
    handler: (input) =>
      input.id === 't-1'
        ? TemplateResponse.create({ template })
        : { error: { status: GrpcStatus.NOT_FOUND, message: 'not found' } },
  });

  await page.goto('/templates/t-1');

  await expect(page.getByTestId('template-detail-name')).toHaveText('Diploma Report');
  await expect(page.getByTestId('template-detail-info')).toContainText('Diploma');
  await expect(page.getByTestId('template-detail-info')).toContainText('Public');
  await expect(page.getByTestId('template-detail-info')).toContainText('3');
});

test('navigates back to the templates list', async ({ authedPage: page }) => {
  const template = newTemplate({ id: 't-1', name: 'Diploma Report' });
  await mockUnary<GetTemplateRequest, TemplateResponse>(page, GATEWAY_URL, {
    service: 'template.TemplateService',
    method: 'GetTemplate',
    requestType: GetTemplateRequest,
    responseType: TemplateResponse,
    handler: () => TemplateResponse.create({ template }),
  });

  await page.goto('/templates/t-1');
  await expect(page.getByTestId('template-detail-name')).toHaveText('Diploma Report');

  await pButton(page.getByTestId('template-detail-back')).click();
  await expect(page).toHaveURL(/\/templates$/);
});
