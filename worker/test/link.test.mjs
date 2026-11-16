import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyInbox, describeEvent, evKey, ago, MAX_FEED } from '../../site/bureau/rsi1/companion/link-core.js';

const read = (f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8');
const ui = read('link-ui.js');
const core = read('link-core.js');
const html = read('index.html');
const app = read('app.js');

const ev = (id, kind, data = {}, at = 1000, dev = 'dev1') => ({ dev, id, kind, at, data });

test('a blueprint event becomes an owned blueprint and counts once; the same one again adds nothing', () => {
  const first = applyInbox([ev('a', 'blueprint', { name: 'Arden Core' })], null, []);
  assert.equal(first.added, 1);
  assert.ok(first.bp.owned['arden core']);
  assert.equal(first.bp.owned['arden core'].at, 1000);
  const again = applyInbox([ev('b', 'blueprint', { name: 'ARDEN  core' })], first.bp, first.feed);
  assert.equal(again.added, 0);
  assert.equal(Object.keys(again.bp.owned).length, 1);
});

test('what the fabricator scan already stored is kept, including its category and tier', () => {
  const bp = { owned: { 'arden core': { name: 'Arden Core', category: 'Armor', tier: 'Q3', at: 5 } }, scannedAt: 99 };
  const res = applyInbox([ev('a', 'blueprint', { name: 'Arden Core' }, 2000), ev('b', 'blueprint', { name: 'New One' }, 3000)], bp, []);
  assert.equal(res.bp.owned['arden core'].category, 'Armor');
  assert.equal(res.bp.owned['arden core'].tier, 'Q3');
  assert.equal(res.bp.scannedAt, 99);
  assert.equal(res.added, 1);
});

test('every event is acknowledged, including kinds the page has no wording for and nameless blueprints', () => {
  const events = [ev('a', 'blueprint', { name: 'X' }), ev('b', 'blueprint', {}), ev('c', 'something_new'), ev('d', 'incapacitated')];
  const res = applyInbox(events, null, []);
  assert.deepEqual(res.keys, ['dev1:a', 'dev1:b', 'dev1:c', 'dev1:d']);
  assert.deepEqual(res.feed.map((f) => f.kind).sort(), ['blueprint', 'incapacitated']);
});

test('the feed is newest first, never repeats an event, and is capped', () => {
  const many = Array.from({ length: 130 }, (_, i) => ev(`e${i}`, 'mission_end', { title: `M${i}` }, i + 1));
  const res = applyInbox(many, null, []);
  assert.equal(res.feed.length, MAX_FEED);
  assert.equal(res.feed[0].text, 'Mission ended: M129');
  const twice = applyInbox(many.slice(0, 5), null, res.feed);
  assert.equal(twice.feed.length, MAX_FEED);
  assert.equal(new Set(twice.feed.map((f) => f.k)).size, twice.feed.length);
});

test('wording for each kind, with missing or odd data handled', () => {
  assert.equal(describeEvent(ev('a', 'contract_accepted', { title: 'Haul cargo', bp: true })), 'Contract accepted: Haul cargo (blueprint reward)');
  assert.equal(describeEvent(ev('a', 'contract_accepted', {})), 'Contract accepted');
  assert.equal(describeEvent(ev('a', 'vehicle_destroyed', { ownShip: true, vehicle: 'Cutlass Black' })), 'Your ship was destroyed: Cutlass Black');
  assert.equal(describeEvent(ev('a', 'vehicle_destroyed', { ownKill: true })), 'You destroyed a ship');
  assert.equal(describeEvent(ev('a', 'incapacitated')), 'You were incapacitated');
  assert.equal(describeEvent(null), '');
  assert.equal(describeEvent({ kind: 'blueprint', data: 'oops' }), '');
});

test('junk input is tolerated and long text is clipped', () => {
  const res = applyInbox([null, 'x', { dev: 1, id: 2 }, ev('a', 'blueprint', { name: 'N'.repeat(300) })], 'bad', 'worse');
  assert.equal(res.keys.length, 1);
  assert.equal(Object.values(res.bp.owned)[0].name.length, 80);
  assert.equal(evKey({ dev: 'd', id: 'i' }), 'd:i');
});

test('ago reads naturally', () => {
  const now = 1_000_000_000;
  assert.equal(ago(0, now), 'never');
  assert.equal(ago(now - 5000, now), 'just now');
  assert.equal(ago(now - 5 * 60000, now), '5 min ago');
  assert.equal(ago(now - 3 * 3600000, now), '3 h ago');
  assert.equal(ago(now - 2 * 86400000, now), '2 d ago');
});

test('the link card only talks to our own companion API, builds its page with text, and is wired into the Blueprints pane', () => {
  const consts = [...ui.matchAll(/const (API_[A-Z_]+) = '([^']+)';/g)].map((m) => m[2]);
  assert.deepEqual(consts.sort(), ['/api/companion/devices', '/api/companion/inbox', '/api/companion/inbox/ack', '/api/companion/pair/new']);
  for (const u of [...ui.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2])) assert.match(u, /^(\/api\/companion\/|\$\{API_[A-Z_]+\})/);
  assert.doesNotMatch(ui + core, /innerHTML|insertAdjacentHTML|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\./);
  assert.doesNotMatch(ui + core, /https?:\/\//);
  assert.match(html, /id="desktopLink"/);
  assert.match(app, /import \{ initLink \} from '\.\/link-ui\.js';/);
  assert.match(app, /initLink\(\$\('#desktopLink'\)/);
});

test('the feed and blueprints it writes use keys the profile sync carries', () => {
  const key = /^arsenal\.(?!__)[A-Za-z0-9._-]{1,40}$/;
  for (const k of ['arsenal.link.feed', 'arsenal.plan.bp']) assert.match(k, key);
  assert.match(ui, /const K_FEED = 'arsenal\.link\.feed';/);
});
