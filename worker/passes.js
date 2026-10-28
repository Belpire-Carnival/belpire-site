// Game Night passes: the Game Night role lets members into The Main Stage, but a Ringleader approves it first.
//
// People ask in two ways:
//   - answering Yes to the onboarding question, which gives them the Game Night (Pending) role in Discord;
//     the cron picks those up every 10 minutes (needs the Server Members intent), or
//   - pressing "Request a Game Night pass" on The Big Tent, which gives them the Pending role too.
// Each new request posts a short note to MOD_CHANNEL_ID (optional). Ringleaders approve or deny on The Big Tent:
// approve → Game Night on, Pending off; deny → Pending off, with an optional reason sent by DM.
//
//   GET  /api/passes                    me: { status }, plus the queue for Ringleaders
//   POST /api/passes/request            members
//   POST /api/passes/:userId/approve    Ringleaders
//   POST /api/passes/:userId/deny       Ringleaders  { reason? }

import { readSession } from './auth.js';
import { memberInfo, pollConfig, _forgetMember } from './polls.js';
import { addRole, removeRole, listMembers, postMessage, sendDm, explain } from './discord-bot.js';

const SNOWFLAKE = /^\d{17,20}$/;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, error, message) => json({ error, message }, status);
const nowIso = () => new Date().toISOString();

export function passConfig(env) {
  const ok = SNOWFLAKE.test(String(env.GAME_NIGHT_ROLE_ID || '')) && SNOWFLAKE.test(String(env.GAME_NIGHT_PENDING_ROLE_ID || ''));
  return { ok, role: env.GAME_NIGHT_ROLE_ID, pending: env.GAME_NIGHT_PENDING_ROLE_ID, modChannel: SNOWFLAKE.test(String(env.MOD_CHANNEL_ID || '')) ? env.MOD_CHANNEL_ID : null };
}

// What the live banner and The Big Tent need to know about someone.
export function passStatus(env, who) {
  const cfg = passConfig(env);
  if (!cfg.ok) return 'not_required';
  if (who.manager) return 'has_pass';
  const roles = who.roles || [];
  if (roles.includes(cfg.role)) return 'has_pass';
  if (roles.includes(cfg.pending)) return 'pending';
  return 'none';
}

// ---------------------------------------------------------------- storage (D1)

const SCHEMA = `CREATE TABLE IF NOT EXISTS pass_requests (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  reason TEXT
)`;
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, db.prepare(SCHEMA).run());
  await ready.get(db);
}

export function passStore(db) {
  return {
    async get(uid) {
      await ensure(db);
      return db.prepare('SELECT * FROM pass_requests WHERE user_id = ?').bind(uid).first();
    },
    // Opens (or reopens) a request. Returns true when it is new, so the mods get one note per request.
    async open(uid, name, source, at) {
      await ensure(db);
      const r = await db
        .prepare("INSERT INTO pass_requests (user_id, name, source, status, requested_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, source = excluded.source, status = 'pending', requested_at = excluded.requested_at, decided_by = NULL, decided_at = NULL, reason = NULL WHERE pass_requests.status != 'pending'")
        .bind(uid, name, source, at)
        .run();
      return r.meta.changes > 0;
    },
    async pending() {
      await ensure(db);
      return (await db.prepare("SELECT * FROM pass_requests WHERE status = 'pending' ORDER BY requested_at ASC LIMIT 100").all()).results;
    },
    async decide(uid, status, by, reason = null) {
      await ensure(db);
      const r = await db.prepare("UPDATE pass_requests SET status = ?, decided_by = ?, decided_at = ?, reason = ? WHERE user_id = ? AND status = 'pending'").bind(status, by, nowIso(), reason, uid).run();
      return r.meta.changes > 0;
    }
  };
}

const nameOf = (m) => String(m?.nick || m?.user?.global_name || m?.user?.username || 'A member').slice(0, 64);

async function noteMods(env, cfg, uid, name, source) {
  if (!cfg.modChannel) return;
  const how = source === 'onboarding' ? 'answered Yes during onboarding' : 'asked on belpire.com';
  try {
    await postMessage(env, cfg.modChannel, {
      content: `🎟️ **${name.replace(/[*_`~|>\\]/g, '')}** (<@${uid}>) wants a Game Night pass. They ${how}.\nReview it on The Big Tent: https://belpire.com/big-tent/#passes`
    });
  } catch (err) {
    console.warn(`Pass note to mods failed: ${explain(err)}`);
  }
}

// Cron: anyone holding the Pending role who isn't in the queue yet (they answered Yes in onboarding) gets added.
// Anyone holding both roles just loses Pending.
export async function syncPendingPasses(env) {
  const cfg = passConfig(env);
  if (!cfg.ok || !env.DB || !env.DISCORD_BOT_TOKEN) return 0;
  const store = passStore(env.DB);
  let members;
  try {
    members = await listMembers(env);
  } catch (err) {
    console.warn(`Pass sync could not list members (is Server Members Intent on?): ${explain(err)}`);
    return 0;
  }
  let added = 0;
  for (const m of members) {
    const uid = m.user?.id;
    if (!SNOWFLAKE.test(String(uid || '')) || !(m.roles || []).includes(cfg.pending)) continue;
    if ((m.roles || []).includes(cfg.role)) {
      // Already has a pass (e.g. answered the onboarding question again): tidy away the stray Pending role.
      await removeRole(env, uid, cfg.pending).catch((err) => console.warn(`Pending role cleanup failed: ${explain(err)}`));
      await store.decide(uid, 'approved', 'already had a pass');
      continue;
    }
    const existing = await store.get(uid);
    if (existing?.status === 'pending') continue;
    if (await store.open(uid, nameOf(m), 'onboarding', nowIso())) {
      added++;
      await noteMods(env, cfg, uid, nameOf(m), 'onboarding');
    }
  }
  return added;
}

export async function handlePasses(request, env) {
  const cfg = passConfig(env);
  if (!cfg.ok || !env.DB || !pollConfig(env).ok) return fail(503, 'unavailable', 'Game Night passes are being set up. Check back soon.');
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3); // after /api/passes
  const session = await readSession(request, env);
  const store = passStore(env.DB);

  try {
    if (request.method === 'GET' && parts.length === 0) {
      if (!session) return json({ status: 'signed_out' });
      const who = await memberInfo(env, session);
      if (!who.member) return json({ status: 'not_member' });
      const body = { status: passStatus(env, who) };
      if (body.status === 'none') {
        const mine = await store.get(session.uid);
        if (mine?.status === 'denied') body.lastDenied = { reason: mine.reason || null, at: mine.decided_at };
      }
      if (who.manager) {
        body.queue = (await store.pending()).map((r) => ({ id: r.user_id, name: r.name, source: r.source, at: r.requested_at }));
      }
      return json(body);
    }

    if (request.method !== 'POST') return fail(405, 'method', 'Not allowed.');
    if (request.headers.get('Origin') !== url.origin || !(request.headers.get('Content-Type') || '').startsWith('application/json')) {
      return fail(403, 'forbidden', 'Use the buttons on belpire.com.');
    }
    if (!session) return fail(401, 'signed_out', 'Verify with Discord first.');
    const who = await memberInfo(env, session, { fresh: true });
    if (!who.member) return fail(403, 'not_member', 'Join the Belpire Discord first.');
    const body = await request.json().catch(() => ({}));

    if (parts.length === 1 && parts[0] === 'request') {
      const status = passStatus(env, who);
      if (status === 'has_pass') return json({ ok: true, status });
      if (status !== 'pending') {
        try {
          await addRole(env, session.uid, cfg.pending);
        } catch (err) {
          return fail(502, 'discord', `Couldn't file your request with Discord. ${explain(err)}`);
        }
        _forgetMember(session.uid);
      }
      if (await store.open(session.uid, who.name, 'website', nowIso())) await noteMods(env, cfg, session.uid, who.name, 'website');
      return json({ ok: true, status: 'pending', message: 'Your ticket is with the Ringleaders for stamping.' });
    }

    if (parts.length === 2 && SNOWFLAKE.test(parts[0]) && ['approve', 'deny'].includes(parts[1])) {
      if (!who.manager) return fail(403, 'not_manager', 'Only the Ringleaders can stamp tickets.');
      const uid = parts[0];
      const req = await store.get(uid);
      if (!req || req.status !== 'pending') return fail(404, 'not_found', 'That request has already been handled.');
      try {
        if (parts[1] === 'approve') {
          await addRole(env, uid, cfg.role);
          await removeRole(env, uid, cfg.pending).catch(() => {});
        } else {
          await removeRole(env, uid, cfg.pending).catch((err) => { if (err.status !== 404) throw err; });
        }
      } catch (err) {
        return fail(502, 'discord', `Discord didn't accept that. ${explain(err)}`);
      }
      _forgetMember(uid);
      const reason = parts[1] === 'deny' ? String(body.reason || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) || null : null;
      await store.decide(uid, parts[1] === 'approve' ? 'approved' : 'denied', who.name, reason);
      let dm = null;
      try {
        if (parts[1] === 'approve') {
          dm = await sendDm(env, uid, '🎟️ Your Game Night pass has been stamped. The Main Stage is open to you. See you under the Big Top.');
        } else if (reason) {
          dm = await sendDm(env, uid, `🎟️ Your Game Night pass request wasn't approved this time.\nFrom the Ringleaders: ${reason}`);
        }
      } catch (err) {
        console.warn(`Pass DM failed: ${explain(err)}`);
        dm = false;
      }
      return json({ ok: true, dm });
    }

    return fail(404, 'not_found', 'Not found.');
  } catch (err) {
    console.error(`Passes error: ${err.stack || err.message}`);
    return fail(500, 'error', 'The ticket booth jammed. Try again in a moment.');
  }
}
