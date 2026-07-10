/**
 * Only the "smoke" project needs the real backend stack up. globalSetup is a
 * top-level-only Playwright option (config.projects here always lists every
 * configured project, unfiltered by --project), so the `e2e:smoke` npm script
 * sets E2E_SMOKE=1 explicitly — that's what gates the check below.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SMOKE !== '1') return;

  const gatewayUrl = process.env.E2E_GATEWAY_URL ?? 'http://localhost:8080';
  try {
    // The gateway has no unauthenticated health endpoint; any HTTP response
    // (including a 404/400) proves something is listening on that port.
    await fetch(gatewayUrl, { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new Error(
      `e2e:smoke requires the real backend stack. Could not reach service-gateway at ${gatewayUrl}.\n` +
        `Run 'make dev' (backend) and 'make client-dev' (Angular) in separate terminals first.\n` +
        `Original error: ${(error as Error).message}`
    );
  }
}
