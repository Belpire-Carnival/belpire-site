// Objectives pane (Plan hub) and the "next objective" tile on OmniOps. Text nodes only; the list lives in this browser's
// localStorage under arsenal.plan.obj, which the companion profile sync carries between devices. The maths is in obj-core.js.
import { cleanBp, keyOf } from './plan-core.js';
import { cleanObjectives, addUnlock, addGather, setHave, setDone, removeObjective, progress, sortObjectives, nextObjective, openCount } from './obj-core.js';
import { meter } from './viz.js';

const K_OBJ = 'arsenal.plan.obj';
const K_BP = 'arsenal.plan.bp';
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const changed = () => window.dispatchEvent(new CustomEvent('arsenal:plan'));
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

const objectives = () => cleanObjectives(read(K_OBJ, []));
const owned = () => cleanBp(read(K_BP, null));
const save = (list) => { write(K_OBJ, list); changed(); };

// Other panes add objectives through these two.
export const trackUnlock = (item) => { const before = objectives(); const next = addUnlock(before, item); save(next); return next.length > before.length; };
export const trackGather = (payload) => { const next = addGather(objectives(), payload); save(next); return next.length > 0; };

const pct = (f) => `${Math.round(f * 100)}%`;
const fmt = (n) => String(Math.round(n * 1000) / 1000);

export function initObjectives(host, { toast = () => {} } = {}) {
  if (!host) return null;
  const name = el('input', { type: 'text', maxlength: '80', placeholder: 'A blueprint you want to unlock', 'aria-label': 'Blueprint name' });
  const add = el('button', { type: 'button', class: 'primary', text: 'Track this unlock' });
  const list = el('div', { class: 'mt12' });
  host.append(el('div', { class: 'row pfrow' }, el('label', { class: 'pf' }, el('span', { class: 'small muted', text: 'Blueprint to unlock' }), name), add), list);
  add.addEventListener('click', () => {
    const n = name.value.trim();
    if (!n) { toast('Type a blueprint name first'); return; }
    toast(trackUnlock({ name: n }) ? 'Added to your objectives' : 'Already in your objectives');
    name.value = '';
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });

  function card(o, bp) {
    const p = progress(o, bp);
    const head = el('div', { class: 'row between' },
      el('div', {}, el('b', { text: o.name }), ' ', el('span', { class: `chip${p.done ? ' ok' : ''}`, text: o.kind === 'unlock' ? 'Unlock' : `Gather ×${o.crafts}` })),
      el('span', { class: 'small muted', text: p.label }));
    const kids = [head, meter(p.frac * 100, p.done ? 'ok' : '')];
    if (o.kind === 'gather') {
      const tb = el('tbody');
      o.items.forEach((it, i) => {
        const have = el('input', { type: 'number', min: '0', step: it.unit === 'SCU' ? '0.01' : '1', 'aria-label': `${it.name} collected` }); have.value = fmt(it.have);
        have.addEventListener('change', () => save(setHave(objectives(), o.id, i, have.value)));
        const done = it.have >= it.need;
        tb.append(el('tr', {}, el('td', {}, el('b', { text: it.name }), it.minq != null ? el('div', { class: 'small muted', text: `quality ${it.minq}+` }) : null),
          el('td', { text: it.group || '—' }), el('td', {}, have), el('td', { text: `of ${fmt(it.need)} ${it.unit === 'SCU' ? 'SCU' : ''}`.trim() }),
          el('td', {}, el('span', { class: done ? 'chip ok' : 'chip', text: done ? 'ready' : `${pct(it.have / it.need)}` }))));
      });
      kids.push(el('div', { class: 'scrollx mt8' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Material', 'Slot', 'Collected', 'Needed', ''].map((t) => el('th', { text: t })))), tb)));
    }
    const row = el('div', { class: 'row mt8' });
    if (o.kind === 'gather' && o.bpId) row.append(el('a', { class: 'ghost btnlink', href: `#fabricator?b=${encodeURIComponent(o.bpId)}`, text: 'Open in Fabricator' }));
    if (o.kind === 'unlock') row.append(el('a', { class: 'ghost btnlink', href: '#blueprints', text: 'Find it in the catalog' }));
    const owns = o.kind === 'unlock' && bp.owned[keyOf(o.name)];
    if (!owns) row.append(el('button', { type: 'button', text: o.done ? 'Reopen' : 'Mark done', onclick: () => save(setDone(objectives(), o.id, !o.done)) }));
    const del = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove ${o.name}` });
    del.addEventListener('click', () => {
      if (del.dataset.armed) { save(removeObjective(objectives(), o.id)); return; }
      del.dataset.armed = '1'; del.textContent = 'Remove?'; del.className = 'danger';
      setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕'; del.className = 'ghost'; }, 3000);
    });
    row.append(del);
    kids.push(row);
    return el('div', { class: `card obj${p.done ? ' doneobj' : ''}` }, ...kids);
  }

  function draw() {
    const bp = owned(), all = sortObjectives(objectives(), bp);
    list.replaceChildren();
    if (!all.length) { list.append(el('p', { class: 'small muted', text: 'No objectives yet. Track a blueprint above, press Track this unlock on a catalog entry, or press Make this an objective on a craft in the Fabricator.' })); return; }
    list.append(el('p', { class: 'small muted', text: `${openCount(all, bp)} open of ${all.length}. Unlock objectives tick themselves off after a Fabricator scan shows you own the blueprint.` }));
    for (const o of all) list.append(card(o, bp));
  }
  window.addEventListener('arsenal:plan', draw);
  draw();
  return { draw };
}

// OmniOps: the objective closest to done.
export function initNextObjective(host) {
  if (!host) return null;
  function draw() {
    const bp = owned(), list = objectives(), next = nextObjective(list, bp);
    host.replaceChildren();
    if (!next) { host.append(el('p', { class: 'small muted', text: list.length ? 'Every objective is done.' : 'No objectives yet.' }), el('a', { href: '#objectives', text: 'Set an objective' })); return; }
    host.append(el('div', { class: 'row between' }, el('b', { text: next.objective.name }), el('span', { class: 'small muted', text: pct(next.frac) })),
      meter(next.frac * 100), el('p', { class: 'small muted', text: `${next.label} · ${openCount(list, bp)} open` }), el('a', { href: '#objectives', text: 'All objectives' }));
  }
  window.addEventListener('arsenal:plan', draw);
  draw();
  return { draw };
}
