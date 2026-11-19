import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanGear } from '../sc-mining-gear.js';
import { addMiningGear, nameKeys } from '../../site/bureau/rsi1/companion/mining-gear.js';
import { fits, indexParts, resolve } from '../../site/bureau/rsi1/companion/builder-core.js';

const gear = cleanGear(JSON.parse(readFileSync(new URL('../sc-mining-gear.json', import.meta.url), 'utf8')));

test('the shipped gear file carries salvage heads, scrapers and ships', () => {
  assert.ok(gear.salvage.heads.length >= 2 && gear.salvage.modules.length >= 5 && gear.salvage.ships.length >= 5);
});

test('a Vulture gets two Baler heads, each with two empty scraper slots that fit scrapers only', () => {
  const data = { parts: [], ships: [{ id: 'v', name: 'Drake Vulture', slots: [] }, { id: 'c', name: 'Cutlass Black', slots: [] }] };
  addMiningGear(data, gear);
  const ship = data.ships[0], byId = indexParts(data.parts);
  const heads = ship.slots.filter((s) => s.type === 'SalvageHead');
  assert.equal(heads.length, 2);
  assert.ok(fits(heads[0], byId.get(heads[0].stock)));
  const scr = ship.slots.filter((s) => s.type === 'SalvageModifier');
  assert.equal(scr.length, 4);
  const scraper = data.parts.find((p) => p.type === 'SalvageModifier');
  assert.ok(fits(scr[0], scraper));
  assert.ok(!fits(heads[0], scraper));
  assert.equal(resolve(ship)[scr[0].id], null);
  assert.equal(data.ships[1].slots.length, 0);
});

