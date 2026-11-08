// belpire-site Worker — belpire.com
//
// Almost everything is static files from site/. The Worker sees every request first (run_worker_first in
// wrangler.jsonc) so it can serve bureau.belpire.com from site/bureau/; /api/* and /auth/* are code, the
// rest goes straight to the static files. It also runs the Cron Trigger.

import { syncCoinRoles } from './coin-roles.js';
import { handleSnapshot, refresh } from './star-citizen.js';
import { handleMarket, handleShip, refreshMarket } from './sc-market.js';
import { handleScan } from './sc-scan.js';
import { handleBuilder, refreshBuilder } from './sc-builder.js';
import { handleLogin, handleCallback, handleLogout, inviteFor } from './auth.js';
import { handlePolls, purgeOldBallots } from './polls.js';
import { handleOddities, purgeStaleUploads } from './oddities.js';
import { liveStatus } from './live.js';
import { readSession } from './auth.js';
import { memberInfo } from './polls.js';
import { handlePasses, syncPendingPasses, passStatus } from './passes.js';
import { handleStaffChat, purgeStaffMessages } from './staff-chat.js';
import { handleTickets, payAttendance, weeklyHighScores } from './tickets.js';
import { handleInteraction } from './interactions.js';
import { handleMe } from './me.js';
import { bureauRoute, isBureauHost } from './bureau.js';
import { handleCompanionAuth, handleProfile } from './companion.js';

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

// bureau.belpire.com: the page and its own files come from site/bureau/; anything missing goes to its front page.
async function serveBureau(request, env, path) {
  const target = new URL(request.url);
  target.pathname = path;
  const res = await env.ASSETS.fetch(new Request(target, request));
  // The static server tidies URLs (adds a trailing slash, drops index.html); keep those redirects on this host.
  const loc = res.headers.get('Location');
  if (res.status >= 300 && res.status < 400 && loc) {
    const next = new URL(loc, target);
    if (next.origin === target.origin && next.pathname.startsWith('/bureau/')) return Response.redirect(`${target.origin}${next.pathname.slice('/bureau'.length)}${next.search}`, res.status);
  }
  if (res.status === 404 && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(`${new URL(request.url).origin}/`, 302);
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const isGet = request.method === 'GET' || request.method === 'HEAD';

    const bureau = bureauRoute(url);
    if (bureau) return bureau.redirect ? Response.redirect(bureau.redirect, bureau.status) : serveBureau(request, env, bureau.path);

    if (pathname.startsWith('/auth/')) {
      if (isBureauHost(url.hostname)) return handleCompanionAuth(request, env, ctx);
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
    if (pathname === '/api/discord/interactions') return handleInteraction(request, env, ctx);
    if (pathname === '/api/companion/profile' && isBureauHost(url.hostname)) return handleProfile(request, env);
    if (pathname === '/api/me') return isGet ? handleMe(request, env) : methodNotAllowed('GET, HEAD');
    if (pathname === '/api/sc-scan') {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      const { status, body } = await handleScan(request, env);
      return json(body, status, { 'Cache-Control': 'no-store' });
    }
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
    if (pathname === '/api/sc-market') {
      const market = await handleMarket(env, ctx);
      return json(market, 200, { 'Cache-Control': 'public, max-age=300' });
    }
    if (pathname === '/api/sc-ship') {
      const { status, body } = await handleShip(url, ctx);
      return json(body, status, { 'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store' });
    }
    if (pathname === '/api/sc-builder') {
      const body = await handleBuilder(env, ctx);
      return json(body, 200, { 'Cache-Control': body.ready ? 'public, max-age=900' : 'no-store' });
    }
    if (pathname === '/api/invite') {
      const { status, body } = await inviteFor(request, env);
      return json(body, status, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
    }
    return json({ error: 'not found' }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env, { notify: true }));
    ctx.waitUntil(refreshMarket(env).catch((err) => console.warn(`Market refresh failed: ${err.message}`)));
    ctx.waitUntil(refreshBuilder(env).catch((err) => console.warn(`Ship builder refresh failed: ${err.message}`)));
    ctx.waitUntil(purgeOldBallots(env).catch((err) => console.warn(`Ballot purge failed: ${err.message}`)));
    ctx.waitUntil(syncPendingPasses(env).catch((err) => console.warn(`Pass sync failed: ${err.message}`)));
    ctx.waitUntil(weeklyHighScores(env).catch((err) => console.warn(`Weekly High Scores failed: ${err.message}`)));
    ctx.waitUntil(payAttendance(env).catch((err) => console.warn(`Attendance pay failed: ${err.message}`)));
    ctx.waitUntil(purgeStaffMessages(env).catch((err) => console.warn(`Staff message purge failed: ${err.message}`)));
    ctx.waitUntil(purgeStaleUploads(env).catch((err) => console.warn(`Oddity upload cleanup failed: ${err.message}`)));
    ctx.waitUntil(syncCoinRoles(env).catch((err) => console.warn(`Coin role sync failed: ${err.message}`)));
  }
};
