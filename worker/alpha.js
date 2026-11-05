// Alpha tester sign-ups for a members-only Discord project, run by the Usher with buttons and a form.
// The project itself lives only in Discord; nothing here or on the website names or describes it.
//
//   1. A member with the access role presses "Sign up for the alpha" on a pinned post in Discord.
//   2. The Usher shows a short form (platform, PC specs, nights, anything else).
//   3. The answers go to the server owner by direct message, with Approve and Decline buttons. Only the
//      owner can press them, and nobody else sees the answers: a staff channel can't be hidden from anyone
//      with Administrator, so a DM is the only place that's truly private.
//   4. Approve gives the tester role and DMs a welcome. Decline DMs a gentle "not this round".
//
// D1 keeps one row per member (ID, display name, status, dates). The answers themselves are only in the DM.
// Approved rows are kept, so early testers can be found later.
// Runtime secrets: ALPHA_ACCESS_ROLE_ID, ALPHA_TESTER_ROLE_ID.

import { addRole, getMember, getGuild, sendDm, explain } from './discord-bot.js';

const SNOWFLAKE = /^\d{17,20}$/;
const EPHEMERAL = 64;
export const SIGNUP_ID = 'alpha:signup';
const FORM_ID = 'alpha:signup-form';
const RETRY_DAYS = 30;

export function alphaConfig(env) {
  const access = String(env.ALPHA_ACCESS_ROLE_ID || '');
  const alpha = String(env.ALPHA_TESTER_ROLE_ID || '');
  return { ok: SNOWFLAKE.test(access) && SNOWFLAKE.test(alpha), access, alpha };
}

// ---------------------------------------------------------------- storage (D1)

const SCHEMA = `CREATE TABLE IF NOT EXISTS alpha_signups (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT
)`;
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, db.prepare(SCHEMA).run());
  await ready.get(db);
}

export function alphaStore(db) {
  return {
    async get(uid) {
      await ensure(db);
      return db.prepare('SELECT * FROM alpha_signups WHERE user_id = ?').bind(uid).first();
    },
    // Opens a sign-up unless one is pending or approved. → true when it opened.
    async open(uid, name, at) {
      await ensure(db);
      const r = await db
        .prepare("INSERT INTO alpha_signups (user_id, name, status, requested_at) VALUES (?, ?, 'pending', ?) ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, status = 'pending', requested_at = excluded.requested_at, decided_at = NULL WHERE alpha_signups.status = 'declined'")
        .bind(uid, name, at)
        .run();
      return r.meta.changes > 0;
    },
    async drop(uid) {
      await ensure(db);
      await db.prepare("DELETE FROM alpha_signups WHERE user_id = ? AND status = 'pending'").bind(uid).run();
    },
    async decide(uid, status, at) {
      await ensure(db);
      const r = await db.prepare("UPDATE alpha_signups SET status = ?, decided_at = ? WHERE user_id = ? AND status = 'pending'").bind(status, at, uid).run();
      return r.meta.changes > 0;
    }
  };
}

// ---------------------------------------------------------------- the pieces Discord shows

// The pinned post's button. The owner's local setup script posts the same custom_id.
export const signupButton = () => ({ type: 1, components: [{ type: 2, style: 1, label: 'Sign up for the alpha', emoji: { name: '🧪' }, custom_id: SIGNUP_ID }] });

const field = (custom_id, label, style, { required = true, max = 100, placeholder } = {}) =>
  ({ type: 1, components: [{ type: 4, custom_id, label, style, required, max_length: max, ...(placeholder ? { placeholder } : {}) }] });

const signupForm = () => ({
  type: 9,
  data: {
    custom_id: FORM_ID,
    title: 'Alpha sign-up',
    components: [
      field('platform', 'What will you play on?', 1, { max: 60, placeholder: 'PC (Steam), Steam Deck…' }),
      field('specs', 'PC specs', 2, { max: 300, placeholder: 'CPU, graphics card, RAM (Steam → Help → System Information has them)' }),
      field('nights', 'Which nights can you usually play?', 1, { max: 100, placeholder: 'e.g. Fri and Sat after 8 pm Eastern' }),
      field('notes', 'Anything else?', 2, { required: false, max: 300, placeholder: 'Mic? Games you love? Bug-hunting experience?' })
    ]
  }
});

const say = (content, extra = {}) => Response.json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...extra } });
const clean = (s, max) => String(s || '').replace(/[`@]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, max) || '—';
const nameOf = (m) => String(m?.nick || m?.user?.global_name || m?.user?.username || 'A member').slice(0, 64);
const formValue = (data, id) => data?.components?.flatMap((row) => row.components || [row.component].filter(Boolean)).find((c) => c?.custom_id === id)?.value;

// The server owner's ID, read from Discord (never stored), cached per Worker instance.
let ownerCache = null;
async function ownerId(env) {
  if (ownerCache?.guild !== env.DISCORD_GUILD_ID || Date.now() - ownerCache.at > 3600e3) {
    const g = await getGuild(env);
    ownerCache = { guild: env.DISCORD_GUILD_ID, id: g.owner_id, at: Date.now() };
  }
  return ownerCache.id;
}
export const _forgetOwner = () => { ownerCache = null; };

// ---------------------------------------------------------------- handlers

export const isAlphaInteraction = (interaction) => /^alpha:/.test(String(interaction?.data?.custom_id || ''));

export async function handleAlpha(env, interaction, now = Date.now()) {
  const cfg = alphaConfig(env);
  if (!cfg.ok || !env.DB || !env.DISCORD_BOT_TOKEN) return say('🎡 Alpha sign-ups aren\'t open yet. Check back soon.');
  const id = String(interaction.data.custom_id);
  const store = alphaStore(env.DB);

  // Approve / Decline: buttons on the owner's DM.
  const decision = id.match(/^alpha:(ok|no):(\d{17,20})$/);
  if (decision) {
    const clicker = interaction.user?.id || interaction.member?.user?.id;
    if (clicker !== (await ownerId(env))) return say('🎡 Only the owner can decide alpha sign-ups.');
    const [, verdict, uid] = decision;
    const row = await store.get(uid);
    const done = (line) => Response.json({ type: 7, data: { content: line, components: [], embeds: interaction.message?.embeds || [], allowed_mentions: { parse: [] } } });
    if (!row || row.status !== 'pending') return done(`Already decided: **${row?.status || 'withdrawn'}**.`);
    const at = new Date(now).toISOString();
    if (verdict === 'no') {
      await store.decide(uid, 'declined', at);
      const dm = await sendDm(env, uid, `🎡 Thanks for signing up for the alpha. It's a small group for now, so not this round. You can sign up again in ${RETRY_DAYS} days.`).catch(() => false);
      return done(`❌ Declined. ${dm ? 'They were told by DM.' : 'Their DMs are closed, so they weren\'t told.'}`);
    }
    if (!(await getMember(env, uid))) {
      await store.decide(uid, 'left', at);
      return done('👻 They\'ve left the server, so nothing was given.');
    }
    try {
      await addRole(env, uid, cfg.alpha, 'Alpha sign-up approved');
    } catch (err) {
      return say(`🎡 Couldn't give the tester role: ${explain(err)} The Usher's role must sit above the tester role and have Manage Roles.`);
    }
    await store.decide(uid, 'approved', at);
    const dm = await sendDm(env, uid, '🎡 **You\'re in.** Welcome to the alpha. The alpha channels just opened for you in the server. Everything there stays there. Thank you for testing.').catch(() => false);
    return done(`✅ Approved. Tester role given${dm ? ' and they were welcomed by DM' : ' (their DMs are closed, so no welcome message)'}.`);
  }

  // Everything else happens in the server, by a member with the access role.
  if (interaction.guild_id !== env.DISCORD_GUILD_ID || !interaction.member?.user?.id) return say('🎡 That only works inside the Belpire server.');
  const member = interaction.member;
  const uid = member.user.id;
  const roles = member.roles || [];
  if (roles.includes(cfg.alpha)) return say('🧪 You\'re already in the alpha. See you in the alpha channels.');
  if (!roles.includes(cfg.access)) return say('🎡 Alpha sign-ups aren\'t open to you yet.');
  const row = await store.get(uid);
  if (row?.status === 'pending') return say('⏳ Your sign-up is in. You\'ll hear back by DM.');
  if (row?.status === 'declined' && row.decided_at && now - Date.parse(row.decided_at) < RETRY_DAYS * 864e5) {
    const days = Math.ceil((Date.parse(row.decided_at) + RETRY_DAYS * 864e5 - now) / 864e5);
    return say(`🎡 You can sign up again in ${days} ${days === 1 ? 'day' : 'days'}.`);
  }

  if (id === SIGNUP_ID && interaction.type === 3) return Response.json(signupForm());

  if (id === FORM_ID && interaction.type === 5) {
    const name = nameOf(member);
    if (!(await store.open(uid, name, new Date(now).toISOString()))) return say('⏳ Your sign-up is in. You\'ll hear back by DM.');
    const owner = await ownerId(env);
    const d = interaction.data;
    const notes = clean(formValue(d, 'notes'), 300);
    const payload = {
      content: '🧪 New alpha sign-up.',
      embeds: [{
        title: clean(name, 64),
        description: `<@${uid}>`,
        color: 0x4fd1c5,
        fields: [
          { name: 'Plays on', value: clean(formValue(d, 'platform'), 60), inline: true },
          { name: 'Nights', value: clean(formValue(d, 'nights'), 100), inline: true },
          { name: 'PC specs', value: clean(formValue(d, 'specs'), 300) },
          ...(notes !== '—' ? [{ name: 'Anything else', value: notes }] : [])
        ],
        timestamp: new Date(now).toISOString()
      }],
      components: [{ type: 1, components: [
        { type: 2, style: 3, label: 'Approve', emoji: { name: '✅' }, custom_id: `alpha:ok:${uid}` },
        { type: 2, style: 4, label: 'Decline', emoji: { name: '✖️' }, custom_id: `alpha:no:${uid}` }
      ] }]
    };
    if (!(await sendDm(env, owner, payload).catch(() => false))) {
      await store.drop(uid);
      return say('🎡 The sign-up desk is closed for a moment. Try again later.');
    }
    return say('🧪 **Sign-up sent.** The owner reads each one personally. You\'ll hear back by DM, so keep DMs from server members open.');
  }
  return say('🎡 Not sure what to do with that.');
}
