import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easternToIso, formatEastern } from '../../site/big-tent/time.mjs';

test('Eastern date + time becomes an exact instant on both sides of daylight saving', () => {
  assert.equal(easternToIso('2026-10-30', '20:00'), '2026-10-30T20:00:00-04:00'); // EDT
  assert.equal(easternToIso('2026-11-06', '20:00'), '2026-11-06T20:00:00-05:00'); // EST
  assert.equal(easternToIso('2027-03-14', '02:30'), null); // skipped hour when clocks spring forward
  assert.equal(easternToIso('2026-10-30', ''), null);
  assert.equal(easternToIso('10/30/2026', '20:00'), null);
});

test('formats back in Eastern', () => {
  assert.match(formatEastern('2026-10-31T00:00:00Z'), /Friday, October 30.*8:00\sPM EDT/);
});
