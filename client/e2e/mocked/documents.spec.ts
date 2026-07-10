import {
  CreateDocumentRequest,
  DeleteDocumentRequest,
  DeleteDocumentResponse,
  DocumentResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  RenameDocumentRequest,
} from '@gen/document/document';
import { newDocument } from '../support/factory';
import { mockUnary } from '../support/grpc-mock';
import { pButton } from '../support/prime';
import { GATEWAY_URL, expect, test } from '../support/fixtures';

function mockList(page: import('@playwright/test').Page, documents: ReturnType<typeof newDocument>[]) {
  return mockUnary<ListDocumentsRequest, ListDocumentsResponse>(page, GATEWAY_URL, {
    service: 'document.DocumentService',
    method: 'ListDocuments',
    requestType: ListDocumentsRequest,
    responseType: ListDocumentsResponse,
    handler: () =>
      ListDocumentsResponse.create({ documents, nextPageToken: '', totalCount: documents.length }),
  });
}

test('shows an empty state when there are no documents yet', async ({ authedPage: page }) => {
  await mockList(page, []);
  await page.goto('/documents');
  await expect(page.locator('.documents-page')).toContainText('No documents yet');
});

test('lists documents and creates a new one via the dialog', async ({ authedPage: page }) => {
  const existing = newDocument({ id: 'doc-1', title: 'Existing Doc' });
  await mockList(page, [existing]);
  await page.goto('/documents');
  await expect(page.getByTestId('documents-grid')).toContainText('Existing Doc');

  const created = newDocument({ id: 'doc-2', title: 'Brand New Doc' });
  await mockUnary<CreateDocumentRequest, DocumentResponse>(page, GATEWAY_URL, {
    service: 'document.DocumentService',
    method: 'CreateDocument',
    requestType: CreateDocumentRequest,
    responseType: DocumentResponse,
    handler: () => DocumentResponse.create({ document: created }),
  });
  await mockList(page, [existing, created]);

  await pButton(page.getByTestId('documents-new-btn')).click();
  await expect(page.getByTestId('documents-create-title-input')).toBeVisible();
  await page.getByTestId('documents-create-title-input').fill('Brand New Doc');
  await pButton(page.getByTestId('documents-create-confirm')).click();

  await expect(page.getByTestId('documents-grid')).toContainText('Brand New Doc');
});

test('renames a document via the rename dialog', async ({ authedPage: page }) => {
  const doc = newDocument({ id: 'doc-1', title: 'Old Title' });
  await mockList(page, [doc]);
  await page.goto('/documents');
  await expect(page.getByTestId('documents-grid')).toContainText('Old Title');

  const renamed = newDocument({ id: 'doc-1', title: 'New Title' });
  await mockUnary<RenameDocumentRequest, DocumentResponse>(page, GATEWAY_URL, {
    service: 'document.DocumentService',
    method: 'RenameDocument',
    requestType: RenameDocumentRequest,
    responseType: DocumentResponse,
    handler: () => DocumentResponse.create({ document: renamed }),
  });
  await mockList(page, [renamed]);

  await pButton(page.getByTestId('documents-rename-btn')).click();
  await expect(page.getByTestId('documents-rename-title-input')).toBeVisible();
  await page.getByTestId('documents-rename-title-input').fill('New Title');
  await pButton(page.getByTestId('documents-rename-confirm')).click();

  await expect(page.getByTestId('documents-grid')).toContainText('New Title');
  await expect(page.getByTestId('documents-grid')).not.toContainText('Old Title');
});

test('deletes a document', async ({ authedPage: page }) => {
  const doc = newDocument({ id: 'doc-1', title: 'Doomed Doc' });
  await mockList(page, [doc]);
  await page.goto('/documents');
  await expect(page.getByTestId('documents-grid')).toContainText('Doomed Doc');

  await mockUnary<DeleteDocumentRequest, DeleteDocumentResponse>(page, GATEWAY_URL, {
    service: 'document.DocumentService',
    method: 'DeleteDocument',
    requestType: DeleteDocumentRequest,
    responseType: DeleteDocumentResponse,
    handler: () => DeleteDocumentResponse.create({}),
  });
  await mockList(page, []);

  await pButton(page.getByTestId('documents-delete-btn')).click();

  await expect(page.locator('.documents-page')).toContainText('No documents yet');
});
