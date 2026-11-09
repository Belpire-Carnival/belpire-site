// Holographic pop-ups for the ship calculator: a part's full data sheet, and a sortable swap table that shares it.
// Built with text nodes and SVG attributes only, like the rest of the page. The maths and the data layout are in
// builder-core.js; this file only draws.
import { columnsFor, sortParts, detailGroups, cheapest, TYPE_LABEL, num, fmtVal } from './builder-core.js';
import { meter } from './viz.js';
import { partArt, photo } from './art.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

// A dialog with a title bar. Closing it (button, Esc, a click outside) removes it and gives focus back.
function frame(kicker, title, wide) {
  const back = document.activeElement;
  const dlg = h('dialog', { class: `holo${wide ? ' wide' : ''}`, 'aria-label': title });
  const shut = () => { try { dlg.close(); } catch { dlg.remove(); } };
  dlg.append(h('div', { class: 'holo-head' },
    h('div', {}, h('div', { class: 'lbl', text: kicker }), h('h3', { class: 'holo-title', text: title })),
    h('button', { type: 'button', class: 'ghost holo-x', text: 'Close ✕', 'aria-label': 'Close', onclick: shut })));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) shut(); });
  dlg.addEventListener('close', () => { dlg.remove(); try { back?.focus?.(); } catch { /* element is gone */ } });
  return { dlg, shut };
}

function mount(dlg) {
  document.body.append(dlg);
  try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
}

const grid = (rows) => {
  const g = h('dl', { class: 'dgrid' });
  for (const [k, v] of rows) g.append(h('dt', { text: k }), h('dd', { text: v }));
  return g;
};

// The data sheet of one part: key figures, where to buy it, then every figure in the game data, by group.
export function detailPane(part) {
  const pane = h('div', { class: 'holo-detail' });
  if (!part) {
    pane.append(h('p', { class: 'small muted', text: 'Pick a part to see its data sheet.' }));
    return pane;
  }
  pane.append(h('div', { class: 'holo-part' },
    photo(part.img, part.name, partArt(part.type), 'photo thumb'),
    h('div', {}, h('h4', { class: 'holo-name', text: part.name }),
      h('div', { class: 'mk', text: [part.mfr, TYPE_LABEL[part.type] || part.type, part.cls, part.grade && `grade ${part.grade}`, part.size != null && `size ${part.size}`].filter(Boolean).join(' · ') }))));
  const key = columnsFor(part.type).map((c) => [c.label, c.get(part)]).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, typeof v === 'number' ? fmtVal(v) : v]);
  if (key.length) pane.append(h('div', { class: 'lbl mt8', text: 'Key figures' }), grid(key));
  const buy = cheapest(part);
  pane.append(h('div', { class: 'lbl mt8', text: 'Where to buy' }),
    buy ? h('p', { class: 'small m0', text: `${num(buy.price)} aUEC at ${buy.at}${buy.where ? ` · ${buy.where}` : ''}${buy.sys ? ` (${buy.sys})` : ''}${buy.date ? ` · seen ${buy.date}${buy.stale ? ', old' : ''}` : ''}` })
      : h('p', { class: 'small muted m0', text: 'No shop is known for this part. It may be loot, a reward or stock-only.' }));
  const groups = detailGroups(part);
  if (!groups.length) pane.append(h('p', { class: 'small muted mt8', text: 'The game data holds no further figures for this part.' }));
  groups.forEach((g, i) => pane.append(h('details', { class: 'dgroup', open: i < 2 ? '' : null }, h('summary', { text: `${g.title} (${g.rows.length})` }), grid(g.rows))));
  return pane;
}

// Data sheet on its own, from the Details buttons.
export function openDetail(part) {
  if (!part) return;
  const { dlg, shut } = frame(TYPE_LABEL[part.type] || 'Part', part.name, false);
  dlg.append(h('div', { class: 'holo-body one' }, detailPane(part)), h('div', { class: 'holo-foot' }, h('button', { type: 'button', text: 'Close', onclick: shut })));
  mount(dlg);
}

// Sortable table of every part that fits a slot (Erkul-style), with the data sheet of the highlighted row beside it.
// onPick(partId) is called with '' when the player clears a choice (only offered with allowClear).
export function openSwap({ title, kicker, type, options, currentId, stockId, allowClear, onPick }) {
  const cols = columnsFor(type);
  const { dlg, shut } = frame(kicker || TYPE_LABEL[type] || 'Swap', title, true);
  let sortCol = cols[0];
  let dir = -1;
  let query = '';
  let sel = options.some((p) => p.id === currentId) ? currentId : options[0]?.id;
  const byId = new Map(options.map((p) => [p.id, p]));
  const max = new Map(cols.filter((c) => c.bar).map((c) => [c.id, Math.max(0, ...options.map((p) => Number(c.get(p)) || 0))]));

  const thead = h('tr');
  const tbody = h('tbody');
  const detail = h('div', { class: 'holo-side' });
  const equip = h('button', { type: 'button', class: 'primary', text: 'Equip' });
  const status = h('span', { class: 'small muted', role: 'status' });

  const showDetail = () => { detail.textContent = ''; detail.append(detailPane(byId.get(sel))); };
  const refreshFoot = () => {
    const same = sel === currentId;
    equip.textContent = same ? 'Fitted' : 'Equip';
    if (same) equip.setAttribute('disabled', ''); else equip.removeAttribute('disabled');
  };
  const choose = (id) => { sel = id; for (const r of tbody.children) r.classList.toggle('sel', r.dataset.id === id); showDetail(); refreshFoot(); };

  function head() {
    thead.textContent = '';
    thead.append(h('th', { text: 'Part' }));
    for (const c of cols) {
      const on = c === sortCol;
      thead.append(h('th', { class: 'num', 'aria-sort': on ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', { type: 'button', class: `sortbtn${on ? ' on' : ''}`, text: `${c.label}${on ? (dir > 0 ? ' ▲' : ' ▼') : ''}`, onclick: () => { if (sortCol === c) dir = -dir; else { sortCol = c; dir = c.higher ? -1 : 1; } head(); rows(); } })));
    }
  }

  function rows() {
    const q = query.trim().toLowerCase();
    const list = sortParts(options.filter((p) => !q || `${p.name} ${p.mfr || ''}`.toLowerCase().includes(q) || p.id === currentId), sortCol, dir);
    tbody.textContent = '';
    for (const p of list) {
      const tr = h('tr', { class: `swaprow${p.id === sel ? ' sel' : ''}${p.id === currentId ? ' cur' : ''}`, tabindex: '0', 'data-id': p.id,
        onclick: () => choose(p.id), ondblclick: () => { onPick(p.id); shut(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); choose(p.id); } } },
      h('td', {}, h('b', { text: p.name }), h('div', { class: 'mk', text: [p.mfr, p.id === currentId && 'fitted', p.id === stockId && 'stock'].filter(Boolean).join(' · ') })));
      for (const c of cols) {
        const v = c.get(p);
        const td = h('td', { class: 'num' });
        if (v == null || v === '') td.textContent = '—';
        else if (c.bar && max.get(c.id)) td.append(h('div', { class: 'cellbar' }, h('span', { text: fmtVal(Number(v)) }), meter(Math.round((Number(v) / max.get(c.id)) * 100), 'info')));
        else td.textContent = typeof v === 'number' ? fmtVal(v) : String(v);
        tr.append(td);
      }
      tbody.append(tr);
    }
    status.textContent = `${list.length} of ${options.length} parts shown`;
  }

  const search = h('input', { type: 'search', placeholder: 'Filter by name or maker', 'aria-label': 'Filter parts' });
  search.addEventListener('input', () => { query = search.value; rows(); });
  equip.addEventListener('click', () => { if (sel && sel !== currentId) { onPick(sel); shut(); } });
  head();
  rows();
  showDetail();
  refreshFoot();
  dlg.append(h('div', { class: 'holo-tools' }, search, status),
    h('div', { class: 'holo-body' }, h('div', { class: 'holo-list' }, h('table', { class: 'swaptbl' }, h('thead', {}, thead), tbody)), detail),
    h('div', { class: 'holo-foot' }, equip,
      allowClear && currentId ? h('button', { type: 'button', class: 'ghost', text: 'Back to stock', onclick: () => { onPick(''); shut(); } }) : null,
      h('button', { type: 'button', class: 'ghost', text: 'Close', onclick: shut })));
  mount(dlg);
  const first = tbody.querySelector('tr.sel');
  if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
}
