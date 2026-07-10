import { Injectable, inject } from '@angular/core';
import { FileServiceClient } from '@gen/file/file.client';
import { grpcTransport } from '../grpc/transport';
import { AuthService } from './auth.service';

/**
 * Wraps the still-unary FileService RPCs (FR-EDT-05 image upload). The
 * chunked-session upload protocol (FR-API-13) that gRPC-web ultimately needs
 * for large files hasn't landed yet — fine for images (≤ 10 MB), a follow-up
 * for template docx uploads (≤ 20 MB).
 */
@Injectable({ providedIn: 'root' })
export class FileService {
  private readonly client = new FileServiceClient(grpcTransport);
  private readonly auth = inject(AuthService);

  async upload(file: File): Promise<{ id: string; filename: string; size: number }> {
    const data = new Uint8Array(await file.arrayBuffer());
    const resp = await this.auth.callWithAuthRetry(
      () =>
        this.client.upload({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          data,
        }).response
    );
    return { id: resp.id, filename: resp.filename, size: Number(resp.size) };
  }

  /** Fetches file bytes and returns a local object URL suitable for `<img src>`. */
  async downloadAsObjectUrl(id: string): Promise<string> {
    const resp = await this.auth.callWithAuthRetry(() => this.client.download({ id }).response);
    const blob = new Blob([resp.data], { type: resp.contentType || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }
}
