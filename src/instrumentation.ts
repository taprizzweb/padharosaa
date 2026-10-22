// Runs once when the server boots. A bad or missing setting stops the server immediately with a clear
// message instead of failing later in front of a customer.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { serverEnv } = await import('./env');
    serverEnv();
  }
}

// Server-side render and route errors that escape every handler: logged with their request id and sent (scrubbed) to Sentry when configured.
export async function onRequestError(err: unknown, request: { path: string; headers?: Record<string, string | string[] | undefined> }) {
  const { captureError } = await import('./lib/monitoring');
  const { log } = await import('./lib/log');
  const id = request.headers?.['x-request-id'];
  const requestId = Array.isArray(id) ? id[0] : id;
  log('error', 'unhandled server error', { requestId, path: request.path, error: err instanceof Error ? err.message : String(err) });
  captureError(err, { requestId, route: request.path });
}
