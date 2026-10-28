import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { _clearLiveCache, liveIds } from '../live.js';
import { fakeD1 } from './helpers/d1.mjs';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache } from '../polls.js';

const GUILD = '100000000000000001';
const STAGE = '100000000000000002';
const OTHER = '100000000000000005';
const IDS = ['300000000000000001', '300000000000000002', '300000000000000003'];
const realFetch = globalThis.fetch;
let voice;
let calls;
let env;

function kv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, m };
}

beforeEach(() => {
  _clearLiveCache();
  _clearMemberCache();
  calls = 0;
  voice = {};
  globalThis.fetch = async (url) => {
    calls++;
    const p = new URL(url).pathname;
    let m = p.match(/^\/api\/v10\/guilds\/\d+\/voice-states\/(\d+)$/);
    if (m) return voice[m[1]] ? Response.json(voice[m[1]]) : Response.json({ code: 10065 }, { status: 404 });
    m = p.match(/^\/api\/v10\/guilds\/\d+\/members\/(\d+)$/);
    if (m && m[1] === '900000000000000009') return Response.json({ code: 10007 }, { status: 404 });
    if (m) return Response.json({ nick: { [IDS[0]]: 'Synister', [IDS[1]]: 'Nightartist', [IDS[2]]: 'Drepulic' }[m[1]], user: { id: m[1], username: 'x' } });
    throw new Error('unexpected ' + url);
  };
  env = { SESSION_SECRET: 'x'.repeat(48), POLL_MANAGER_ROLE_IDS: '200000000000000001', GENERAL_CHANNEL_ID: '100000000000000003', DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, MAIN_STAGE_CHANNEL_ID: STAGE, RINGLEADER_IDS: IDS.join(','), SC_DATA: kv(), DB: fakeD1(), ASSETS: { fetch: () => new Response('') } };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function cookie(uid) {
  const t = Math.floor(Date.now() / 1000);
  return `${SESSION_COOKIE}=${await seal({ uid, name: 'x', iat: t, exp: t + 3600 }, env.SESSION_SECRET, 'session')}`;
}
const live = async (uid) => {
  const headers = uid ? { Cookie: await cookie(uid) } : {};
  return (await worker.fetch(new Request('https://belpire.com/api/live', { headers }), env, { waitUntil: () => {} })).json();
};

test('nobody streaming → not live', async () => {
  voice[IDS[1]] = { channel_id: STAGE, self_stream: false };
  const r = await live();
  assert.equal(r.live, false);
  assert.equal(r.joinUrl, null);
});

test('a Ringleader on Go Live in The Main Stage → live, with others on stage', async () => {
  voice[IDS[0]] = { channel_id: STAGE, self_stream: true, member: { nick: 'Synister', user: { id: IDS[0] } } };
  voice[IDS[1]] = { channel_id: STAGE, self_stream: false };
  voice[IDS[2]] = { channel_id: OTHER, self_stream: true };
  let r = await live();
  assert.equal(r.live, true);
  assert.deepEqual(r.streamers, ['Synister']);
  assert.deepEqual(r.onStage, ['Nightartist']);
  assert.equal(r.access, 'signin');
  assert.equal(r.joinUrl, null, 'signed-out visitors get no link');
  r = await live('900000000000000009');
  assert.equal(r.access, 'not_member');
  assert.equal(r.joinUrl, null, 'non-members get no link');
  r = await live(IDS[2]);
  assert.equal(r.access, 'member');
  assert.equal(r.joinUrl, `https://discord.com/channels/${GUILD}/${STAGE}`);
});

test('streaming in another channel does not count', async () => {
  voice[IDS[2]] = { channel_id: OTHER, self_stream: true };
  assert.equal((await live()).live, false);
});

test('answers are cached so Discord is asked at most twice a minute', async () => {
  voice[IDS[0]] = { channel_id: STAGE, self_stream: true, member: { nick: 'Synister' } };
  await live();
  const first = calls;
  await live();
  await live();
  assert.equal(calls, first, 'served from cache');
});

test('the current game night is named while live', async () => {
  env.DB._raw.exec("CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, title TEXT, status TEXT, candidates TEXT, created_by TEXT, created_by_name TEXT, created_at INTEGER, closed_at INTEGER, closed_by_name TEXT, results TEXT, results_posted INTEGER NOT NULL DEFAULT 0, event_id TEXT, event_start TEXT, scheduled_by_name TEXT, event_posted INTEGER NOT NULL DEFAULT 0)");
  env.DB._raw.prepare("INSERT INTO polls (id,title,status,candidates,created_by,created_by_name,created_at,event_start) VALUES ('p','All Hallows Eve Game Night','scheduled','[]','u','n',0,?)").run(new Date(Date.now() - 30 * 60e3).toISOString());
  voice[IDS[0]] = { channel_id: STAGE, self_stream: true, member: { nick: 'Synister' } };
  const r = await live();
  assert.equal(r.event.title, 'All Hallows Eve Game Night');
});

test('no secret or Discord trouble → quietly not live', async () => {
  assert.deepEqual(liveIds({ RINGLEADER_IDS: 'abc, 12' }), []);
  env.RINGLEADER_IDS = '';
  assert.equal((await live()).live, false);
  _clearLiveCache();
  env.RINGLEADER_IDS = IDS[0];
  env.SC_DATA = kv();
  globalThis.fetch = async () => Response.json({}, { status: 500 });
  assert.equal((await live()).live, false);
});
