// belpire-site Worker — belpire.com
//
// Public pages are static files from site/, served straight from Cloudflare's edge.
// This code runs only for the paths listed in run_worker_first (wrangler.jsonc):
//   /auth/*            Discord login, callback, logout
//   /members, /members/*   members-only pages (session required)
//   /api/*             JSON for the pages
// plus the 10-minute Cron Trigger (Star Citizen refresh).

import { handleSnapshot, refresh } from './star-citizen.js';
import { handleLogin, handleCallback, handleLogout, readSession, requireMember, authConfig } from './auth.js';

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });
}
const methodNotAllowed = (allow) => json({ error: 'method not allowed' }, 405, { Allow: allow });

async function serveMembers(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/members') return Response.redirect(`${url.origin}/members/`, 301);
  const gate = await requireMember(request, env);
  if (!gate.ok) return gate.response;
  const asset = await env.ASSETS.fetch(request);
  const res = new Response(asset.body, asset);
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('Vary', 'Cookie');
  for (const c of gate.cookies) res.headers.append('Set-Cookie', c);
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path.startsWith('/auth/')) {
      if (path === '/auth/login') return method === 'GET' ? handleLogin(request, env) : methodNotAllowed('GET');
      if (path === '/auth/callback') return method === 'GET' ? handleCallback(request, env) : methodNotAllowed('GET');
      if (path === '/auth/logout') return method === 'POST' ? handleLogout(request, env, ctx) : methodNotAllowed('POST');
      return json({ error: 'not found' }, 404);
    }

    if (path === '/members' || path.startsWith('/members/')) {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed('GET, HEAD');
      return serveMembers(request, env);
    }

    if (path.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed('GET, HEAD');
      if (path === '/api/me') {
        const s = await readSession(request, env);
        const body = s ? { loggedIn: true, name: s.name, avatar: s.avatar } : { loggedIn: false, loginEnabled: authConfig(env).ok };
        return json(body, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
      }
      if (path === '/api/star-citizen') {
        const snapshot = await handleSnapshot(env, ctx);
        return json(snapshot, 200, { 'Cache-Control': 'public, max-age=60' });
      }
      return json({ error: 'not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env, { notify: true }));
  }
};
