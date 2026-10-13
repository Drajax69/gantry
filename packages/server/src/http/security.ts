import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppSettings } from '../config/app.js';

/**
 * Control-plane security.
 *
 * Gantry drives Git, shells, browsers and coding agents, so exposure is the
 * threat model. Defenses, in order:
 *
 *  1. Loopback bind by default; non-loopback binds require GANTRY_HOST and
 *     are loudly warned about at startup.
 *  2. Host header allowlist — DNS-rebinding pages cannot reach the API.
 *  3. Mutations require same-origin JSON (Origin must match the Host, and
 *     `Sec-Fetch-Site` must not be `cross-site`), blocking cross-origin
 *     requests from web pages.
 *  4. Strict CSP with `default-src 'self'`; artifacts are served sandboxed.
 *  5. Destructive operations additionally require `{ confirm: true }` in the
 *     body — the UI dialog and the API agree.
 */

export function hostAllowed(request: FastifyRequest, settings: AppSettings): boolean {
  const hostHeader = (request.headers.host ?? '').toLowerCase();
  const allowed = new Set<string>([`localhost:${settings.port}`, `127.0.0.1:${settings.port}`, `[::1]:${settings.port}`]);
  if (settings.host !== '127.0.0.1' && settings.host !== 'localhost') allowed.add(`${settings.host}:${settings.port}`);
  return allowed.has(hostHeader);
}

export function sameOriginMutation(request: FastifyRequest, settings: AppSettings): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  // curl/CLI clients without an Origin are allowed only for loopback hosts;
  // a browser page always sends Origin on cross-origin POSTs.
  if (!origin) {
    const local = host === `localhost:${settings.port}` || host === `127.0.0.1:${settings.port}`;
    if (!local) return false;
    const fetchSite = request.headers['sec-fetch-site'];
    return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
  }
  if (origin === `http://${host}` || origin === `https://${host}`) {
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
    return true;
  }
  return settings.allowedOrigins.includes(origin);
}

export function applySecurityHeaders(reply: FastifyReply, contentType: string): void {
  reply.header('Content-Type', contentType);
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
}

export function artifactHeaders(reply: FastifyReply, contentType: string, disposition: string, filename: string, length: number): void {
  reply.header('Content-Type', contentType);
  reply.header('Content-Length', length);
  reply.header('Content-Disposition', `${disposition}; filename="${filename}"`);
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
}
