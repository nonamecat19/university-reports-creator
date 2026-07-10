import { Injectable, inject, signal } from '@angular/core';
import type { Document, ExportJobStatus, Section } from '@gen/document/document';
import { DocumentFilter, SectionKind } from '@gen/document/document';
import { DocumentServiceClient } from '@gen/document/document.client';
import { grpcTransport } from '../grpc/transport';
import { AuthService } from './auth.service';

export type { Document, ExportJobStatus, Section };
export { SectionKind };

export interface DocumentSummary {
  id: string;
  title: string;
  metadataRevision: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DocumentWithSections {
  document: Document;
  sections: Section[];
}

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly client = new DocumentServiceClient(grpcTransport);
  private readonly auth = inject(AuthService);

  private readonly _documents = signal<DocumentSummary[]>([]);
  private readonly _isLoading = signal(false);

  readonly documents = this._documents.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  async list(): Promise<void> {
    this._isLoading.set(true);
    try {
      const resp = await this.auth.callWithAuthRetry(
        () =>
          this.client.listDocuments({ filter: DocumentFilter.OWN, pageSize: 0, pageToken: '' })
            .response
      );
      this._documents.set(resp.documents.map(toSummary));
    } finally {
      this._isLoading.set(false);
    }
  }

  async create(title: string, templateId = '', templateVersion = 0): Promise<void> {
    await this.auth.callWithAuthRetry(
      () => this.client.createDocument({ templateId, templateVersion, title }).response
    );
    await this.list();
  }

  /** Like create(), but returns the new document's id (for navigating
   * straight to the editor instead of the list). */
  async createAndGetId(title: string, templateId = '', templateVersion = 0): Promise<string> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.createDocument({ templateId, templateVersion, title }).response
    );
    if (!resp.document) throw new Error('createDocument: empty response');
    return resp.document.id;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.auth.callWithAuthRetry(() => this.client.renameDocument({ id, title }).response);
    await this.list();
  }

  async remove(id: string): Promise<void> {
    await this.auth.callWithAuthRetry(() => this.client.deleteDocument({ id }).response);
    await this.list();
  }

  /** Loads a document + its sections for the editor (FR-EDT-01). */
  async get(id: string): Promise<DocumentWithSections> {
    const resp = await this.auth.callWithAuthRetry(() => this.client.getDocument({ id }).response);
    if (!resp.document) throw new Error(`document ${id} not found`);
    return { document: resp.document, sections: resp.sections };
  }

  /** FR-EDT-09: metadata writes carry the document's metadata_revision; a
   * stale write throws (RpcError code FAILED_PRECONDITION) for the caller to
   * reload and retry rather than silently overwrite a concurrent edit. */
  async updateMetadata(
    id: string,
    values: Record<string, string>,
    metadataRevision: number
  ): Promise<Document> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.updateMetadata({ id, values, metadataRevision }).response
    );
    if (!resp.document) throw new Error('updateMetadata: empty response');
    return resp.document;
  }

  /** FR-EDT-09: per-section optimistic concurrency; stale writes throw
   * FAILED_PRECONDITION so the caller can reload just that section. */
  async updateSection(
    documentId: string,
    sectionId: string,
    contentJson: string,
    sectionRevision: number
  ): Promise<Section> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.updateSection({ documentId, sectionId, contentJson, sectionRevision }).response
    );
    if (!resp.section) throw new Error('updateSection: empty response');
    return resp.section;
  }

  async addSection(
    documentId: string,
    title: string,
    kind: SectionKind,
    order: number
  ): Promise<Section> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.addSection({ documentId, title, kind, order }).response
    );
    if (!resp.section) throw new Error('addSection: empty response');
    return resp.section;
  }

  async removeSection(documentId: string, sectionId: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () => this.client.removeSection({ documentId, sectionId }).response
    );
  }

  async reorderSections(documentId: string, sectionIds: string[]): Promise<Section[]> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.reorderSections({ documentId, sectionIds }).response
    );
    return resp.sections;
  }

  /** FR-EXP-04/05: kicks off an export job. The pipeline currently runs
   * synchronously server-side, but the job/poll shape matches the async
   * contract so a real queue can land later without a client change. */
  async exportDocument(documentId: string, format: 'docx' | 'docx+pdf'): Promise<string> {
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.exportDocument({
          documentId,
          options: {
            format,
            suggestionsStrategy: 'clean',
            tableContinuation: 'repeat_header',
            includeComments: false,
          },
        }).response
    );
    return resp.jobId;
  }

  async getExportJob(jobId: string): Promise<ExportJobStatus> {
    return this.auth.callWithAuthRetry(() => this.client.getExportJob({ jobId }).response);
  }
}

function toSummary(doc: {
  id: string;
  title: string;
  metadataRevision: number;
  createdAt?: { seconds: bigint };
  updatedAt?: { seconds: bigint };
}): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    metadataRevision: doc.metadataRevision,
    createdAt: doc.createdAt ? new Date(Number(doc.createdAt.seconds) * 1000) : undefined,
    updatedAt: doc.updatedAt ? new Date(Number(doc.updatedAt.seconds) * 1000) : undefined,
  };
}
