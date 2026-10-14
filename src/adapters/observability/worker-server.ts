import type { Operations } from './operations.js';
export function startWorkerServer(
  operations: Operations,
  host: string,
  port: number,
) {
  return Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      if (path === '/health/live') return Response.json({ status: 'ok' });
      if (path === '/health/ready') {
        const result = await operations.ready();
        return Response.json(result, {
          status: result.status === 'ready' ? 200 : 503,
        });
      }
      if (path === '/metrics') {
        try {
          return new Response(await operations.metrics(), {
            headers: {
              'Content-Type': operations.telemetry.registry.contentType,
            },
          });
        } catch {
          return Response.json(
            { code: 'METRICS_UNAVAILABLE' },
            { status: 503 },
          );
        }
      }
      return new Response(null, { status: 404 });
    },
  });
}
