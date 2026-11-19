import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../site/bureau/rsi1/companion/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Top-level code runs in order, and a const read before its line is a ReferenceError that stops the whole page script.
test('MK, norm and DAY are declared before any top-level call that uses them', () => {
  const first = (re) => { const m = re.exec(src); return m ? m.index : -1; };
  const call = first(/^renderMnLines\(\);/m);
  assert.ok(call > 0, 'the first Mining paint is at the top level');
  for (const name of ['MK', 'norm', 'DAY']) {
    const decl = first(new RegExp('^const ' + name + ' = ', 'm'));
    assert.ok(decl > 0 && decl < call, name + ' must be declared above the first renderMnLines() call');
  }
});
