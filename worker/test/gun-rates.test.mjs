import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanRates } from '../sc-gun-rates.js';
import { addGunRates, indexRates } from '../../site/bureau/rsi1/companion/gun-rates.js';
import { totals, indexParts } from '../../site/bureau/rsi1/companion/builder-core.js';

const rates = cleanRates(JSON.parse(readFileSync(new URL('../sc-gun-rates.json', import.meta.url), 'utf8')));

test('the shipped rates are clean and cover many guns', () => {
  assert.ok(rates.guns.length > 100);
  assert.ok(rates.guns.every((g) => g.n && g.dps > 0));
});

test('a gun matches by name and size, ignoring punctuation, and carries its barrels', () => {
  const data = { parts: [{ id: 'a', type: 'WeaponGun', name: 'CF-227 Badger Repeater', size: 2, wpn: { burst: 300 } }, { id: 'b', type: 'Shield', name: 'CF-227 Badger Repeater', size: 2 }] };
  assert.equal(addGunRates(data, rates), 1);
  assert.equal(data.parts[0].game.barrels, 3);
  assert.ok(data.parts[0].game.dps > 300);
  assert.equal(data.parts[1].game, undefined);
  assert.ok(data.parts[0].x['game data.fire rate rpm'] > 0);
});

test('two guns sharing a name with different numbers are not guessed', () => {
  const idx = indexRates({ guns: [{ n: 'Twin', s: 4, dps: 583, rpm: 1 }, { n: 'Twin', s: 4, dps: 875, rpm: 1 }, { n: 'Same', s: 2, dps: 100, rpm: 1 }, { n: 'Same', s: 2, dps: 100.5, rpm: 1 }] });
  assert.equal(idx.has('twin|4'), false);
  assert.equal(idx.has('same|2'), true);
});

test('totals add game DPS, falling back to the wiki figure for guns the game data does not cover, and count conflicts', () => {
  const parts = [
    { id: 'g1', type: 'WeaponGun', name: 'A', size: 2, wpn: { burst: 300, sustained: 300, alpha: 10 }, game: { dps: 328, rpm: 750 } },
    { id: 'g2', type: 'WeaponGun', name: 'B', size: 2, wpn: { burst: 200, sustained: 200, alpha: 10 }, game: { dps: 270, rpm: 900, uneven: true, dpsAlt: 150 } },
    { id: 'g3', type: 'WeaponGun', name: 'C', size: 2, wpn: { burst: 100, sustained: 100, alpha: 10 } }
  ];
  const ship = { slots: parts.map((p) => ({ id: 's' + p.id, type: 'WeaponGun', min: 2, max: 2, stock: p.id })) };
  const t = totals(ship, indexParts(parts));
  assert.equal(t.burstDps, 600);
  assert.equal(t.gameDps, 698);
  assert.equal(t.gameGuns, 2);
  assert.equal(t.gameUneven, 1);
});
