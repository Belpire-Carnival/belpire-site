// Holographic pop-ups for the ship calculator: a part's full data sheet, and a sortable swap table that shares it.
// Built with text nodes and SVG attributes only, like the rest of the page. The maths and the data layout are in
// builder-core.js; this file only draws.
import { columnsFor, sortParts, detailGroupsVs, compareCol, isBuyable, cheapest, TYPE_LABEL, num, fmtVal } from './builder-core.js';
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

// The pop-ups grow out of the card or button that opened them and settle slightly off-axis (the tilt itself is in the CSS).
// The element is remembered at pointer-down, because a clickable card is not focusable and so is never document.activeElement.
let lastHit = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastHit = e.target instanceof Element ? e.target.closest('.part, .gun, button') : null; }, true);
  document.addEventListener('keydown', () => { lastHit = null; }, true);
}
// While a pop-up is open the page behind it does not scroll (the lists inside the pop-up still do). Counted, so two stacked pop-ups
// (the data sheet opened from the swap table) release it only when the last one closes.
let locks = 0;
const lockPage = () => { locks += 1; document.documentElement.classList.add('holo-open'); };
const unlockPage = () => { locks = Math.max(0, locks - 1); if (!locks) document.documentElement.classList.remove('holo-open'); };
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TILT = 'perspective(1400px) rotateY(-2deg) rotateX(1deg)';

// Keyframes that map the settled dialog onto the source element: shrunk, shifted onto it and turned further off-axis.
function fromSource(dlg, src) {
  const d = dlg.getBoundingClientRect();
  const s = src?.isConnected ? src.getBoundingClientRect() : null;
  if (!s || !s.width || !d.width) return { shift: 'translateY(14px) scale(.96)', turn: '' };
  const dx = s.left + s.width / 2 - (d.left + d.width / 2);
  const dy = s.top + s.height / 2 - (d.top + d.height / 2);
  const k = Math.min(0.5, Math.max(0.08, s.width / d.width));
  return { shift: `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${k.toFixed(3)})`, turn: 'perspective(1400px) rotateY(-16deg) rotateX(7deg)' };
}

// A dialog with a title bar. Closing it (button, Esc, a click outside) removes it and gives focus back.
function frame(kicker, title, wide) {
  const back = document.activeElement;
  const dlg = h('dialog', { class: `holo${wide ? ' wide' : ''}`, 'aria-label': title });
  dlg.holoSrc = lastHit?.isConnected ? lastHit : back;
  let closing = false;
  const end = () => { try { dlg.close(); } catch { dlg.remove(); } };
  const shut = () => {
    if (closing) return;
    closing = true;
    if (calm() || !dlg.animate) return end();
    const { shift, turn } = fromSource(dlg, dlg.holoSrc);
    dlg.animate([{ opacity: 1, transform: TILT }, { opacity: 0, transform: `${shift} ${turn}`.trim() }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished.then(end, end);
  };
  dlg.append(h('div', { class: 'holo-head' },
    h('div', {}, h('div', { class: 'lbl', text: kicker }), h('h3', { class: 'holo-title', text: title })),
    h('button', { type: 'button', class: 'ghost holo-x', text: 'Close ✕', 'aria-label': 'Close', onclick: shut })));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) shut(); });
  dlg.addEventListener('close', () => { if (dlg.holoLocked) { dlg.holoLocked = false; unlockPage(); } dlg.remove(); try { back?.focus?.(); } catch { /* element is gone */ } });
  return { dlg, shut };
}

function mount(dlg) {
  document.body.append(dlg);
  try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
  dlg.holoLocked = true;
  lockPage();
  if (calm() || !dlg.animate) return;
  const { shift, turn } = fromSource(dlg, dlg.holoSrc);
  dlg.animate([{ opacity: 0, transform: `${shift} ${turn}`.trim() }, { opacity: 1, transform: TILT }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

// rows are [label, value, difference?, class?]; a difference is drawn small beside the value, green or red when it has a direction.
const grid = (rows) => {
  const g = h('dl', { class: 'dgrid' });
  for (const [k, v, d, cls] of rows) g.append(h('dt', { text: k }), h('dd', {}, v, d ? h('span', { class: `dv ${cls || 'diff'}`, text: d }) : null));
  return g;
};

// The data sheet of one part: key figures, where to buy it, then every figure in the game data, by group.
export function detailPane(part, ref) {
  const pane = h('div', { class: 'holo-detail' });
  if (!part) {
    pane.append(h('p', { class: 'small muted', text: 'Pick a part to see its data sheet.' }));
    return pane;
  }
  pane.append(h('div', { class: 'holo-part' },
    photo(part.img, part.name, partArt(part.type), 'photo thumb'),
    h('div', {}, h('h4', { class: 'holo-name', text: part.name }),
      h('div', { class: 'mk', text: [part.mfr, TYPE_LABEL[part.type] || part.type, part.cls, part.grade && `grade ${part.grade}`, part.size != null && `size ${part.size}`].filter(Boolean).join(' · ') }))));
  const cols = columnsFor(part.type);
  const key = cols.map((c) => [c.label, c.get(part), compareCol(c, part, ref)]).filter(([, v]) => v != null && v !== '')
    .map(([k, v, cmp]) => [k, typeof v === 'number' ? fmtVal(v) : v, cmp?.text, cmp?.cls]);
  if (ref && ref.id !== part.id) pane.append(h('p', { class: 'small muted m0 mt8', text: `Compared with your fitted ${ref.name}: green is better, red is worse.` }));
  else if (ref) pane.append(h('p', { class: 'small muted m0 mt8', text: 'This is the part you have fitted.' }));
  if (key.length) pane.append(h('div', { class: 'lbl mt8', text: 'Key figures' }), grid(key));
  const buy = cheapest(part);
  pane.append(h('div', { class: 'lbl mt8', text: 'Where to buy' }),
    buy ? h('p', { class: 'small m0', text: `${num(buy.price)} aUEC at ${buy.at}${buy.where ? ` · ${buy.where}` : ''}${buy.sys ? ` (${buy.sys})` : ''}${buy.date ? ` · seen ${buy.date}${buy.stale ? ', old' : ''}` : ''}` })
      : h('p', { class: 'small muted m0', text: 'No shop is known for this part. It may be loot, a reward or stock-only.' }));
  const groups = detailGroupsVs(part, ref);
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
  let shop = 'all'; // all | buy | nobuy
  let sel = options.some((p) => p.id === currentId) ? currentId : options[0]?.id;
  const byId = new Map(options.map((p) => [p.id, p]));
  // What the table is compared against: the fitted part, or the stock part when the fitted one is a missile choice not yet made.
  const ref = byId.get(currentId) || byId.get(stockId) || null;
  const max = new Map(cols.filter((c) => c.bar).map((c) => [c.id, Math.max(0, ...options.map((p) => Number(c.get(p)) || 0))]));

  const thead = h('tr');
  const tbody = h('tbody');
  const detail = h('div', { class: 'holo-side' });
  const equip = h('button', { type: 'button', class: 'primary', text: 'Equip' });
  const status = h('span', { class: 'small muted', role: 'status' });

  const showDetail = () => { detail.textContent = ''; detail.append(detailPane(byId.get(sel), ref)); };
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
    const list = sortParts(options.filter((p) => p.id === currentId || ((!q || `${p.name} ${p.mfr || ''}`.toLowerCase().includes(q)) && (shop === 'all' || (shop === 'buy') === isBuyable(p)))), sortCol, dir);
    tbody.textContent = '';
    for (const p of list) {
      const tr = h('tr', { class: `swaprow${p.id === sel ? ' sel' : ''}${p.id === currentId ? ' cur' : ''}`, tabindex: '0', 'data-id': p.id,
        onclick: () => choose(p.id), ondblclick: () => { onPick(p.id); shut(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); choose(p.id); } } },
      h('td', {}, h('b', { text: p.name }), h('div', { class: 'mk', text: [p.mfr, p.id === currentId && 'fitted', p.id === stockId && 'stock'].filter(Boolean).join(' · ') })));
      for (const c of cols) {
        const v = c.get(p);
        const cmp = compareCol(c, p, ref);
        const td = h('td', { class: `num${cmp?.cls ? ` ${cmp.cls}` : ''}` });
        if (cmp?.text) td.setAttribute('title', `${cmp.text} compared with the fitted ${ref.name}`);
        if (v == null || v === '') td.textContent = '—';
        else {
          const text = typeof v === 'number' ? fmtVal(v) : String(v);
          const cell = h('div', { class: 'cellv' }, h('span', { class: 'v', text }));
          if (c.bar && max.get(c.id)) cell.append(meter(Math.round((Number(v) / max.get(c.id)) * 100), 'info'));
          if (cmp?.text) cell.append(h('span', { class: `dv ${cmp.cls || 'diff'}`, text: cmp.text }));
          td.append(cell);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    status.textContent = `${list.length} of ${options.length} parts shown`;
  }

  // Filter by what the game sells. "No shop known" parts may still be loot, rewards or stock-only.
  const nBuy = options.filter(isBuyable).length;
  const shopTabs = h('div', { class: 'tabs holo-shop', role: 'group', 'aria-label': 'Filter by availability' });
  const shopDefs = [['all', `All (${options.length})`], ['buy', `Buyable in game (${nBuy})`], ['nobuy', `No shop known (${options.length - nBuy})`]];
  const paintShop = () => { shopTabs.textContent = ''; for (const [id, label] of shopDefs) shopTabs.append(h('button', { type: 'button', 'aria-pressed': String(id === shop), text: label, onclick: () => { shop = id; paintShop(); rows(); } })); };
  paintShop();

  const search = h('input', { type: 'search', placeholder: 'Filter by name or maker', 'aria-label': 'Filter parts' });
  search.addEventListener('input', () => { query = search.value; rows(); });
  equip.addEventListener('click', () => { if (sel && sel !== currentId) { onPick(sel); shut(); } });
  head();
  rows();
  showDetail();
  refreshFoot();
  dlg.append(h('div', { class: 'holo-tools' }, search, shopTabs, status),
    h('div', { class: 'holo-legend small muted' }, ref ? h('span', {}, 'Each figure is compared with your fitted ', h('b', { text: ref.name }), ': ', h('span', { class: 'dv better', text: 'green' }), ' is better, ', h('span', { class: 'dv worse', text: 'red' }), ' is worse.') : null),
    h('div', { class: 'holo-body' }, h('div', { class: 'holo-list' }, h('table', { class: 'swaptbl' }, h('thead', {}, thead), tbody)), detail),
    h('div', { class: 'holo-foot' }, equip,
      allowClear && currentId ? h('button', { type: 'button', class: 'ghost', text: 'Back to stock', onclick: () => { onPick(''); shut(); } }) : null,
      h('button', { type: 'button', class: 'ghost', text: 'Close', onclick: shut })));
  mount(dlg);
  const first = tbody.querySelector('tr.sel');
  if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
}
