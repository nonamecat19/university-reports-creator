import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import type {
  MethodInfo,
  NextServerStreamingFn,
  NextUnaryFn,
  RpcInterceptor,
  RpcOptions,
} from '@protobuf-ts/runtime-rpc';
import { environment } from '../../../environments/environment';
import { accessToken } from './token-holder';

function withAuthMeta(options: RpcOptions): RpcOptions {
  const token = accessToken();
  if (token) {
    options.meta = { ...options.meta, authorization: `Bearer ${token}` };
  }
  return options;
}

const authInterceptor: RpcInterceptor = {
  interceptUnary(next: NextUnaryFn, method: MethodInfo, input: object, options: RpcOptions) {
    return next(method, input, withAuthMeta(options));
  },
  interceptServerStreaming(
    next: NextServerStreamingFn,
    method: MethodInfo,
    input: object,
    options: RpcOptions
  ) {
    return next(method, input, withAuthMeta(options));
  },
};

/** Single gRPC-web transport for all generated clients (FR-AUTH-09/10). */
export const grpcTransport = new GrpcWebFetchTransport({
  baseUrl: environment.gatewayUrl,
  format: 'binary',
  interceptors: [authInterceptor],
});
