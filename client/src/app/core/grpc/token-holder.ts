import { signal } from '@angular/core';

/**
 * Plain module-level signal (outside Angular DI) so the gRPC-web transport
 * can read the current access token without depending on AuthService — which
 * itself depends on generated clients built on this transport. AuthService is
 * the only writer.
 */
export const accessToken = signal<string | null>(null);
