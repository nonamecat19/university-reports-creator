import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import type { MethodInfo, NextUnaryFn, RpcInterceptor, RpcOptions } from '@protobuf-ts/runtime-rpc';
import { environment } from '../../../environments/environment';
import { accessToken } from './token-holder';

const authInterceptor: RpcInterceptor = {
  interceptUnary(next: NextUnaryFn, method: MethodInfo, input: object, options: RpcOptions) {
    const token = accessToken();
    if (token) {
      options.meta = { ...options.meta, authorization: `Bearer ${token}` };
    }
    return next(method, input, options);
  },
};

/** Single gRPC-web transport for all generated clients (FR-AUTH-09/10). */
export const grpcTransport = new GrpcWebFetchTransport({
  baseUrl: environment.gatewayUrl,
  format: 'binary',
  interceptors: [authInterceptor],
});
