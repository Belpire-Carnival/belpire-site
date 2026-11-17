import { test } from 'node:test';
import assert from 'node:assert/strict';

// A tiny page stand-in: enough to build a picker and see where its suggestion box goes.
class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.attrs = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.className = ''; this.classes = new Set(); this.classList = { add: (c) => this.classes.add(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(e, f) { (this.listeners[e] ||= []).push(f); }
  append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k); } }
  set textContent(v) { this._t = v; if (v === '') this.children = []; }
  get textContent() { return this._t || ''; }
}
globalThis.document = { createElement: (t) => new Node_(t) };

test('a picker made before its input is on the page does not throw, and attaches once the input has a parent', async () => {
  const { strictPick } = await import('../../site/bureau/rsi1/companion/pick-ui.js');
  const input = new Node_('input');
  const pick = strictPick(input, {});
  pick.setSource({ get: async () => ['Carrack', 'Cutlass Black'] });
  const parent = new Node_('div');
  parent.append(input);
  input.value = 'car';
  for (const f of input.listeners.input) f();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(parent.classes.has('hasPick'));
  assert.equal(parent.children.filter((c) => c.attrs.role === 'listbox').length, 1);
});

test('a picker made with its input already in the page attaches straight away', async () => {
  const { strictPick } = await import('../../site/bureau/rsi1/companion/pick-ui.js');
  const parent = new Node_('div');
  const input = new Node_('input');
  parent.append(input);
  strictPick(input, {});
  assert.ok(parent.classes.has('hasPick'));
});
