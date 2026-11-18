// OmniDash: your own dashboards built from the panels on every page. Pick a dashboard, add widgets from any page, size them,
// drag them into order, and Save. Saved under "arsenal.dash" (with your profile when signed in). Text nodes only.
//
// Two kinds of widget:
//  * live: the panel's own code draws a working copy here (Contracts from the game, Reputation ranks, Next objective);
//  * mirror: any other panel on any page, shown as a read-only copy that follows the original as it changes, with a link to it.
import { cleanDash, defaultDash, activeBoard, addBoard, renameBoard, removeBoard, setActive, addItem, removeItem, moveItem, resizeItem, same, widgetId, SIZES } from './dash-core.js';

const K_DASH = 'arsenal.dash';
const SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Wide' };
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const titleOf = (card) => { const h = card.querySelector(':scope > h3'); return h ? (h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.textContent : h.textContent).trim() : ''; };

/** Every panel on every page: { id, title, view, viewLabel, hub, card }. Panels are top-level cards with a heading. */
export function scanPanels(hubs, root = document) {
  const label = {}, hubOf = {};
  for (const h of hubs) for (const [id, name] of h.panes) { label[id] = name; hubOf[id] = h.label; }
  const out = [], seen = new Set();
  for (const sec of root.querySelectorAll('section.view')) {
    const view = sec.id.replace(/^v-/, '');
    if (view === 'dash' || !label[view]) continue;
    for (const card of sec.querySelectorAll('.card')) {
      if (card.parentElement && card.parentElement.closest('.card')) continue; // only top-level panels
      const title = titleOf(card); if (!title) continue;
      let id = widgetId(view, title), n = 2; while (seen.has(id)) id = widgetId(view, `${title} ${n++}`);
      seen.add(id);
      out.push({ id, title, view, viewLabel: label[view], hub: hubOf[view], card });
    }
  }
  return out;
}

// A read-only copy of a panel: no ids (so the page's own lookups never find the copy), not focusable or clickable.
function cloneBody(card) {
  const box = el('div', { class: 'dash-mirror' });
  for (const k of card.childNodes) box.append(k.cloneNode(true));
  for (const n of box.querySelectorAll('[id],[for],[name]')) { n.removeAttribute('id'); n.removeAttribute('for'); n.removeAttribute('name'); }
  box.setAttribute('inert', '');
  return box;
}

export function initDash(host, { hubs, live = {}, toast = () => {} } = {}) {
  if (!host) return null;
  let saved = cleanDash(read(K_DASH, null) || defaultDash());
  let draft = saved, panels = [], picking = false, q = '', dragFrom = -1, armDelete = false, renaming = false;
  const liveHosts = new Map(); // widget id -> element a live widget draws into (kept, so it is drawn once)
  const mirrors = new Map();   // widget id -> { box, obs }

  const visible = () => document.body.dataset.v === 'dash';
  const byId = () => new Map(panels.map((p) => [p.id, p]));
  const rescan = () => { panels = scanPanels(hubs); };

  function mirrorOf(p) {
    let m = mirrors.get(p.id);
    if (!m) {
      const box = el('div');
      let t = 0;
      const refresh = () => { box.replaceChildren(cloneBody(p.card)); };
      const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (visible()) refresh(); }, 250); });
      obs.observe(p.card, { subtree: true, childList: true, characterData: true, attributes: true });
      m = { box, refresh, obs }; mirrors.set(p.id, m);
    }
    m.refresh();
    return m.box;
  }

  function bodyOf(p, w) {
    if (live[w]) {
      let h = liveHosts.get(w);
      if (!h) { h = el('div'); liveHosts.set(w, h); live[w](h); }
      return h;
    }
    return mirrorOf(p);
  }

  function setDraft(d) { draft = d; draw(); }

  function toolbar() {
    const b = activeBoard(draft), dirty = !same(draft, saved);
    const pick = el('select', { 'aria-label': 'Dashboard', onchange: (e) => { armDelete = false; renaming = false; setDraft(setActive(draft, e.target.value)); } },
      ...draft.boards.map((x) => el('option', { value: x.id, text: x.name })));
    pick.value = draft.active;
    const nameBox = renaming ? el('input', { type: 'text', value: b.name, maxlength: '40', 'aria-label': 'Dashboard name', onkeydown: (e) => {
      if (e.key === 'Enter') { renaming = false; setDraft(renameBoard(draft, e.target.value)); } else if (e.key === 'Escape') { renaming = false; draw(); }
    } }) : null;
    const row = el('div', { class: 'row dash-bar' }, pick, nameBox,
      el('button', { type: 'button', class: 'ghost', text: renaming ? 'Done' : 'Rename', onclick: () => { if (renaming && nameBox) setDraft(renameBoard(draft, nameBox.value)); renaming = !renaming; draw(); } }),
      el('button', { type: 'button', class: 'ghost', text: 'New dashboard', onclick: () => setDraft(addBoard(draft, '')) }),
      draft.boards.length > 1 ? el('button', { type: 'button', class: armDelete ? 'danger' : 'ghost', text: armDelete ? `Really delete ${b.name}?` : 'Delete', onclick: () => {
        if (!armDelete) { armDelete = true; draw(); setTimeout(() => { armDelete = false; draw(); }, 3000); return; }
        armDelete = false; setDraft(removeBoard(draft));
      } }) : null,
      el('button', { type: 'button', class: picking ? 'primary' : '', text: picking ? 'Close widget list' : 'Add widget', 'aria-expanded': String(picking), onclick: () => { picking = !picking; if (picking) rescan(); draw(); } }),
      el('button', { type: 'button', class: dirty ? 'primary' : 'ghost', text: 'Save dashboard', onclick: save }),
      dirty ? el('button', { type: 'button', class: 'ghost', text: 'Undo changes', onclick: () => { draft = saved; draw(); } }) : null,
      dirty ? el('span', { class: 'chip warn', text: 'Unsaved changes' }) : el('span', { class: 'chip ok', text: 'Saved' }));
    if (nameBox) setTimeout(() => nameBox.focus(), 0);
    return row;
  }

  function picker() {
    const on = new Set(activeBoard(draft).items.map((it) => it.w));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = panels.filter((p) => words.every((w) => `${p.title} ${p.viewLabel} ${p.hub}`.toLowerCase().includes(w)));
    const groups = new Map();
    for (const p of list) { const k = `${p.hub} · ${p.viewLabel}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    const box = el('div', { class: 'card mt12 dash-picker' }, el('h3', { text: 'Add a widget' }),
      el('input', { type: 'search', placeholder: 'Search panels on every page', 'aria-label': 'Search widgets', value: q, oninput: (e) => { q = e.target.value; draw(); setTimeout(() => { const s = host.querySelector('.dash-picker input'); if (s) { s.focus(); s.setSelectionRange(q.length, q.length); } }, 0); } }));
    if (!list.length) box.append(el('p', { class: 'small muted', text: 'No panel matches that search.' }));
    for (const [g, ps] of groups) {
      box.append(el('h4', { class: 'mt8', text: g }));
      for (const p of ps) {
        box.append(el('div', { class: 'dash-pick-row' }, el('span', {}, el('b', { text: p.title }), live[p.id] ? el('span', { class: 'chip ok', text: 'live' }) : null),
          on.has(p.id) ? el('span', { class: 'small muted', text: 'On this dashboard' })
            : el('button', { type: 'button', class: 'ghost', text: 'Add', 'aria-label': `Add ${p.title}`, onclick: () => setDraft(addItem(draft, p.id, 'm')) })));
      }
    }
    return box;
  }

  function widget(p, it, i, count) {
    const frame = el('div', { class: `card dash-w ${it.size}`,
      ondragover: (e) => { if (dragFrom >= 0) e.preventDefault(); },
      ondrop: (e) => { e.preventDefault(); if (dragFrom >= 0 && dragFrom !== i) setDraft(moveItem(draft, dragFrom, i)); dragFrom = -1; } });
    const size = el('select', { 'aria-label': `Size of ${p.title}`, onchange: (e) => setDraft(resizeItem(draft, i, e.target.value)) }, ...SIZES.map((s) => el('option', { value: s, text: SIZE_LABEL[s] })));
    size.value = it.size;
    const grip = el('span', { class: 'dash-grip', draggable: 'true', title: 'Drag to move', 'aria-hidden': 'true', text: '⠿',
      ondragstart: (e) => { dragFrom = i; frame.classList.add('drag'); try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch { /* old browsers */ } },
      ondragend: () => { frame.classList.remove('drag'); dragFrom = -1; } });
    frame.append(el('div', { class: 'dash-head' },
      el('span', { class: 'row' }, grip, el('a', { class: 'small muted', href: '#' + p.view, text: `${p.viewLabel} ›` })),
      el('div', { class: 'dash-tools' }, size,
        el('button', { type: 'button', class: 'ghost', text: '↑', title: 'Move earlier', 'aria-label': `Move ${p.title} earlier`, disabled: i === 0 ? '' : null, onclick: () => setDraft(moveItem(draft, i, i - 1)) }),
        el('button', { type: 'button', class: 'ghost', text: '↓', title: 'Move later', 'aria-label': `Move ${p.title} later`, disabled: i === count - 1 ? '' : null, onclick: () => setDraft(moveItem(draft, i, i + 1)) }),
        el('button', { type: 'button', class: 'ghost', text: '×', title: 'Remove', 'aria-label': `Remove ${p.title}`, onclick: () => setDraft(removeItem(draft, i)) }))),
      el('div', { class: 'dash-body' }, bodyOf(p, it.w)));
    return frame;
  }

  function draw() {
    if (!panels.length) rescan();
    const map = byId(), b = activeBoard(draft);
    const grid = el('div', { class: 'dash-grid' });
    const items = b.items.map((it, i) => [it, i]).filter(([it]) => map.has(it.w));
    for (const [it, i] of items) grid.append(widget(map.get(it.w), it, i, b.items.length));
    const kids = [toolbar()];
    if (picking) kids.push(picker());
    kids.push(items.length ? grid : el('div', { class: 'card mt12' }, el('p', { class: 'small muted', text: 'This dashboard is empty. Press Add widget and pick panels from any page.' })));
    if (b.items.length > items.length) kids.push(el('p', { class: 'small muted mt8', text: `${b.items.length - items.length} widget${b.items.length - items.length === 1 ? ' is' : 's are'} not on the page right now and will show when they are.` }));
    host.replaceChildren(...kids);
  }

  function save() { saved = draft; write(K_DASH, saved); toast('Dashboard saved'); draw(); }

  // Redraw copies when the dashboard is opened (they only follow the original while it is on screen).
  window.addEventListener('hashchange', () => setTimeout(() => { if (visible()) { rescan(); draw(); } }, 0));
  // Saved on another tab or device (profile sync): take it, unless this tab has unsaved changes.
  window.addEventListener('storage', (e) => { if (e.key !== K_DASH) return; const clean = same(draft, saved); saved = cleanDash(read(K_DASH, null) || defaultDash()); if (clean) draft = saved; draw(); });
  draw();
  // Some panels are drawn after a data fetch (reputation, live prices): look again once the page has settled.
  for (const ms of [1500, 6000]) setTimeout(() => { rescan(); draw(); }, ms);
  return { refresh: () => { rescan(); draw(); } };
}
