import { Injectable, inject, signal } from '@angular/core';
import { DocumentFilter } from '@gen/document/document';
import { DocumentServiceClient } from '@gen/document/document.client';
import { grpcTransport } from '../grpc/transport';
import { AuthService } from './auth.service';

export interface DocumentSummary {
  id: string;
  title: string;
  metadataRevision: number;
  createdAt?: Date;
  updatedAt?: Date;
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

  async create(title: string): Promise<void> {
    await this.auth.callWithAuthRetry(
      () => this.client.createDocument({ templateId: '', templateVersion: 0, title }).response
    );
    await this.list();
  }

  async rename(id: string, title: string): Promise<void> {
    await this.auth.callWithAuthRetry(() => this.client.renameDocument({ id, title }).response);
    await this.list();
  }

  async remove(id: string): Promise<void> {
    await this.auth.callWithAuthRetry(() => this.client.deleteDocument({ id }).response);
    await this.list();
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
