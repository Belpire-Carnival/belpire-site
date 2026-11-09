import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { statSheet, STAT_GROUPS, STAT_KEYS, indexParts } from '../../site/bureau/rsi1/companion/builder-core.js';
import { slimShip } from '../sc-builder.js';

const cutlass = JSON.parse(readFileSync(new URL('./fixtures/cutlass-slim.json', import.meta.url), 'utf8')).data;

test('the stat sheet covers damage, defense, speed, handling, cargo, systems and signature', () => {
  const ship = slimShip(cutlass);
  const sheet = statSheet(ship, indexParts([]), {});
  assert.deepEqual(Object.keys(sheet).sort(), [...STAT_KEYS].sort());
  assert.deepEqual(STAT_GROUPS.map((g) => g[0]), ['Damage', 'Defense', 'Speed', 'Maneuverability', 'Cargo and range', 'Systems', 'Signature']);
  assert.equal(sheet.cargo, ship.cargo || null);
  for (const v of Object.values(sheet)) assert.ok(v === null || Number.isFinite(v));
});

test('the page wires Save to fleet, the fleet stat table and the mobile menu', () => {
  const dir = new URL('../../site/bureau/rsi1/companion/', import.meta.url);
  const b = readFileSync(new URL('builder.js', dir), 'utf8'), a = readFileSync(new URL('app.js', dir), 'utf8'), h = readFileSync(new URL('index.html', dir), 'utf8');
  assert.match(b, /text: 'Save to fleet'/); assert.match(b, /statSheet\(s, partsById, ov\)/);
  assert.match(a, /arsenal:hangar-add/); assert.match(a, /function renderStatTable/);
  assert.match(h, /id="flStats"/); assert.match(h, /id="menuBtn"[^>]*aria-expanded="false"/);
});

test('the companion carries the FinTac OmniGlass identity and no mobiGlas wording', () => {
  const dir = new URL('../../site/bureau/rsi1/companion/', import.meta.url);
  for (const f of ['index.html', 'app.js', 'builder.js', 'loadouts.js', 'outfits.js', 'items.js']) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /mobi-?glas/i, f);
  const h = readFileSync(new URL('index.html', dir), 'utf8');
  assert.match(h, /<title>FinTac OmniGlass \/\/ Companion OS<\/title>/);
  assert.match(h, /<h1>FINTAC OMNIGLASS<\/h1>/); assert.match(h, /id="ogStatus"/); assert.match(h, /id="dock"/);
  for (const n of ['OmniOps', 'TacBoard', 'Slag &amp; Scrape', 'Extraction OS', 'OmniRoute', 'GridMaster', 'Ballistics Matrix', 'Hangar Command']) assert.ok(h.includes(n), n);
});
