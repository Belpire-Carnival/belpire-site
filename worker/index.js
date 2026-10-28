// belpire-site Worker — belpire.com
//
// Almost everything is static files from site/. This code only runs for /api/* and /auth/*
// (see run_worker_first in wrangler.jsonc) and for the Cron Trigger.

import { handleSnapshot, refresh } from './star-citizen.js';
import { handleLogin, handleCallback, handleLogout, inviteFor } from './auth.js';
import { handlePolls, purgeOldBallots } from './polls.js';
import { handleOddities, purgeStaleUploads } from './oddities.js';
import { liveStatus } from './live.js';
import { readSession } from './auth.js';
import { memberInfo } from './polls.js';
import { handlePasses, syncPendingPasses, passStatus } from './passes.js';
import { handleStaffChat, purgeStaffMessages } from './staff-chat.js';
import { handleTickets, payAttendance } from './tickets.js';
import { handleInteraction } from './interactions.js';
import { handleMe } from './me.js';

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
    if (pathname === '/api/passes' || pathname.startsWith('/api/passes/')) return handlePasses(request, env);
    if (pathname === '/api/backstage/messages' || pathname.startsWith('/api/backstage/messages/')) return handleStaffChat(request, env);
    if (pathname === '/api/tickets' || pathname.startsWith('/api/tickets/')) return handleTickets(request, env);
    if (pathname === '/api/discord/interactions') return handleInteraction(request, env);
    if (pathname === '/api/me') return isGet ? handleMe(request, env) : methodNotAllowed('GET, HEAD');
    if (!isGet) return methodNotAllowed('GET, HEAD');

    if (pathname === '/api/live') {
      const status = await liveStatus(env).catch((err) => {
        console.warn(`Live status failed: ${err.message}`);
        return { live: false, streamers: [], onStage: [], event: null, joinUrl: null };
      });
      // Everyone sees who is live; only signed-in members of the server get the link into The Main Stage.
      let access = 'signin';
      if (status.live) {
        const session = await readSession(request, env);
        if (session) {
          const who = await memberInfo(env, session).catch(() => ({ member: false }));
          if (!who.member) access = 'not_member';
          else {
            const pass = passStatus(env, who);
            access = pass === 'has_pass' || pass === 'not_required' ? 'member' : pass === 'pending' ? 'pass_pending' : 'no_pass';
          }
        }
      }
      const body = { ...status, access, joinUrl: access === 'member' ? status.joinUrl : null };
      return json(body, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
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
    ctx.waitUntil(syncPendingPasses(env).catch((err) => console.warn(`Pass sync failed: ${err.message}`)));
    ctx.waitUntil(payAttendance(env).catch((err) => console.warn(`Attendance pay failed: ${err.message}`)));
    ctx.waitUntil(purgeStaffMessages(env).catch((err) => console.warn(`Staff message purge failed: ${err.message}`)));
    ctx.waitUntil(purgeStaleUploads(env).catch((err) => console.warn(`Oddity upload cleanup failed: ${err.message}`)));
  }
};
