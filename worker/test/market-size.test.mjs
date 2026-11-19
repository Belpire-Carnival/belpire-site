import test from 'node:test';
import assert from 'node:assert/strict';
import { bestRuns, sizeRun } from '../../site/bureau/rsi1/companion/market.js';

const r = (commodity, terminal, buy, sell, scuBuy = null, scuSell = null) => ({ commodity, terminal, system: 'Stanton', place: terminal, buy, sell, scuBuy, scuSell, at: null });

test('a trip carries the lowest of hold, capital, stock and demand, and says which', () => {
  const from = r('Gold', 'A', 10, null, null, 500), to = r('Gold', 'B', null, 30, 80, null);
  assert.deepEqual(sizeRun(from, to, { hold: 96 }), { scu: 80, limit: 'demand', profit: 1600 });
  assert.deepEqual(sizeRun(from, to, { hold: 96, capital: 300 }), { scu: 30, limit: 'capital', profit: 600 });
  assert.equal(sizeRun(from, to, { hold: 20 }).limit, 'hold');
  assert.equal(sizeRun({ ...from, scuSell: 10 }, to, { hold: 20 }).limit, 'stock');
  assert.equal(sizeRun(r('X', 'A', 10, null), r('X', 'B', null, 30), {}).scu, 0);
});

test('without a size the ranking is unchanged; with one the better trip wins over the better margin', () => {
  const rows = [r('Gold', 'A', 10, null, null, 500), r('Gold', 'B', null, 25, 400, null), r('Gold', 'C', null, 40, 5, null)];
  assert.equal(bestRuns(rows)[0].to.terminal, 'C');
  assert.equal(bestRuns(rows)[0].scu, undefined);
  const sized = bestRuns(rows, { size: { hold: 100, capital: 0 } })[0];
  assert.equal(sized.to.terminal, 'B');
  assert.equal(sized.scu, 100);
  assert.equal(sized.profit, 1500);
});
