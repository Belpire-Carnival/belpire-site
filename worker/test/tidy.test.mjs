import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyShips } from '../../site/bureau/rsi1/companion/builder.js';

const sh = (id, name, extra = {}) => ({ id, name, mfr: 'RSI', scm: 200, cargo: 0, stats: { hull: 1000 }, api: { shieldHp: 100 }, slots: [{ id: 'a' }], buy: [], img: 'a/ab/x.png', ...extra });

test('tidy: duplicate name+maker collapses to the best documented copy and aliases the rest', () => {
  const ships = [sh('1', 'Aquila', { img: '' }), sh('2', 'Aquila'), sh('3', 'Aquila', { img: '' }), sh('4', 'Andromeda')];
  const t = tidyShips(ships);
  assert.deepEqual(t.ships.map((x) => x.id).sort(), ['2', '4']);
  assert.equal(t.alias.get('1'), '2');
});
test('tidy: ships without stats are dropped and say why; a picture-less ship stays unless a pictured variant exists', () => {
  const noStats = sh('9', 'Ghost', { scm: 0, stats: { hull: 0 }, api: {}, cargo: 0 });
  const mix = [sh('1', 'Cutlass Black'), sh('2', 'Corsair', { img: '' }), sh('3', 'Cutlass Black Steel', { img: '' }), noStats];
  const t = tidyShips(mix);
  assert.deepEqual(t.ships.map((x) => x.id).sort(), ['1', '2']);
  assert.equal(t.alias.get('3'), '1');
  assert.ok(t.dropped.some((d) => d.name === 'Ghost' && /no flight stats/.test(d.why)));
  assert.ok(t.dropped.some((d) => d.name === 'Cutlass Black Steel' && /variant/.test(d.why)));
});
