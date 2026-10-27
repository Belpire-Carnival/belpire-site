import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { profileFrom, ringleaderIds, publicView } from '../ringleaders.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const GUILD = '600000000000000001';
const IDS = ['100000000000000001', '100000000000000002', '100000000000000003'];
const members = {
  [IDS[0]]: { nick: 'Ringmaster One', avatar: null, user: { id: IDS[0], username: 'alpha', global_name: 'Alpha', avatar: 'a_abc' } },
  [IDS[1]]: { nick: null, avatar: 'srv123', user: { id: IDS[1], username: 'bravo', global_name: 'Bravo', avatar: 'u1' } },
  [IDS[2]]: { nick: null, avatar: null, user: { id: IDS[2], username: 'charlie', global_name: null, avatar: null } }
};

function kv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, m };
}
const env = (extra = {}) => ({ DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, RINGLEADER_IDS: IDS.join(', '), SC_DATA: kv(), ASSETS: { fetch: () => new Response('') }, ...extra });

function fakeDiscord(calls) {
  globalThis.fetch = async (url) => {
    url = String(url);
    calls.push(url);
    const m = url.match(/\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return members[m[1]] ? Response.json(members[m[1]]) : new Response('{}', { status: 404 });
    if (url.startsWith('https://cdn.discordapp.com/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': url.includes('.gif') ? 'image/gif' : 'image/png' } });
    return new Response('nope', { status: 500 });
  };
}

test('profileFrom prefers nickname and server avatar, handles animated and default avatars', () => {
  const a = profileFrom(members[IDS[0]], GUILD, 0);
  assert.equal(a.name, 'Ringmaster One');
  assert.equal(a.avatarSrc, `https://cdn.discordapp.com/avatars/${IDS[0]}/a_abc.gif?size=256`);
  const b = profileFrom(members[IDS[1]], GUILD, 1);
  assert.equal(b.name, 'Bravo');
  assert.equal(b.avatarSrc, `https://cdn.discordapp.com/guilds/${GUILD}/users/${IDS[1]}/avatars/srv123.png?size=256`);
  const c = profileFrom(members[IDS[2]], GUILD, 2);
  assert.equal(c.name, 'charlie');
  assert.match(c.avatarSrc, /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  assert.equal(c.role, 'Carnival Guard');
});

test('ringleaderIds trims and caps at three', () => {
  assert.deepEqual(ringleaderIds({ RINGLEADER_IDS: ' 1, 2 ,3,4' }), ['1', '2', '3']);
  assert.deepEqual(ringleaderIds({}), ['']);
});

test('GET /api/ringleaders returns public profiles and caches them', async () => {
  const calls = [];
  fakeDiscord(calls);
  const e = env();
  const res = await worker.fetch(new Request('https://belpire.com/api/ringleaders'), e, { waitUntil: () => {} });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.leaders.map((l) => l.name), ['Ringmaster One', 'Bravo', 'charlie']);
  assert.equal(body.leaders[1].profile, `https://discord.com/users/${IDS[1]}`);
  assert.match(body.leaders[0].avatar, /^\/api\/ringleaders\/avatar\/0\?v=a_abc$/);
  assert.ok(!JSON.stringify(body).includes('cdn.discordapp.com'), 'CDN URLs stay server-side');
  assert.ok(e.SC_DATA.m.has('ringleaders:v1'));
  calls.length = 0;
  await worker.fetch(new Request('https://belpire.com/api/ringleaders'), e, { waitUntil: () => {} });
  assert.equal(calls.length, 0, 'second request served from KV');
});

test('avatar route proxies only the configured image', async () => {
  const calls = [];
  fakeDiscord(calls);
  const e = env();
  const ok = await worker.fetch(new Request('https://belpire.com/api/ringleaders/avatar/0'), e, { waitUntil: () => {} });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'image/gif');
  assert.match(ok.headers.get('Cache-Control'), /max-age=86400/);
  const missing = await worker.fetch(new Request('https://belpire.com/api/ringleaders/avatar/7'), e, { waitUntil: () => {} });
  assert.equal(missing.status, 404);
  const bad = await worker.fetch(new Request('https://belpire.com/api/ringleaders/avatar/../x'), e, { waitUntil: () => {} });
  assert.equal(bad.status, 404);
});

test('no secret configured → empty list, page keeps its written cards', async () => {
  fakeDiscord([]);
  const res = await worker.fetch(new Request('https://belpire.com/api/ringleaders'), env({ RINGLEADER_IDS: undefined }), { waitUntil: () => {} });
  assert.deepEqual((await res.json()).leaders, []);
});

test('publicView never leaks internal fields', () => {
  const v = publicView([{ slot: 0, role: 'RingMaster', name: 'x', id: IDS[0], avatarSrc: 'https://cdn.discordapp.com/a.png', version: 'h' }]);
  assert.deepEqual(Object.keys(v[0]).sort(), ['avatar', 'name', 'profile', 'role', 'slot']);
});
