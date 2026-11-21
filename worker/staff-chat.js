// The green room: a message thread for the Ringleaders on the Backstage page. Every message is also posted
// by the bot to the staff channel (MOD_CHANNEL_ID), so nobody misses it in Discord.
//
//   GET  /api/backstage/messages              Ringleaders: the latest messages, oldest first
//   POST /api/backstage/messages              Ringleaders  { body }
//   POST /api/backstage/messages/:id/delete   the author: removes it here and in Discord
//
// Messages are kept for 90 days (cron).

import { readSession } from './auth.js';
import { memberInfo, pollConfig } from './polls.js';
import { postMessage, deleteMessage, explain } from './discord-bot.js';

const SNOWFLAKE = /^\d{17,20}$/;
const ID = /^[a-f0-9]{24}$/;
export const STAFF_MESSAGE_MAX = 1000;
export const STAFF_MESSAGES_PER_MINUTE = 10;
const KEEP_DAYS = 90;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, error, message) => json({ error, message }, status);
const newId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Keeps line breaks and tabs; drops other control and text-direction characters.
export function cleanStaffMessage(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, STAFF_MESSAGE_MAX);
}

// What goes to Discord: who said it, then the message. Mentions never ping (postMessage sets allowed_mentions).
export function discordCopy(name, body) {
  return `🎪 **${String(name).replace(/[*_`~|>\\]/g, '')}** · Backstage\n${body}`.slice(0, 2000);
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS staff_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  discord_id TEXT,
  posted INTEGER NOT NULL DEFAULT 0
)`;
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, db.prepare(SCHEMA).run());
  await ready.get(db);
}

export function staffStore(db) {
  return {
    async latest(limit = 100) {
      await ensure(db);
      const rows = (await db.prepare('SELECT * FROM staff_messages ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit).all()).results;
      return rows.reverse();
    },
    async get(id) {
      await ensure(db);
      return db.prepare('SELECT * FROM staff_messages WHERE id = ?').bind(id).first();
    },
    async add(m) {
      await ensure(db);
      await db.prepare('INSERT INTO staff_messages (id, user_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(m.id, m.user_id, m.name, m.body, m.created_at).run();
    },
    async markPosted(id, discordId) {
      await ensure(db);
      await db.prepare('UPDATE staff_messages SET posted = 1, discord_id = ? WHERE id = ?').bind(discordId, id).run();
    },
    async remove(id) {
      await ensure(db);
      await db.prepare('DELETE FROM staff_messages WHERE id = ?').bind(id).run();
    },
    async countSince(userId, sinceIso) {
      await ensure(db);
      const r = await db.prepare('SELECT COUNT(*) AS n FROM staff_messages WHERE user_id = ? AND created_at >= ?').bind(userId, sinceIso).first();
      return Number(r?.n || 0);
    },
    async purgeBefore(iso) {
      await ensure(db);
      return (await db.prepare('DELETE FROM staff_messages WHERE created_at < ?').bind(iso).run()).meta.changes;
    }
  };
}

const modChannel = (env) => (SNOWFLAKE.test(String(env.MOD_CHANNEL_ID || '')) ? env.MOD_CHANNEL_ID : null);

const publicMessage = (m, uid) => ({
  id: m.id, by: m.name, mine: m.user_id === uid, body: m.body, at: m.created_at, posted: Boolean(m.posted)
});

export async function purgeStaffMessages(env) {
  if (!env.DB) return 0;
  return staffStore(env.DB).purgeBefore(new Date(Date.now() - KEEP_DAYS * 86400000).toISOString());
}

export async function handleStaffChat(request, env) {
  if (!env.DB || !pollConfig(env).ok) return fail(503, 'unavailable', 'Backstage messages are being set up.');
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(4); // after /api/backstage/messages
  const session = await readSession(request, env);
  if (!session) return fail(401, 'signed_out', 'Verify with Discord first.');
  const store = staffStore(env.DB);

  try {
    if (request.method === 'GET' && parts.length === 0) {
      const who = await memberInfo(env, session);
      if (!who.manager) return fail(403, 'not_manager', 'Staff only.');
      const rows = await store.latest(100);
      return json({ discord: Boolean(modChannel(env)), max: STAFF_MESSAGE_MAX, messages: rows.map((m) => publicMessage(m, session.uid)) });
    }

    if (request.method !== 'POST') return fail(405, 'method', 'Not allowed.');
    if (request.headers.get('Origin') !== url.origin || !(request.headers.get('Content-Type') || '').startsWith('application/json')) {
      return fail(403, 'forbidden', 'Use the Backstage page on belpire.com.');
    }
    const who = await memberInfo(env, session, { fresh: true });
    if (!who.manager) return fail(403, 'not_manager', 'Staff only.');
    const input = await request.json().catch(() => ({}));

    if (parts.length === 0) {
      const body = cleanStaffMessage(input.body);
      if (!body) return fail(400, 'empty', 'Write something first.');
      if ((await store.countSince(session.uid, new Date(Date.now() - 60000).toISOString())) >= STAFF_MESSAGES_PER_MINUTE) {
        return fail(429, 'slow_down', 'Easy, ringleader. Wait a moment before sending more.');
      }
      const m = { id: newId(), user_id: session.uid, name: who.name, body, created_at: new Date().toISOString() };
      await store.add(m);
      let reason = null;
      const channel = modChannel(env);
      if (channel) {
        try {
          const sent = await postMessage(env, channel, { content: discordCopy(who.name, body) });
          if (sent?.id) {
            await store.markPosted(m.id, sent.id);
            m.posted = 1;
          }
        } catch (err) {
          reason = explain(err);
          console.warn(`Staff message copy to Discord failed: ${reason}`);
        }
      } else {
        reason = 'No staff channel is set up, so this stayed on the site.';
      }
      return json({ ok: true, message: publicMessage(m, session.uid), reason });
    }

    if (parts.length === 2 && ID.test(parts[0]) && parts[1] === 'delete') {
      const m = await store.get(parts[0]);
      if (!m) return fail(404, 'not_found', 'That message is already gone.');
      if (m.user_id !== session.uid) return fail(403, 'forbidden', 'You can only delete your own messages.');
      await store.remove(m.id);
      const channel = modChannel(env);
      if (channel && m.discord_id) {
        await deleteMessage(env, channel, m.discord_id).catch((err) => console.warn(`Staff message delete in Discord failed: ${explain(err)}`));
      }
      return json({ ok: true });
    }

    return fail(404, 'not_found', 'Not found.');
  } catch (err) {
    console.error(`Staff chat error: ${err.stack || err.message}`);
    return fail(500, 'error', 'The green room door stuck. Try again in a moment.');
  }
}
