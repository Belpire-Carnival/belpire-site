import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleAlpha, alphaStore, SIGNUP_ID, signupButton, _forgetOwner } from '../alpha.js';
import { fakeD1 } from './helpers/d1.mjs';

const GUILD = '100000000000000001';
const ACCESS = '400000000000000001';
const ALPHA = '400000000000000002';
const OWNER = '300000000000000001';
const FAN = '300000000000000003';
const T = Date.parse('2026-11-05T17:00:00Z');
const realFetch = globalThis.fetch;
let env, discord;

beforeEach(() => {
  _forgetOwner();
  discord = { dms: [], roles: [], dmsClosed: new Set(), inServer: new Set([OWNER, FAN]) };
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname.replace('/api/v10', '');
    const method = init.method || 'GET';
    if (p === `/guilds/${GUILD}`) return Response.json({ id: GUILD, owner_id: OWNER });
    let m = p.match(/^\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return discord.inServer.has(m[1]) ? Response.json({ roles: [], user: { id: m[1] } }) : Response.json({ code: 10007 }, { status: 404 });
    m = p.match(/^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/);
    if (m && method === 'PUT') { discord.roles.push([m[1], m[2]]); return new Response(null, { status: 204 }); }
    if (p === '/users/@me/channels') {
      const to = JSON.parse(init.body).recipient_id;
      if (discord.dmsClosed.has(to)) return Response.json({ code: 50007 }, { status: 403 });
      return Response.json({ id: 'dm-' + to });
    }
    m = p.match(/^\/channels\/dm-(\d+)\/messages$/);
    if (m && method === 'POST') { discord.dms.push({ to: m[1], ...JSON.parse(init.body) }); return Response.json({ id: '1' }); }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  env = { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, ALPHA_ACCESS_ROLE_ID: ACCESS, ALPHA_TESTER_ROLE_ID: ALPHA, DB: fakeD1() };
});
afterEach(() => { globalThis.fetch = realFetch; });

const press = (uid, roles, custom_id = SIGNUP_ID) => ({ type: 3, guild_id: GUILD, member: { nick: 'Fan One', roles, user: { id: uid } }, data: { custom_id } });
const submit = (uid, roles, notes = '') => ({
  type: 5, guild_id: GUILD, member: { nick: 'Fan One', roles, user: { id: uid } },
  data: { custom_id: 'alpha:signup-form', components: [
    { type: 1, components: [{ custom_id: 'platform', value: 'PC (Steam)' }] },
    { type: 1, components: [{ custom_id: 'specs', value: 'Ryzen 7, RTX 4070, 32 GB @everyone' }] },
    { type: 1, components: [{ custom_id: 'nights', value: 'Fri and Sat' }] },
    { type: 1, components: [{ custom_id: 'notes', value: notes }] }
  ] }
});
const decide = (uid, verdict, clicker) => ({ type: 3, user: { id: clicker }, message: { embeds: [{ title: 'Fan One' }] }, data: { custom_id: `alpha:${verdict}:${uid}` } });
const body = async (r) => (await r).json();

test('the button only opens the form for members with the access role who are not testers yet', async () => {
  assert.equal(signupButton().components[0].custom_id, SIGNUP_ID);
  assert.match((await body(handleAlpha(env, press(FAN, [])))).data.content, /aren't open to you/);
  assert.match((await body(handleAlpha(env, press(FAN, [ACCESS, ALPHA])))).data.content, /already in the alpha/);
  const form = await body(handleAlpha(env, press(FAN, [ACCESS])));
  assert.equal(form.type, 9);
  assert.ok(form.data.title.length <= 45);
  assert.deepEqual(form.data.components.map((r) => r.components[0].custom_id), ['platform', 'specs', 'nights', 'notes']);
  assert.match((await body(handleAlpha({ ...env, ALPHA_TESTER_ROLE_ID: '' }, press(FAN, [ACCESS])))).data.content, /aren't open yet/);
});

test('a sign-up goes only to the owner by DM, once', async () => {
  const r = await body(handleAlpha(env, submit(FAN, [ACCESS], 'Has a mic'), T));
  assert.match(r.data.content, /Sign-up sent/);
  assert.equal(r.data.flags, 64);
  assert.equal(discord.dms.length, 1);
  const dm = discord.dms[0];
  assert.equal(dm.to, OWNER);
  assert.deepEqual(dm.allowed_mentions, { parse: [] });
  const fields = Object.fromEntries(dm.embeds[0].fields.map((f) => [f.name, f.value]));
  assert.equal(fields['Plays on'], 'PC (Steam)');
  assert.ok(!fields['PC specs'].includes('@'));
  assert.equal(fields['Anything else'], 'Has a mic');
  assert.deepEqual(dm.components[0].components.map((b) => b.custom_id), [`alpha:ok:${FAN}`, `alpha:no:${FAN}`]);
  assert.equal((await alphaStore(env.DB).get(FAN)).status, 'pending');
  assert.match((await body(handleAlpha(env, press(FAN, [ACCESS])))).data.content, /sign-up is in/);
  assert.match((await body(handleAlpha(env, submit(FAN, [ACCESS]), T))).data.content, /sign-up is in/);
  assert.equal(discord.dms.length, 1);
});

test('if the owner cannot be reached, nothing is kept', async () => {
  discord.dmsClosed.add(OWNER);
  assert.match((await body(handleAlpha(env, submit(FAN, [ACCESS]), T))).data.content, /closed for a moment/);
  assert.equal(await alphaStore(env.DB).get(FAN), null);
});

test('only the owner can approve; approving gives Alpha Tester and a welcome', async () => {
  await handleAlpha(env, submit(FAN, [ACCESS]), T);
  assert.match((await body(handleAlpha(env, decide(FAN, 'ok', FAN), T))).data.content, /Only the owner/);
  assert.deepEqual(discord.roles, []);
  const r = await body(handleAlpha(env, decide(FAN, 'ok', OWNER), T));
  assert.equal(r.type, 7);
  assert.deepEqual(r.data.components, []);
  assert.match(r.data.content, /Approved/);
  assert.deepEqual(discord.roles, [[FAN, ALPHA]]);
  assert.match(discord.dms.at(-1).content, /You're in/);
  assert.equal(discord.dms.at(-1).to, FAN);
  const row = await alphaStore(env.DB).get(FAN);
  assert.equal(row.status, 'approved');
  assert.ok(row.decided_at, 'approval date kept for an Early Adopter role later');
  assert.match((await body(handleAlpha(env, decide(FAN, 'ok', OWNER), T))).data.content, /Already decided: \*\*approved/);
  assert.equal(discord.roles.length, 1);
});

test('decline: told kindly, can sign up again after 30 days', async () => {
  await handleAlpha(env, submit(FAN, [ACCESS]), T);
  assert.match((await body(handleAlpha(env, decide(FAN, 'no', OWNER), T))).data.content, /Declined/);
  assert.match(discord.dms.at(-1).content, /not this round/);
  assert.match((await body(handleAlpha(env, press(FAN, [ACCESS]), T + 864e5))).data.content, /again in 29 days/);
  assert.equal((await body(handleAlpha(env, press(FAN, [ACCESS]), T + 31 * 864e5))).type, 9);
  assert.match((await body(handleAlpha(env, submit(FAN, [ACCESS]), T + 31 * 864e5))).data.content, /Sign-up sent/);
});

test('approving someone who left gives nothing', async () => {
  await handleAlpha(env, submit(FAN, [ACCESS]), T);
  discord.inServer.delete(FAN);
  assert.match((await body(handleAlpha(env, decide(FAN, 'ok', OWNER), T))).data.content, /left the server/);
  assert.deepEqual(discord.roles, []);
});

test('nothing in the sign-up flow names the project', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../alpha.js', import.meta.url), 'utf8');
  assert.ok(!/belpire wakes|wbw|stagehand/i.test(src));
});
