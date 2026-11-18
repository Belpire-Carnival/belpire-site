import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyInbox, describeEvent, evKey, ago, MAX_FEED, applyContracts, contractStats, cleanContracts, MAX_CONTRACTS } from '../../site/bureau/rsi1/companion/link-core.js';

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
  assert.match(app, /import \{ initLink, initContracts \} from '\.\/link-ui\.js';/);
  assert.match(app, /initLink\(\$\('#desktopLink'\)/);
});

test('the feed and blueprints it writes use keys the profile sync carries', () => {
  const key = /^arsenal\.(?!__)[A-Za-z0-9._-]{1,40}$/;
  for (const k of ['arsenal.link.feed', 'arsenal.plan.bp']) assert.match(k, key);
  assert.match(ui, /const K_FEED = 'arsenal\.link\.feed';/);
});

test('a finished contract says how it ended', () => {
  assert.equal(describeEvent(ev('a', 'mission_end', { title: 'Haul cargo', completion: 'Complete' })), 'Contract completed: Haul cargo');
  assert.equal(describeEvent(ev('a', 'mission_end', { title: 'Haul cargo', completion: 'Fail' })), 'Contract ended (Fail): Haul cargo');
  assert.equal(describeEvent(ev('a', 'mission_end', { title: 'Haul cargo' })), 'Mission ended: Haul cargo');
});

test('contract history pairs accept and finish by mission id, keeps the reward, newest first, capped', () => {
  const evs = [
    ev('a1', 'contract_accepted', { title: 'Haul cargo', bp: true, rep: '100', mid: 'M-1' }, 1000),
    ev('a2', 'contract_accepted', { title: 'Kill pirates', mid: 'M-2' }, 2000),
    ev('e1', 'mission_end', { completion: 'Complete', mid: 'M-1' }, 3000),
    ev('e3', 'mission_end', { title: 'Old one', completion: 'Fail' }, 500),
    ev('x', 'blueprint', { name: 'Ignored here' }, 4000)
  ];
  const res = applyInbox(evs, null, [], 5000, []);
  assert.equal(res.contracts.length, 3);
  assert.deepEqual(res.contracts[0], { k: 'm:M-1', title: 'Haul cargo', bp: true, rep: '100', acceptedAt: 1000, endedAt: 3000, result: 'completed' });
  assert.equal(res.contracts[1].k, 'm:M-2'); assert.equal(res.contracts[1].result, '');
  assert.equal(res.contracts[2].result, 'failed'); assert.equal(res.contracts[2].title, 'Old one');
  // the finish arriving later, in another pull, closes the open contract
  const later = applyContracts([ev('e2', 'mission_end', { completion: 'Abandon', mid: 'M-2' }, 6000)], res.contracts);
  assert.equal(later.find((c) => c.k === 'm:M-2').result, 'abandoned');
  assert.equal(later.length, 3);
  const many = Array.from({ length: MAX_CONTRACTS + 20 }, (_, i) => ev(`c${i}`, 'contract_accepted', { title: `C${i}`, mid: `X${i}` }, i + 1));
  assert.equal(applyContracts(many, []).length, MAX_CONTRACTS);
});

test('contract counts: completed today, this week, in all, and still open; junk saved data is cleaned', () => {
  const now = new Date(2026, 10, 17, 20, 0).getTime();
  const list = [
    { k: 'm:1', title: 'A', result: 'completed', endedAt: now - 3600000 },
    { k: 'm:2', title: 'B', result: 'completed', endedAt: now - 3 * 86400000 },
    { k: 'm:3', title: 'C', result: 'completed', endedAt: now - 30 * 86400000 },
    { k: 'm:4', title: 'D', result: '', acceptedAt: now },
    { k: 'm:4', title: 'dup' }, null, 'junk', { title: 'no key' }
  ];
  assert.deepEqual(contractStats(list, now), { doneToday: 1, doneWeek: 2, done: 3, open: 1 });
  assert.equal(cleanContracts(list).length, 4);
});

test('wiring: the OmniOps card exists, is drawn from saved contracts, and the inbox pull keeps them with the profile', () => {
  assert.match(html, /<div class="card mt12" id="opsContracts"><\/div>/);
  assert.match(app, /initContracts\(\$\('#opsContracts'\)\);/);
  assert.match(ui, /const K_CONTRACTS = 'arsenal\.link\.contracts';/); // an arsenal.* entry, so it is saved to the profile
  assert.match(ui, /write\(K_CONTRACTS, res\.contracts\)/);
  assert.ok(!/innerHTML/.test(ui));
});
