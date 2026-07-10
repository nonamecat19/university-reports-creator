import type { Page, Route } from '@playwright/test';
import type { MessageType } from '@protobuf-ts/runtime';

const FRAME_DATA = 0x00;
const FRAME_TRAILER = 0x80;

function frame(flag: number, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(5 + payload.length);
  buf[0] = flag;
  new DataView(buf.buffer).setUint32(1, payload.length, false);
  buf.set(payload, 5);
  return buf;
}

function concat(...parts: Uint8Array[]): Buffer {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return Buffer.from(out);
}

function trailerFrame(status = 0, message?: string): Uint8Array {
  let text = `grpc-status:${status}\r\n`;
  if (message) text += `grpc-message:${encodeURIComponent(message)}\r\n`;
  return frame(FRAME_TRAILER, new TextEncoder().encode(text));
}

export function encodeUnary<O extends object>(type: MessageType<O>, value: O): Buffer {
  return concat(frame(FRAME_DATA, type.toBinary(value)), trailerFrame());
}

export function encodeStream<O extends object>(type: MessageType<O>, values: O[]): Buffer {
  return concat(...values.map((v) => frame(FRAME_DATA, type.toBinary(v))), trailerFrame());
}

export function encodeError(status: number, message: string): Buffer {
  return Buffer.from(trailerFrame(status, message));
}

export function decodeRequest<I extends object>(type: MessageType<I>, body: Buffer): I {
  // Strip the 5-byte DATA frame header (flag + big-endian length) written by the
  // grpc-web client transport before the protobuf-encoded request payload.
  return type.fromBinary(new Uint8Array(body.subarray(5)));
}

export type MockResult<O> = O | { error: { status: number; message: string } };

function isError<O>(result: MockResult<O>): result is { error: { status: number; message: string } } {
  return typeof result === 'object' && result !== null && 'error' in result;
}

interface MockRpcOptions<I extends object, O extends object> {
  service: string;
  method: string;
  requestType: MessageType<I>;
  responseType: MessageType<O>;
}

async function registerRoute(
  page: Page,
  gatewayUrl: string,
  { service, method }: { service: string; method: string },
  onPost: (route: Route) => Promise<void>
): Promise<void> {
  await page.route(`${gatewayUrl}/${service}/${method}`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }
    await onPost(route);
  });
}

/** Mocks a unary gRPC-web RPC by intercepting the browser's network call to the gateway. */
export async function mockUnary<I extends object, O extends object>(
  page: Page,
  gatewayUrl: string,
  opts: MockRpcOptions<I, O> & {
    handler: (input: I) => MockResult<O> | Promise<MockResult<O>>;
  }
): Promise<void> {
  await registerRoute(page, gatewayUrl, opts, async (route) => {
    const body = route.request().postDataBuffer();
    const input = body && body.length >= 5 ? decodeRequest(opts.requestType, body) : ({} as I);
    const result = await opts.handler(input);
    const responseBody = isError(result)
      ? encodeError(result.error.status, result.error.message)
      : encodeUnary(opts.responseType, result);
    await route.fulfill({
      status: 200,
      contentType: 'application/grpc-web+proto',
      body: responseBody,
    });
  });
}

/** Mocks a server-streaming gRPC-web RPC, returning all chunks in one response body. */
export async function mockServerStream<I extends object, O extends object>(
  page: Page,
  gatewayUrl: string,
  opts: MockRpcOptions<I, O> & {
    handler: (input: I) => O[] | Promise<O[]>;
  }
): Promise<void> {
  await registerRoute(page, gatewayUrl, opts, async (route) => {
    const body = route.request().postDataBuffer();
    const input = body && body.length >= 5 ? decodeRequest(opts.requestType, body) : ({} as I);
    const chunks = await opts.handler(input);
    await route.fulfill({
      status: 200,
      contentType: 'application/grpc-web+proto',
      body: encodeStream(opts.responseType, chunks),
    });
  });
}

/** Standard gRPC status codes used by mock error handlers. */
export const GrpcStatus = {
  INVALID_ARGUMENT: 3,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  UNAUTHENTICATED: 16,
  INTERNAL: 13,
  FAILED_PRECONDITION: 9,
} as const;
