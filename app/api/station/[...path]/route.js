import { clockRouteAllowed, clockCookies, CLOCK_COOKIES } from '@/lib/clock-gateway-policy';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function fail(status, error) { return Response.json({ error }, { status, headers: privateHeaders }); }
async function gateway(request, context) {
  if (process.env.CLOCK_ONLY !== 'true') return fail(404, 'Not found');
  const { path } = await context.params;
  const target = '/' + path.join('/');
  if (!clockRouteAllowed(target, request.method)) return fail(404, 'Not found');
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) return fail(403, 'Invalid origin');
  try {
    const backend = new URL(process.env.HUB_BACKEND_URL);
    const localDevelopment = process.env.NODE_ENV === 'development' && backend.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(backend.hostname);
    if ((!localDevelopment && backend.protocol !== 'https:') || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('Invalid backend');
    const secret = process.env.CLOCK_GATEWAY_SECRET;
    if (!secret || secret.length < 32) throw new Error('Missing gateway secret');
    // Never forward Hub login cookies, caller authorization, host, or proxy headers.
    const headers = new Headers({ 'origin': backend.origin, 'x-clock-gateway-key': secret, 'cookie': clockCookies(request.headers.get('cookie') || '') });
    let body;
    if (request.method === 'POST') {
      const type = request.headers.get('content-type') || '';
      if (!/^(application\/json|multipart\/form-data)(;|$)/i.test(type)) return fail(415, 'Unsupported content type');
      headers.set('content-type', type);
      // Bound the stream even when Content-Length is absent or untrustworthy.
      const reader = request.body?.getReader();
      const chunks = []; let length = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 4 * 1024 * 1024) { await reader.cancel(); return fail(413, 'Photo or request is too large'); }
          chunks.push(value);
        }
      }
      body = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    }
    const upstream = await fetch(new URL(target, backend), { method: request.method, headers, body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    const outgoing = new Headers(privateHeaders);
    for (const name of ['content-type', 'retry-after']) if (upstream.headers.has(name)) outgoing.set(name, upstream.headers.get(name));
    for (const cookie of upstream.headers.getSetCookie()) {
      if (CLOCK_COOKIES.includes(cookie.slice(0, cookie.indexOf('='))) && !/;\s*domain=/i.test(cookie)) outgoing.append('set-cookie', cookie);
    }
    return new Response(upstream.body, { status: upstream.status, headers: outgoing });
  } catch { return fail(503, 'Time clock connection unavailable. Please try again.'); }
}
export const GET = gateway;
export const POST = gateway;
