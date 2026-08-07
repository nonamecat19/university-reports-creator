import { Injectable, inject } from '@angular/core';
import { Purpose } from '@gen/file/file';
import { FileServiceClient } from '@gen/file/file.client';
import { grpcTransport } from '../grpc/transport';
import { AuthService } from './auth.service';

export { Purpose };

export interface UploadedFile {
  id: string;
  filename: string;
  size: number;
  contentType: string;
}

/**
 * Binary transfer over gRPC-web (FR-API-13). The browser gets unary and
 * server-streaming only, so uploads use the unary **chunk session**
 * (BeginUpload → UploadChunk* → CompleteUpload) and downloads consume a
 * server stream.
 *
 * The purpose (`templates` / `images` / `exports`) is not cosmetic: the server
 * derives the size cap and the accepted content types from it, and refuses
 * anything else — so every caller must say what it is uploading.
 */
@Injectable({ providedIn: 'root' })
export class FileService {
  private readonly client = new FileServiceClient(grpcTransport);
  private readonly auth = inject(AuthService);

  async upload(file: File, purpose: Purpose = Purpose.IMAGES): Promise<UploadedFile> {
    const data = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';

    const session = await this.auth.callWithAuthRetry(
      () =>
        this.client.beginUpload({
          purpose,
          filename: file.name,
          size: BigInt(data.byteLength),
          contentType,
        }).response
    );

    // The server dictates the chunk size; it knows the message limit it was
    // configured with.
    const chunkSize = session.maxChunkBytes || 2 * 1024 * 1024;
    try {
      let seq = 0;
      for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
        const slice = data.subarray(offset, Math.min(offset + chunkSize, data.byteLength));
        await this.auth.callWithAuthRetry(
          () => this.client.uploadChunk({ uploadId: session.uploadId, seq, data: slice }).response
        );
        seq++;
      }

      const resp = await this.auth.callWithAuthRetry(
        () => this.client.completeUpload({ uploadId: session.uploadId }).response
      );
      return {
        id: resp.id,
        filename: resp.filename,
        size: Number(resp.size),
        contentType: resp.contentType,
      };
    } catch (error) {
      // A failed upload must not sit in the server's session table until it
      // times out — release it now and let the caller see the real error.
      void this.client.abortUpload({ uploadId: session.uploadId }).response.catch(() => undefined);
      throw error;
    }
  }

  /** Fetches file bytes and returns a local object URL suitable for `<img src>`. */
  async downloadAsObjectUrl(id: string): Promise<string> {
    const { data, contentType } = await this.download(id);
    return URL.createObjectURL(new Blob([data], { type: contentType }));
  }

  /** Reassembles the server-streaming Download into one buffer. */
  async download(id: string): Promise<{ data: Uint8Array; filename: string; contentType: string }> {
    const call = this.client.download({ id });
    const parts: Uint8Array[] = [];
    let filename = '';
    let contentType = '';
    let total = 0;

    for await (const chunk of call.responses) {
      // Metadata rides on the first message only.
      if (!filename && chunk.filename) filename = chunk.filename;
      if (!contentType && chunk.contentType) contentType = chunk.contentType;
      if (chunk.data.byteLength > 0) {
        parts.push(chunk.data);
        total += chunk.data.byteLength;
      }
    }
    await call.status;

    const data = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.byteLength;
    }

    return { data, filename, contentType: contentType || 'application/octet-stream' };
  }

  /** Short-lived presigned URL, for downloads that should not stream through
   * the gateway at all (export artifacts). */
  async downloadUrl(id: string): Promise<string> {
    const resp = await this.auth.callWithAuthRetry(
      () => this.client.getDownloadURL({ id }).response
    );
    return resp.url;
  }
}
