import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanDash, defaultDash, activeBoard, addBoard, renameBoard, removeBoard, setActive, addItem, removeItem, moveItem, resizeItem, same, widgetId, slug, STARTER, MAX_BOARDS, MAX_ITEMS } from '../../site/bureau/rsi1/companion/dash-core.js';

const read = (f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8');

test('widget ids name a page and a panel title', () => {
  assert.equal(widgetId('ops', 'Live status &amp; data'), 'ops:live-status-and-data');
  assert.equal(widgetId('ops', 'Last 7 days'), 'ops:last-7-days');
  assert.equal(slug('  '), 'panel');
});

test('the first dashboard holds game activity, progress, money and the day, and ships', () => {
  const d = defaultDash();
  assert.equal(d.boards.length, 1); assert.equal(activeBoard(d).name, 'Main');
  const ids = activeBoard(d).items.map((i) => i.w);
  for (const w of ['ops:from-your-game', 'ops:contracts-from-the-game', 'ops:reputation-ranks', 'blueprints:your-blueprints', 'wishlist:what-you-want', 'ops:today', 'ops:your-hangar']) assert.ok(ids.includes(w), w);
  assert.equal(ids.length, STARTER.length);
});

test('several named dashboards: add, rename, switch, delete (never the last one)', () => {
  let d = addBoard(defaultDash(), 'Mining');
  assert.equal(d.boards.length, 2); assert.equal(activeBoard(d).name, 'Mining'); assert.equal(activeBoard(d).items.length, 0);
  d = renameBoard(d, '  Bounty  run '); assert.equal(activeBoard(d).name, 'Bounty run');
  d = setActive(d, 'main'); assert.equal(activeBoard(d).name, 'Main');
  d = setActive(d, 'nope'); assert.equal(d.active, 'main');
  d = removeBoard(d); assert.equal(d.boards.length, 1); assert.equal(activeBoard(d).name, 'Bounty run');
  assert.equal(removeBoard(d).boards.length, 1);
  let many = defaultDash(); for (let i = 0; i < 20; i++) many = addBoard(many, `B${i}`);
  assert.equal(many.boards.length, MAX_BOARDS);
});

test('widgets: added once, removed, moved, resized; bad ids and sizes are refused', () => {
  let d = addBoard(defaultDash(), 'Test');
  d = addItem(d, 'ops:today', 's'); d = addItem(d, 'ops:today', 'l'); d = addItem(d, 'calc:ship', 'x'); d = addItem(d, 'not an id');
  assert.deepEqual(activeBoard(d).items, [{ w: 'ops:today', size: 's' }, { w: 'calc:ship', size: 'm' }]);
  d = moveItem(d, 0, 1); assert.deepEqual(activeBoard(d).items.map((i) => i.w), ['calc:ship', 'ops:today']);
  d = moveItem(d, 1, -5); assert.equal(activeBoard(d).items[0].w, 'ops:today');
  d = resizeItem(d, 0, 'l'); d = resizeItem(d, 0, 'huge'); assert.equal(activeBoard(d).items[0].size, 'l');
  d = removeItem(d, 0); assert.deepEqual(activeBoard(d).items.map((i) => i.w), ['calc:ship']);
  let full = addBoard(defaultDash(), 'Full'); for (let i = 0; i < 60; i++) full = addItem(full, `ops:w${i}`);
  assert.equal(activeBoard(full).items.length, MAX_ITEMS);
});

test('saved data is cleaned: junk gives the starter dashboard, bad parts are dropped, changes are detected', () => {
  assert.deepEqual(cleanDash(null), defaultDash()); assert.deepEqual(cleanDash({ boards: 'x' }), defaultDash());
  const c = cleanDash({ active: 'gone', boards: [{ id: 'a', name: '', items: [{ w: 'ops:today', size: 'q' }, { w: '<script>' }, null] }, { id: 'a', name: 'dup' }, { id: 'BAD ID', name: 'x' }] });
  assert.deepEqual(c, { v: 1, active: 'a', boards: [{ id: 'a', name: 'Dashboard', items: [{ w: 'ops:today', size: 'm' }] }] });
  assert.ok(same(defaultDash(), cleanDash(JSON.parse(JSON.stringify(defaultDash())))));
  assert.ok(!same(defaultDash(), addItem(addBoard(defaultDash(), 'x'), 'ops:today')));
});

test('wiring: OmniDash is its own tab right after OmniGlass Desktop, saved as a profile entry, built with text, read-only copies', () => {
  const app = read('app.js'), html = read('index.html'), ui = read('dash-ui.js'), core = read('dash-core.js'), viz = read('viz.js');
  assert.match(app, /\{ id: 'desktop',[^\n]*\n  \{ id: 'dash', label: 'OmniDash', icon: 'dash',/);
  assert.match(html, /<section class="view" id="v-dash" aria-labelledby="h-dash">/); assert.match(html, /<div id="dashApp" class="mt12"><\/div>/);
  assert.match(viz, /^\s{2}dash:\s*\[/m);
  assert.match(app, /initDash\(\$\('#dashApp'\), \{ hubs: HUBS,/);
  for (const w of ['ops:contracts-from-the-game', 'ops:reputation-ranks', 'ops:next-objective']) assert.ok(app.includes(`'${w}':`), w);
  assert.match(ui, /const K_DASH = 'arsenal\.dash';/);
  assert.match(ui, /removeAttribute\('id'\)/); assert.match(ui, /setAttribute\('inert', ''\)/);
  assert.match(ui, /Save dashboard/); assert.match(ui, /Add widget/); assert.match(ui, /New dashboard/);
  assert.doesNotMatch(ui + core, /innerHTML|insertAdjacentHTML|\.style\.|https?:\/\/|fetch\(/);
});
