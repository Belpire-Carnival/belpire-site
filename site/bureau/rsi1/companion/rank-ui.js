// Weapon rankings for the Avionics Lab page: FPS weapons by time to kill against an armor class, and ship guns by
// time to destroy a reference ship. Data comes only from our own /api/sc-weapons, /api/sc-armor and /api/sc-builder; the
// maths is in rank-core.js. The page is built with text nodes only, and the choices live in this browser's localStorage.
import { ARMOR, rankFps, rankShipGuns, shipEhp, topOverall, topByGroup, topByClass } from './rank-core.js';
import { indexParts, viewOf } from './builder-core.js';

const API_WEAPONS = '/api/sc-weapons';
const API_ARMOR = '/api/sc-armor';
const API_BUILDER = '/api/sc-builder';
const KEY = 'arsenal.rankings';

const store = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
};

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

const getJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};

const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const secs = (v) => fmt(v, v != null && v < 10 ? 2 : 1);
const ARMOR_NAME = { NONE: 'No armor', LIGHT: 'Light armor', MEDIUM: 'Medium armor', HEAVY: 'Heavy armor' };
const CLASS_NOTE = { Physical: 'Ballistic rounds', Energy: 'Lasers and plasma', Mixed: 'Both damage types', Distortion: 'Disables rather than kills', Unknown: 'Damage type not in the data' };

export function initRankings(host) {
  let st = { tab: 'fps', list: 'top', armor: 'MEDIUM', hp: 100, zone: 1, reload: 0, ship: '', minRange: 0, size: '', ...store.read() };
  let weapons = null; // null = not loaded, false = unavailable, else [..]
  let armor = null; // { Light: { phys, energy }, ... } | false
  let build = null; // { ships, parts, byId } | false | 'wait'
  let started = false;

  const save = () => store.write(st);
  const set = (patch) => { st = { ...st, ...patch }; save(); paint(); };

  async function load() {
    const [w, a, b] = await Promise.allSettled([getJson(API_WEAPONS), getJson(API_ARMOR), getJson(API_BUILDER)]);
    weapons = w.status === 'fulfilled' && Array.isArray(w.value?.weapons) && w.value.weapons.length ? w.value.weapons : false;
    armor = a.status === 'fulfilled' && a.value?.classes ? a.value.classes : false;
    if (b.status === 'fulfilled' && b.value?.ready && Array.isArray(b.value.ships)) {
      const ships = b.value.ships.filter((s) => viewOf(s) === 'ship' && Number(s.stats?.hull) > 0).sort((x, y) => x.name.localeCompare(y.name));
      build = { ships, parts: b.value.parts || [], byId: indexParts(b.value.parts) };
      if (!ships.some((s) => s.id === st.ship)) st.ship = (ships.find((s) => /^gladius$/i.test(s.name)) || ships[0])?.id || '';
    } else build = b.status === 'fulfilled' ? 'wait' : false;
    paint();
  }

  // ---------------------------------------------------------------- controls
  const field = (label, control) => el('label', { class: 'f' }, label, control);
  const numInput = (key, props = {}) => {
    const i = el('input', { type: 'number', step: props.step || 'any', min: props.min ?? '0', 'aria-label': props.aria || props.label });
    i.value = st[key] ?? '';
    i.addEventListener('change', () => set({ [key]: i.value === '' ? 0 : Number(i.value) }));
    return i;
  };
  const select = (key, options) => {
    const s = el('select', {}, ...options.map(([v, t]) => el('option', { value: v, text: t })));
    s.value = String(st[key] ?? '');
    s.addEventListener('change', () => set({ [key]: s.value }));
    return s;
  };
  const tabs = (label, items, cur, onPick) => el('div', { class: 'tabs', role: 'group', 'aria-label': label },
    ...items.map(([id, text]) => el('button', { type: 'button', 'aria-pressed': String(id === cur), text, onclick: () => onPick(id) })));

  // ---------------------------------------------------------------- tables
  const th = (text, num) => el('th', { class: num ? 'num' : '', text });
  const nameCell = (r, sub) => el('td', {}, el('b', { text: r.name }), el('div', { class: 'mk', text: sub }));
  const wrap = (table) => el('div', { class: 'scrollx' }, table);

  function fpsTable(rows) {
    const t = el('table', { class: 'ranktbl' }, el('thead', {}, el('tr', {}, th('#', true), th('Weapon'), th('Damage'), th('Dmg / shot', true), th('Shots', true), th('Reloads', true), th('TTK (s)', true), th('Burst TTK (s)', true), th('DPS', true))));
    const body = el('tbody');
    rows.forEach((r, i) => body.append(el('tr', {},
      el('td', { class: 'num', text: String(i + 1) }), nameCell(r, [r.mfr, r.type].filter(Boolean).join(' · ')), el('td', { text: r.cls }),
      el('td', { class: 'num', text: fmt(r.dmg, 1) }), el('td', { class: 'num', text: fmt(r.shots) }), el('td', { class: 'num', text: fmt(r.reloads) }),
      el('td', { class: 'num best', text: secs(r.ttk) }), el('td', { class: 'num', text: secs(r.ttkBurst) }), el('td', { class: 'num', text: fmt(r.dps, 0) }))));
    t.append(body);
    return wrap(t);
  }

  function shipTable(rows) {
    const t = el('table', { class: 'ranktbl' }, el('thead', {}, el('tr', {}, th('#', true), th('Gun'), th('Size', true), th('Damage'), th('Sustained DPS', true), th('Burst DPS', true), th('Range (m)', true), th('TTK (s)', true), th('Burst TTK (s)', true))));
    const body = el('tbody');
    rows.forEach((r, i) => body.append(el('tr', {},
      el('td', { class: 'num', text: String(i + 1) }), nameCell(r, [r.mfr, r.grade && `grade ${r.grade}`].filter(Boolean).join(' · ')), el('td', { class: 'num', text: r.size == null ? '—' : `S${r.size}` }), el('td', { text: r.cls }),
      el('td', { class: 'num', text: fmt(r.sustained, 0) }), el('td', { class: 'num', text: fmt(r.burst, 0) }), el('td', { class: 'num', text: fmt(r.range, 0) }),
      el('td', { class: 'num best', text: secs(r.ttk) }), el('td', { class: 'num', text: secs(r.ttkBurst) }))));
    t.append(body);
    return wrap(t);
  }

  // A short podium: the best few of one group, name and time.
  const podium = (title, sub, rows) => el('div', { class: 'rankcard' },
    el('div', { class: 'lbl', text: title }), sub ? el('div', { class: 'small muted', text: sub }) : null,
    el('ol', { class: 'ranklist' }, ...rows.map((r) => el('li', {}, el('span', { text: r.name }), el('b', { class: 'num', text: `${secs(r.ttk)} s` })))));

  // ---------------------------------------------------------------- one tab's body
  function lists(rows, table, groupKey, groupLabel) {
    const out = el('div', {});
    if (!rows.length) return out.appendChild(el('p', { class: 'small muted', text: 'No weapons match these settings.' })) && out;
    if (st.list === 'top') out.append(table(topOverall(rows, 20)));
    else if (st.list === 'type') {
      for (const g of topByGroup(rows, groupKey, 10)) out.append(el('h4', { class: 'rankhead', text: `${g.key} · top ${g.rows.length}` }), table(g.rows));
    } else if (st.list === 'class') {
      const split = topByClass(rows, 10);
      for (const g of split) out.append(el('h4', { class: 'rankhead', text: `${g.key} · ${CLASS_NOTE[g.key] || ''}` }), table(g.rows));
    } else out.append(el('div', { class: 'rankgrid' }, ...topByGroup(rows, groupKey, 5).map((g) => podium(g.key, groupLabel, g.rows))));
    return out;
  }

  function fpsBody() {
    if (weapons === null) return el('p', { class: 'small muted', text: 'Loading the weapon list…' });
    if (weapons === false) return el('p', { class: 'small muted', text: 'The weapon list is unavailable right now. Try again in a minute.' });
    const cls = armor && st.armor !== 'NONE' ? armor[st.armor[0] + st.armor.slice(1).toLowerCase()] : null;
    const mult = st.armor === 'NONE' ? { phys: 1, energy: 1 } : cls ? { phys: cls.phys, energy: cls.energy } : null;
    const ctl = el('div', { class: 'fields' },
      field('Target armor', select('armor', ARMOR.map((a) => [a, ARMOR_NAME[a]]))),
      field('Target health', numInput('hp', { label: 'Target health', min: '1' })),
      field('Hit-zone multiplier', numInput('zone', { label: 'Hit-zone multiplier', min: '0.1' })),
      field('Reload time (s)', numInput('reload', { label: 'Reload time in seconds' })));
    if (!mult) return el('div', {}, ctl, el('p', { class: 'small muted mt8', text: 'Armor multipliers are unavailable right now, so only "No armor" can be ranked. Pick it above, or try again in a minute.' }));
    const { rows, skipped } = rankFps(weapons, { hp: st.hp, armor: mult }, { zone: st.zone, reload: st.reload });
    return el('div', {}, ctl,
      el('p', { class: 'small muted mt8', text: `Target: ${ARMOR_NAME[st.armor].toLowerCase()} (physical ×${fmt(mult.phys, 2)}, energy ×${fmt(mult.energy, 2)}), ${fmt(st.hp)} health, hit zone ×${fmt(st.zone, 2)}.` }),
      lists(rows, fpsTable, (r) => r.type, 'Best by time to kill'),
      el('p', { class: 'small muted mt8', text: `Assumes every shot lands in the chosen zone and the first shot fires at t = 0. TTK includes burst cooldowns and the reload time above; burst TTK is straight cyclic fire. The game data has no reload time, so one value applies to every weapon (0 ignores reloads). Damage falloff and bullet drag are not modelled.${skipped ? ` ${skipped} weapon${skipped === 1 ? ' has' : 's have'} no damage or rate of fire in the data and ${skipped === 1 ? 'is' : 'are'} not ranked.` : ''}` }));
  }

  function shipBody() {
    if (build === null) return el('p', { class: 'small muted', text: 'Loading ships and guns…' });
    if (build === 'wait') return el('p', { class: 'small muted', text: 'The ship data is still being rebuilt. Try again in a few minutes.' });
    if (build === false) return el('p', { class: 'small muted', text: 'The ship data is unavailable right now. Try again in a minute.' });
    const ship = build.ships.find((s) => s.id === st.ship) || build.ships[0];
    const target = ship ? shipEhp(ship, build.byId) : null;
    const sizes = [...new Set(build.parts.filter((p) => p.type === 'WeaponGun' && p.size != null).map((p) => p.size))].sort((a, b) => a - b);
    const ctl = el('div', { class: 'fields' },
      field('Reference ship', select('ship', build.ships.map((s) => [s.id, s.name]))),
      field('Gun size', select('size', [['', 'All sizes'], ...sizes.map((z) => [String(z), `Size ${z}`])])),
      field('Engagement range at least (m)', numInput('minRange', { label: 'Engagement range at least, in metres' })));
    if (!target) return el('div', {}, ctl, el('p', { class: 'small muted mt8', text: 'The data has no hull figure for that ship.' }));
    const { rows, noRange } = rankShipGuns(build.parts, target.ehp, { minRange: st.minRange, size: st.size });
    return el('div', {}, ctl,
      el('p', { class: 'small muted mt8', text: `Target: ${ship.name}, ${fmt(target.ehp)} health (hull ${fmt(target.hull)} + shields ${fmt(target.shield)}).` }),
      lists(rows, shipTable, (r) => (r.size == null ? 'Other sizes' : `Size ${r.size}`), 'Best by time to destroy'),
      el('p', { class: 'small muted mt8', text: `One gun firing at its sustained (60 s) damage against the reference ship's hull and the shields it ships with; burst shows its peak. Armor, shield absorption, hit location and gun convergence are not modelled. Damage type is read from each part's data sheet.${noRange ? ` ${noRange} gun${noRange === 1 ? ' has' : 's have'} no range in the data and ${noRange === 1 ? 'is' : 'are'} hidden while a minimum range is set.` : ''}` }));
  }

  // ---------------------------------------------------------------- page
  function paint() {
    host.textContent = '';
    const isShip = st.tab === 'ship';
    host.append(el('div', { class: 'card' },
      el('h3', { text: 'Weapon rankings' }),
      el('p', { class: 'small muted', text: 'Fastest time to kill first. Weapon data comes from the Star Citizen Wiki item database and is only as current as its last update.' }),
      tabs('Weapon kind', [['fps', 'FPS weapons'], ['ship', 'Ship armaments']], st.tab, (tab) => set({ tab, list: st.list })),
      el('div', { class: 'mt8' }, tabs('List', [['top', 'Top 20 overall'], ['type', isShip ? 'Top 10 by size' : 'Top 10 by type'], ['class', 'Physical vs Energy'], ['best', 'Best in class']], st.list, (list) => set({ list }))),
      el('div', { class: 'mt10' }, isShip ? shipBody() : fpsBody())));
  }

  paint();
  return {
    show() { if (started) return; started = true; load(); }
  };
}
