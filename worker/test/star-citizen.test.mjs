import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../index.js';
import { diffForDiscord } from '../star-citizen.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
}

let realFetch;
let discordPosts;
let upstream;

beforeEach(() => {
  realFetch = globalThis.fetch;
  discordPosts = [];
  upstream = {
    'https://status.robertsspaceindustries.com/index.json': fixture('status.json'),
    'https://status.robertsspaceindustries.com/issues/index.json': fixture('issues.json'),
    'https://robertsspaceindustries.com/comm-link': fixture('commlink.html'),
    'https://github.com/Osiris-DevWorks/smart-citizen/releases.atom': fixture('smart-citizen.atom'),
    'https://github.com/MrKraken/StarStrings/releases.atom': fixture('starstrings.atom')
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://discord.test/')) {
      discordPosts.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    if (u in upstream) return upstream[u] === null ? new Response('nope', { status: 503 }) : new Response(upstream[u], { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ctx = () => {
  const pending = [];
  return { waitUntil: (p) => pending.push(p), done: () => Promise.all(pending) };
};

test('first cron run stores a snapshot and posts nothing', async () => {
  const env = { SC_DATA: memoryKV(), SC_DISCORD_WEBHOOK_URL: 'https://discord.test/hook' };
  const c = ctx();
  await worker.scheduled({}, env, c);
  await c.done();
  const snap = JSON.parse(env.SC_DATA.store.get('sc:snapshot'));
  assert.equal(snap.status.systems.length, 3);
  assert.equal(snap.news.length, 3);
  assert.deepEqual(snap.errors, []);
  assert.equal(discordPosts.length, 0);
  assert.ok(env.SC_DATA.store.get('sc:seen'));
});

test('later runs post only what is new: status changes, new incidents, new Comm-Links', async () => {
  const env = { SC_DATA: memoryKV(), SC_DISCORD_WEBHOOK_URL: 'https://discord.test/hook' };
  // Seed: everything operational, no incidents or news seen yet except one Comm-Link.
  env.SC_DATA.store.set('sc:seen', JSON.stringify({ news: ['21390'], incidents: ['2026-10-21_rsi-platform-maintenance.md', '2026-10-09_live-deployment.md'], systems: { Platform: 'operational', 'Persistent Universe': 'operational', 'Arena Commander': 'operational' } }));
  const c = ctx();
  await worker.scheduled({}, env, c);
  await c.done();
  const titles = discordPosts.map((p) => p.embeds[0].title);
  assert.deepEqual(titles, [
    'Persistent Universe: Degraded',
    'Incident: Live Services Disruption',
    'Q&A: Example Ship',
    'Example | Behind the Ships : Video'
  ]);
  for (const p of discordPosts) assert.deepEqual(p.allowed_mentions, { parse: [] });

  discordPosts = [];
  const c2 = ctx();
  await worker.scheduled({}, env, c2);
  await c2.done();
  assert.equal(discordPosts.length, 0, 'nothing is announced twice');
});

test('a failing source keeps the previous data and records the error', async () => {
  const env = { SC_DATA: memoryKV() };
  const c = ctx();
  await worker.scheduled({}, env, c);
  await c.done();
  upstream['https://robertsspaceindustries.com/comm-link'] = '<html>redesigned</html>';
  upstream['https://status.robertsspaceindustries.com/index.json'] = null;
  const c2 = ctx();
  await worker.scheduled({}, env, c2);
  await c2.done();
  const snap = JSON.parse(env.SC_DATA.store.get('sc:snapshot'));
  assert.equal(snap.news.length, 3);
  assert.equal(snap.status.systems.length, 3);
  assert.equal(snap.errors.length, 2);
});

test('GET /api/star-citizen fills an empty cache and other paths go to static assets', async () => {
  const env = { SC_DATA: memoryKV(), ASSETS: { fetch: async () => new Response('asset') } };
  const res = await worker.fetch(new Request('https://belpire.com/api/star-citizen'), env, ctx());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const body = await res.json();
  assert.equal(body.status.summary, 'degraded');

  const post = await worker.fetch(new Request('https://belpire.com/api/star-citizen', { method: 'POST' }), env, ctx());
  assert.equal(post.status, 405);
  const page = await worker.fetch(new Request('https://belpire.com/'), env, ctx());
  assert.equal(await page.text(), 'asset');
});

test('diffForDiscord with no history announces nothing', () => {
  const { embeds, next } = diffForDiscord({ status: { systems: [{ name: 'Platform', status: 'down' }] }, incidents: [], news: [{ id: '1', title: 't', url: 'u', type: 'post' }] }, null);
  assert.equal(embeds.length, 0);
  assert.deepEqual(next.news, ['1']);
});
