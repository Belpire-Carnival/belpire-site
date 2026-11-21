import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanGear } from '../sc-mining-gear.js';
import { addMiningGear, nameKeys, fxLine } from '../../site/bureau/rsi1/companion/mining-gear.js';
import { fits, indexParts, resolve } from '../../site/bureau/rsi1/companion/builder-core.js';

const gear = cleanGear(JSON.parse(readFileSync(new URL('../sc-mining-gear.json', import.meta.url), 'utf8')));

test('the shipped gear file is clean and not empty', () => {
  assert.ok(gear.lasers.length >= 10 && gear.modules.length >= 10 && gear.ships.length >= 5);
  for (const l of gear.lasers) assert.ok(l.key && l.name && l.size >= 0);
});

test('ship names match with or without the maker in front', () => {
  assert.deepEqual(nameKeys('MISC Prospector'), ['miscprospector', 'prospector']);
  assert.deepEqual(nameKeys('Prospector'), ['prospector']);
});

test('a Prospector gets one laser head with its stock laser and module slots that fit modules only', () => {
  const data = { parts: [], ships: [{ id: 's1', name: 'Prospector', slots: [{ id: 'g', type: 'Shield', min: 1, max: 1, stock: 'x' }] }, { id: 's2', name: 'Cutlass Black', slots: [] }] };
  assert.equal(addMiningGear(data, gear), 1);
  const ship = data.ships[0], byId = indexParts(data.parts);
  const laserSlots = ship.slots.filter((s) => s.type === 'MiningLaser');
  assert.equal(laserSlots.length, 1);
  assert.ok(byId.get(laserSlots[0].stock), 'stock laser exists as a part');
  assert.ok(fits(laserSlots[0], byId.get(laserSlots[0].stock)));
  const mods = ship.slots.filter((s) => s.type === 'MiningModule');
  assert.ok(mods.length >= 1);
  const anyModule = data.parts.find((p) => p.type === 'MiningModule' && p.size === 1);
  assert.ok(fits(mods[0], anyModule));
  assert.ok(!fits(laserSlots[0], anyModule));
  assert.equal(resolve(ship)[mods[0].id], null);
  assert.equal(data.ships[1].slots.length, 0);
});

test('a MOLE gets three heads and effects read as signed percentages', () => {
  const data = { parts: [], ships: [{ id: 'm', name: 'MOLE', slots: [] }] };
  addMiningGear(data, gear);
  assert.equal(data.ships[0].slots.filter((s) => s.type === 'MiningLaser').length, 3);
  assert.equal(fxLine({ resistance: -30, window: 25 }), '−30% resistance · +25% charge window');
});
