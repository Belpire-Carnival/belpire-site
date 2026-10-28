// belpire-site Worker — belpire.com
//
// Almost everything is static files from site/. This code only runs for /api/* and /auth/*
// (see run_worker_first in wrangler.jsonc) and for the Cron Trigger.

import { handleSnapshot, refresh } from './star-citizen.js';
import { handleLogin, handleCallback, handleLogout, inviteFor } from './auth.js';
import { handlePolls, purgeOldBallots } from './polls.js';
import { handleOddities, purgeStaleUploads } from './oddities.js';
import { liveStatus } from './live.js';

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const isGet = request.method === 'GET' || request.method === 'HEAD';

    if (pathname.startsWith('/auth/')) {
      if (pathname === '/auth/login') return isGet ? handleLogin(request, env) : methodNotAllowed('GET, HEAD');
      if (pathname === '/auth/callback') return isGet ? handleCallback(request, env, ctx) : methodNotAllowed('GET, HEAD');
      if (pathname === '/auth/logout') return request.method === 'POST' ? handleLogout(request) : methodNotAllowed('POST');
      return json({ error: 'not found' }, 404);
    }

    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (pathname === '/api/polls' || pathname.startsWith('/api/polls/')) return handlePolls(request, env, ctx);
    if (pathname === '/api/oddities' || pathname.startsWith('/api/oddities/')) return handleOddities(request, env, ctx);
    if (!isGet) return methodNotAllowed('GET, HEAD');

    if (pathname === '/api/live') {
      const status = await liveStatus(env).catch((err) => {
        console.warn(`Live status failed: ${err.message}`);
        return { live: false, streamers: [], onStage: [], event: null, joinUrl: null };
      });
      return json(status, 200, { 'Cache-Control': 'public, max-age=15' });
    }
    if (pathname === '/api/star-citizen') {
      const snapshot = await handleSnapshot(env, ctx);
      return json(snapshot, 200, { 'Cache-Control': 'public, max-age=60' });
    }
    if (pathname === '/api/invite') {
      const { status, body } = await inviteFor(request, env);
      return json(body, status, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
    }
    return json({ error: 'not found' }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env, { notify: true }));
    ctx.waitUntil(purgeOldBallots(env).catch((err) => console.warn(`Ballot purge failed: ${err.message}`)));
    ctx.waitUntil(purgeStaleUploads(env).catch((err) => console.warn(`Oddity upload cleanup failed: ${err.message}`)));
  }
};
