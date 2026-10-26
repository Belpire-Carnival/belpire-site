// belpire-site Worker — belpire.com
//
// Almost everything is static files from site/, served straight from Cloudflare's edge.
// This code only runs for /api/* (see run_worker_first in wrangler.jsonc) and for the Cron Trigger.

import { handleSnapshot, refresh } from './star-citizen.js';

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method not allowed' }, 405, { Allow: 'GET, HEAD' });

    if (url.pathname === '/api/star-citizen') {
      const snapshot = await handleSnapshot(env, ctx);
      return json(snapshot, 200, { 'Cache-Control': 'public, max-age=60' });
    }
    return json({ error: 'not found' }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env, { notify: true }));
  }
};
