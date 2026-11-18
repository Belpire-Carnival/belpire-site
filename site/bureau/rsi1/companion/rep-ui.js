// The "Reputation ranks" card on OmniOps: pick your rank on each reputation ladder. Saved with your profile ("arsenal.rep.ranks")
// and shared both ways with OmniGlass Desktop (the app sends its choices; it reads yours back). Text nodes only.
import { cleanRanks, setRank, parseLadders, ladderView, countSet } from './rep-core.js';

const K_RANKS = 'arsenal.rep.ranks';
const API_FACTIONS = '/api/companion/data?name=factions';
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

export function initRanks(host) {
  if (!host) return null;
  let ladders = [], q = '', state = 'loading';
  const list = el('div', { class: 'scrollx mt8' });
  const count = el('span', { class: 'chip' });
  const search = el('input', { type: 'search', placeholder: 'Search a faction', 'aria-label': 'Search reputation ladders', oninput: (e) => { q = e.target.value; drawList(); } });

  function drawList() {
    const ranks = cleanRanks(read(K_RANKS, {}));
    count.textContent = `${countSet(ladders, ranks)} of ${ladders.length} set`;
    if (state !== 'ready') { list.replaceChildren(el('p', { class: 'small muted', text: state === 'loading' ? 'Loading the reputation ladders…' : 'The reputation ladders could not be loaded. Try again later.' })); return; }
    const tb = el('tbody');
    for (const l of ladderView(ladders, ranks, q)) {
      const sel = el('select', { 'aria-label': `Your rank with ${l.faction} (${l.scope})`, onchange: (e) => {
        write(K_RANKS, setRank(read(K_RANKS, {}), l.id, e.target.value));
        window.dispatchEvent(new CustomEvent('arsenal:ranks'));
      } }, el('option', { value: '', text: 'Not set' }), ...l.standings.map((s) => el('option', { value: s.name, text: s.name })));
      sel.value = l.rank;
      tb.append(el('tr', {}, el('td', {}, el('b', { text: l.faction }), el('span', { class: 'small muted', text: ` ${l.scope}` })), el('td', {}, sel),
        el('td', { class: 'small muted', text: l.next ? `Next: ${l.next}` : '' })));
    }
    list.replaceChildren(tb.childNodes.length ? el('table', { 'aria-label': 'Reputation ranks' }, tb) : el('p', { class: 'small muted', text: 'No ladder matches that search.' }));
  }

  host.replaceChildren(el('h3', { text: 'Reputation ranks' }),
    el('p', { class: 'small muted', text: 'Pick the rank you have with each faction. It is saved with your profile and shared with OmniGlass Desktop, which uses it to show which contracts you can take.' }),
    el('div', { class: 'row' }, search, count), list);
  drawList();
  fetch(API_FACTIONS).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { ladders = parseLadders(j); state = 'ready'; drawList(); }).catch(() => { state = 'error'; drawList(); });
  window.addEventListener('arsenal:ranks', drawList);
  window.addEventListener('storage', (e) => { if (e.key === K_RANKS) drawList(); });
  return { refresh: drawList };
}
