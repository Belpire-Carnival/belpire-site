// Ship calculator for the Calculator tab. Data comes from our own /api/sc-builder (hardpoints, parts, ship stats and
// shop prices from the Star Citizen Wiki API); the maths is in builder-core.js and the drawing helpers in viz.js and
// art.js. The page is built with text nodes and SVG attributes only.
import {
  indexParts, partsFor, totals, diff, upgradeCost, slotLabel, partLabel, TYPE_LABEL, TOTAL_ROWS, deltaClass, signed,
  reduction, coolingLoad, damageSplit, changedSlots, encodeBuild, decodeBuild, num, dims, gm, kms
} from './builder-core.js';
import { icon, meter, ring, pips, duo } from './viz.js';
import { shipArt, partArt } from './art.js';

const API = '/api/sc-builder';
const KEY = 'arsenal.builder';
const MAX_SAVED = 40;
const MAX_NAMED = 30;
const MAX_RECENT = 5;

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

const fmt1 = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
const sortKey = (p) => p.shield?.hp ?? p.wpn?.burst ?? p.gen ?? p.cool ?? 0;
const SYS_TYPES = ['Shield', 'PowerPlant', 'Cooler', 'Radar', 'QuantumDrive', 'JumpDrive'];
const SYS_ICON = { Shield: 'combat', PowerPlant: 'ops', Cooler: 'mining', Radar: 'ops', QuantumDrive: 'fleet', JumpDrive: 'fleet' };

export function initBuilder(host) {
  let data = null;
  let partsById = new Map();
  let started = false;
  let saved = store.read(); // { ship, recent: [ids], builds: { shipId: { slotId: partId } }, named: [{ id, name, ship, ov, at }], cmp }
  let filter = '';
  let status = '';

  const persist = () => store.write(saved);
  const ship = () => data?.ships.find((s) => s.id === saved.ship) || null;
  const overrides = (s) => (saved.builds && saved.builds[s.id]) || {};

  function setShip(id) {
    saved.ship = id;
    saved.recent = [id, ...(saved.recent || []).filter((x) => x !== id)].slice(0, MAX_RECENT);
    persist();
  }

  function setBuild(s, ov) {
    saved.builds = saved.builds || {};
    delete saved.builds[s.id];
    if (Object.keys(ov).length) saved.builds[s.id] = ov; // re-added last, so the oldest builds fall off first
    const ids = Object.keys(saved.builds);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SAVED))) delete saved.builds[id];
    persist();
  }

  function setOverride(s, slotId, partId) {
    const cur = { ...overrides(s) };
    const slot = s.slots.find((x) => x.id === slotId);
    if (!partId || partId === slot?.stock) delete cur[slotId]; else cur[slotId] = partId;
    setBuild(s, cur);
  }

  function message(text, retry) {
    host.textContent = '';
    host.append(el('div', { class: 'card' }, el('h3', { text: 'Calculator' }), el('p', { class: 'small muted', text })));
    if (retry) host.firstChild.append(el('button', { type: 'button', class: 'ghost', text: 'Try again', onclick: () => { started = false; show(); } }));
  }

  // ------------------------------------------------------------ pieces
  const title = (name, text) => el('div', { class: 'sectitle' }, icon(name), el('h3', { text }));
  const card = (cls, ...kids) => el('div', { class: `card ${cls || ''}`.trim() }, ...kids);
  const kv = (rows) => {
    const g = el('div', { class: 'kv' });
    for (const [k, v, d, cls] of rows) g.append(el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }), el('span', { class: `dv ${cls || ''}`.trim(), text: d || '' }));
    return g;
  };
  const bigstat = (n, label, d, dcls, hi) => el('div', { class: `bigstat ${hi ? 'hi' : ''}`.trim() },
    el('div', { class: 'n', text: n }), el('div', { class: 'lbl', text: label }), el('div', { class: `d ${dcls || ''}`.trim(), text: d || ' ' }));
  const delta = (a, b, better = true, digits = 0) => {
    const d = Math.round((b - a) * 10 ** digits) / 10 ** digits;
    return d ? { text: signed(d), cls: deltaClass(d, better) } : { text: '', cls: '' };
  };

  function optionsFor(slot, s) {
    const options = partsFor(slot, data.parts).sort((a, b) => sortKey(b) - sortKey(a) || a.name.localeCompare(b.name));
    const stock = partsById.get(slot.stock);
    if (stock && !options.some((p) => p.id === stock.id)) options.unshift(stock);
    return options;
  }

  function swapSelect(s, slot, current) {
    const sel = el('select', { 'aria-label': `${slotLabel(slot)} part` });
    for (const p of optionsFor(slot, s)) sel.append(el('option', { value: p.id, text: `${partLabel(p)}${p.id === slot.stock ? ' · stock' : ''}` }));
    sel.value = current || '';
    sel.addEventListener('change', () => { setOverride(s, slot.id, sel.value); paint(); });
    return sel;
  }

  function partCard(s, slot, ov) {
    const current = ov[slot.id] ?? slot.stock;
    const p = partsById.get(current);
    const size = slot.min === slot.max ? `S${slot.max}` : `S${slot.min}–${slot.max}`;
    const big = p ? (p.shield?.hp != null ? fmt1(p.shield.hp) : p.gen != null ? fmt1(p.gen) : p.cool != null ? fmt1(p.cool) : '') : '';
    const unit = p ? (p.shield?.hp != null ? 'shield HP' : p.gen != null ? 'power segments' : p.cool != null ? 'cooling' : '') : '';
    const c = el('div', { class: `part ${current !== slot.stock ? 'changed' : ''}`.trim() },
      el('span', { class: 'sz', text: size }),
      el('div', {}, el('div', { class: 'nm', text: p?.name || 'Unknown part' }), el('div', { class: 'mk', text: [p?.mfr, p?.grade && `grade ${p.grade}`, p?.cls].filter(Boolean).join(' · ') })),
      el('div', {}, el('div', { class: 'big', text: big }), el('div', { class: 'mk', text: unit })));
    if (p?.shield?.regen != null) c.append(el('div', { class: 'wide mk', text: `${fmt1(p.shield.regen)} HP/s regen` }));
    c.append(swapSelect(s, slot, current));
    return c;
  }

  function gunRow(s, slot, ov) {
    const current = ov[slot.id] ?? slot.stock;
    const p = partsById.get(current);
    const w = p?.wpn;
    const row = el('div', { class: `gun ${current !== slot.stock ? 'changed' : ''}`.trim() },
      el('div', {}, el('div', { class: 'nm', text: `S${slot.max} ${p?.name || 'Unknown'}` }),
        el('div', { class: 'mk', text: `${slotLabel(slot)}${w ? ` · alpha ${fmt1(w.alpha)} · sustained ${fmt1(w.sustained)}${w.range ? ` · ${fmt1(w.range)} m` : ''}` : ''}` })),
      el('div', { class: 'big', text: w ? fmt1(w.burst) : '—' }));
    row.append(swapSelect(s, slot, current));
    return row;
  }

  // ------------------------------------------------------------ panels
  function damagePanel(s, base, mine, ov) {
    const split = damageSplit(s, partsById, ov);
    const stock = damageSplit(s, partsById, {});
    const a = delta(base.alpha, mine.alpha), su = delta(base.sustainedDps, mine.sustainedDps), b = delta(base.burstDps, mine.burstDps);
    return card('', title('combat', 'Damage'),
      el('div', { class: 'big3' }, bigstat(fmt1(mine.alpha), 'Alpha', a.text, a.cls), bigstat(fmt1(mine.sustainedDps), 'Sustained DPS', su.text, su.cls, true), bigstat(fmt1(mine.burstDps), 'Burst DPS', b.text, b.cls)),
      kv([
        ['Pilot guns', `${fmt1(split.pilot.burst)}`, `${split.pilot.guns} gun${split.pilot.guns === 1 ? '' : 's'}`],
        ['Turret guns', `${fmt1(split.turret.burst)}`, `${split.turret.guns} gun${split.turret.guns === 1 ? '' : 's'}`],
        ['Stock burst (pilot / turret)', `${fmt1(stock.pilot.burst)} / ${fmt1(stock.turret.burst)}`, '']
      ]),
      s.stats?.missiles?.damage ? el('p', { class: 'small muted mt8', text: `Missiles: ${num(s.stats.missiles.damage)} total damage across ${num(s.stats.missiles.count)} (stock; missiles are not swappable here yet).` }) : null);
  }

  function defensePanel(s, base, mine) {
    const st = s.stats;
    const hp = delta(base.shieldHp, mine.shieldHp), rg = delta(base.shieldRegen, mine.shieldRegen);
    const res = st?.shield?.resist, abs = st?.shield?.absorb, arm = st?.armor;
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    return card('', title('combat', 'Defense'),
      el('div', { class: 'big3' }, bigstat(fmt1(mine.shieldHp), 'Shield HP', hp.text, hp.cls, true), bigstat(fmt1(mine.shieldRegen), 'Regen HP/s', rg.text, rg.cls), bigstat(st?.armor?.hp != null ? num(st.armor.hp) : '—', 'Armor HP')),
      kv([
        ['Shield faces', st?.shield?.face || '—', ''],
        ['Resistance  phys / energy / dist', `${pct(res?.phys)} / ${pct(res?.energy)} / ${pct(res?.dist)}`, ''],
        ['Absorption  phys / energy / dist', `${pct(abs?.phys)} / ${pct(abs?.energy)} / ${pct(abs?.dist)}`, ''],
        ['Armor damage reduction  phys / energy / dist', [arm?.phys, arm?.energy, arm?.dist].map((v) => (reduction(v) == null ? '—' : `${reduction(v)}%`)).join(' / '), '']
      ]),
      st?.sig ? el('div', { class: 'sig mt8' }, el('span', { class: 'tag2', text: `IR ${num(st.sig.ir)}` }), el('span', { class: 'tag2', text: `EM ${num(st.sig.em)}` }), el('span', { class: 'tag2', text: `Cross-section ${num(st.sig.cs, 1)}` })) : null);
  }

  function hullPanel(s) {
    const st = s.stats;
    if (!st) return null;
    return card('', title('cargo', 'Hull'),
      el('div', { class: 'big3' }, bigstat(num(st.hull), 'Hull HP'), bigstat(num(st.mass), 'Mass (kg)'), bigstat(st.dim?.[0] != null ? `${num(st.dim[0], 1)}` : '—', 'Length (m)')),
      kv([['Dimensions', dims(st.dim), ''], ['Armor HP', num(st.armor?.hp), ''], ['Insurance claim', st.insure?.claim != null ? `${num(st.insure.claim, 1)} min` : '—', ''],
        ['Expedite', st.insure?.expedite != null ? `${num(st.insure.expedite, 1)} min · ${num(st.insure.cost)} aUEC` : '—', '']]));
  }

  function armamentPanel(s, ov) {
    const guns = s.slots.filter((x) => x.type === 'WeaponGun');
    const c = card('', title('combat', `Armament (${guns.length})`));
    if (!guns.length) c.append(el('p', { class: 'small muted', text: 'No swappable guns on this ship.' }));
    for (const g of guns) c.append(gunRow(s, g, ov));
    return c;
  }

  function systemsPanel(s, ov) {
    const c = el('div', { class: 'calc' });
    for (const type of SYS_TYPES) {
      const slots = s.slots.filter((x) => x.type === type);
      if (!slots.length) continue;
      const box = card('', el('div', { class: 'sectitle' }, icon(SYS_ICON[type]), el('h3', { text: `${TYPE_LABEL[type]} (${slots.length})` }), partArt(type)));
      for (const slot of slots) box.append(partCard(s, slot, ov));
      c.append(box);
    }
    return c;
  }

  function powerPanel(s, base, mine) {
    const load = coolingLoad(mine), baseLoad = coolingLoad(base);
    const demand = mine.powerDraw, supply = mine.powerGen;
    const used = supply ? Math.min(100, Math.round((demand / supply) * 100)) : 0;
    return card('', title('ops', 'Power and cooling'),
      el('div', { class: 'row between' },
        el('div', {}, el('div', { class: 'lbl', text: 'Cooling load' }), ring(load ?? 0, 'Cooling load', load > 100 ? 'warn' : 'ok'),
          el('div', { class: 'mk small muted', text: baseLoad != null ? `stock ${baseLoad}%` : '' })),
        el('div', { class: 'grow' }, el('div', { class: 'lbl', text: `Power segments  ${fmt1(demand)} of ${fmt1(supply)} used` }), pips(demand, supply),
          meter(used, used > 100 ? 'warn' : 'info'),
          el('div', { class: 'lbl mt8', text: `Cooling  ${fmt1(mine.coolDraw)} of ${fmt1(mine.coolGen)}` }), meter(load ?? 0, load > 100 ? 'warn' : 'ok'))),
      el('p', { class: 'small muted mt8', text: 'Counts the parts you can swap. Fixed systems (flight controller, life support) draw power too and are not in these numbers.' }));
  }

  function flightPanel(s) {
    const st = s.stats;
    const ag = st?.agility;
    return card('', title('fleet', 'Flight'),
      el('div', { class: 'big3' }, bigstat(num(ag?.pitch), 'Pitch °/s', ag?.pitchB ? `boost ${num(ag.pitchB)}` : ''), bigstat(num(ag?.yaw), 'Yaw °/s', ag?.yawB ? `boost ${num(ag.yawB)}` : ''), bigstat(num(ag?.roll), 'Roll °/s', ag?.rollB ? `boost ${num(ag.rollB)}` : '')),
      kv([['SCM speed', s.scm ? `${num(s.scm)} m/s` : '—', ''], ['Max speed', s.max ? `${num(s.max)} m/s` : '—', ''],
        ['Boost fwd / back', st?.speed ? `${num(st.speed.boostF)} / ${num(st.speed.boostB)} m/s` : '—', ''], ['0 to SCM', st?.speed?.toScm != null ? `${num(st.speed.toScm, 1)} s` : '—', ''],
        ['Hydrogen fuel', st?.fuel?.h2 != null ? `${num(st.fuel.h2, 1)} SCU` : '—', ''], ['Quantum fuel', st?.fuel?.qt != null ? `${num(st.fuel.qt, 1)} SCU` : '—', ''],
        ['Quantum speed', kms(st?.quantum?.speed), ''], ['Spool', st?.quantum?.spool != null ? `${num(st.quantum.spool, 1)} s` : '—', ''], ['Quantum range', gm(st?.quantum?.range), '']]),
      el('p', { class: 'small muted mt8', text: 'These are the ship\'s own figures. Engine and quantum drive swaps will change them in game; this page does not model that yet.' }));
  }

  function totalsPanel(s, base, mine) {
    const d = diff(base, mine);
    const body = el('tbody');
    for (const [k, label, better] of TOTAL_ROWS) {
      if (!base[k] && !mine[k]) continue;
      body.append(el('tr', {}, el('td', { text: label }), el('td', { class: 'num', text: fmt1(base[k]) }), el('td', { class: 'num', text: fmt1(mine[k]) }),
        el('td', { class: `num ${deltaClass(d[k], better)}`, text: d[k] ? signed(d[k]) : '—' }), el('td', { class: 'w-num' }, duo(base[k], mine[k]))));
    }
    const c = card('', title('log', 'Stock vs your build'), el('div', { class: 'scrollx' }, el('table', { class: 'cmp' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Stat' }), el('th', { class: 'num', text: 'Stock' }), el('th', { class: 'num', text: 'Your build' }), el('th', { class: 'num', text: 'Change' }), el('th', { text: '' }))), body)));
    if (mine.missing) c.append(el('p', { class: 'small muted', text: `${mine.missing} part${mine.missing === 1 ? '' : 's'} not in the catalogue were left out.` }));
    return c;
  }

  function costPanel(s, ov) {
    const up = upgradeCost(s, partsById, ov);
    const c = card('', title('trade', 'Upgrade cost'));
    if (!up.lines.length) { c.append(el('p', { class: 'small muted', text: 'Swap a part to see what it costs and where to buy it.' })); return c; }
    const body = el('tbody');
    for (const l of up.lines) {
      const b = l.buy;
      body.append(el('tr', {}, el('td', { text: l.part }),
        el('td', { class: 'num', text: b ? `${num(b.price)} aUEC` : 'no shop known' }),
        el('td', { class: 'small', text: b ? `${b.at}${b.where ? ` · ${b.where}` : ''}${b.sys ? ` (${b.sys})` : ''}` : '' }),
        el('td', { class: `small ${b?.stale ? 'warn' : 'muted'}`, text: b ? `${b.date}${b.stale ? ' · old' : ''}` : '' })));
    }
    c.append(el('div', { class: 'scrollx' }, el('table', { class: 'cost' }, el('thead', {}, el('tr', {}, el('th', { text: 'Part' }), el('th', { class: 'num', text: 'Cheapest' }), el('th', { text: 'Where' }), el('th', { text: 'Seen' }))), body)));
    c.append(el('p', { class: 'mt8', text: `Known total: ${num(up.total)} aUEC${up.unknown ? ` · ${up.unknown} part${up.unknown === 1 ? ' has' : 's have'} no known shop` : ''}` }));
    if (up.stale) c.append(el('div', { class: 'note stale', text: 'Some prices are over 30 days old. UEX prices are community reports: check in game before you buy.' }));
    return c;
  }

  function summaryOf(s, ov) { return totals(s, partsById, ov); }

  function comparePanel(s, mine) {
    const named = (saved.named || []).filter((n) => n.ship === s.id);
    const c = card('', title('log', 'Compare with another build'));
    const sel = el('select', { 'aria-label': 'Build to compare with' }, el('option', { value: 'stock', text: 'Stock loadout' }));
    for (const n of named) sel.append(el('option', { value: n.id, text: n.name }));
    sel.value = named.some((n) => n.id === saved.cmp) ? saved.cmp : 'stock';
    sel.addEventListener('change', () => { saved.cmp = sel.value; persist(); paint(); });
    c.append(sel);
    const other = sel.value === 'stock' ? {} : named.find((n) => n.id === sel.value)?.ov || {};
    const o = summaryOf(s, other);
    const d = diff(o, mine);
    const body = el('tbody');
    for (const [k, label, better] of TOTAL_ROWS) {
      if (!o[k] && !mine[k]) continue;
      body.append(el('tr', {}, el('td', { text: label }), el('td', { class: 'num', text: fmt1(o[k]) }), el('td', { class: 'num', text: fmt1(mine[k]) }), el('td', { class: `num ${deltaClass(d[k], better)}`, text: d[k] ? signed(d[k]) : '—' })));
    }
    c.append(el('div', { class: 'scrollx mt8' }, el('table', { class: 'cmp' }, el('thead', {}, el('tr', {}, el('th', { text: 'Stat' }), el('th', { class: 'num', text: sel.value === 'stock' ? 'Stock' : 'Saved' }), el('th', { class: 'num', text: 'Current' }), el('th', { class: 'num', text: 'Change' }))), body)));
    if (!named.length) c.append(el('p', { class: 'small muted mt8', text: 'Save a build to compare two of your own builds.' }));
    return c;
  }

  function savedPanel(s) {
    const c = card('', title('fleet', 'Saved builds'));
    const name = el('input', { type: 'text', placeholder: 'Name this build', 'aria-label': 'Build name', maxlength: '40' });
    const save = el('button', { type: 'button', class: 'primary', text: 'Save build', onclick: () => {
      const nm = name.value.trim() || `${s.name} build ${((saved.named || []).filter((n) => n.ship === s.id).length + 1)}`;
      saved.named = [{ id: `b${Date.now().toString(36)}`, name: nm.slice(0, 40), ship: s.id, ov: { ...overrides(s) }, at: Date.now() }, ...(saved.named || [])].slice(0, MAX_NAMED);
      persist(); status = `Saved "${nm.slice(0, 40)}".`; paint();
    } });
    c.append(el('div', { class: 'row' }, name, save));
    const list = (saved.named || []);
    if (!list.length) c.append(el('p', { class: 'small muted mt8', text: 'Nothing saved yet. Saved builds stay in this browser.' }));
    for (const n of list) {
      const sh = data.ships.find((x) => x.id === n.ship);
      if (!sh) continue;
      c.append(el('div', { class: 'row between mt8' },
        el('span', { class: 'small', text: `${n.name} · ${sh.name} · ${Object.keys(n.ov).length} swap${Object.keys(n.ov).length === 1 ? '' : 's'}` }),
        el('span', { class: 'row' },
          el('button', { type: 'button', class: 'ghost', text: 'Load', onclick: () => { setShip(sh.id); setBuild(sh, { ...n.ov }); paint(); } }),
          el('button', { type: 'button', class: 'ghost', text: 'To hangar', onclick: () => { addToHangar(sh, n.name); } }),
          el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Delete ${n.name}`, onclick: () => { saved.named = saved.named.filter((x) => x.id !== n.id); persist(); paint(); } }))));
    }
    return c;
  }

  // The hangar lives in app.js; it listens for this event and stores the ship in the player's own hangar.
  function addToHangar(s, label) {
    const ag = s.stats?.agility || {};
    window.dispatchEvent(new CustomEvent('arsenal:hangar-add', { detail: {
      name: `${s.name}${label ? ` (${label})` : ''}`.slice(0, 60), role: s.role || '', scm: s.scm ?? null, nav: s.max ?? null, pitch: ag.pitch ?? null, yaw: ag.yaw ?? null, roll: ag.roll ?? null, accel: null
    } }));
    status = 'Added to your hangar on the Fleet tab.';
    paint();
  }

  // ------------------------------------------------------------ the page
  function topBar(s) {
    const search = el('input', { type: 'search', placeholder: 'Find a ship or maker', 'aria-label': 'Find a ship', value: filter });
    const pick = el('select', { 'aria-label': 'Ship' });
    const fillPick = () => {
      const q = filter.trim().toLowerCase();
      pick.textContent = '';
      for (const x of data.ships.filter((y) => !q || `${y.name} ${y.mfr} ${y.role}`.toLowerCase().includes(q) || y.id === saved.ship)) pick.append(el('option', { value: x.id, text: `${x.name} — ${x.mfr}` }));
      pick.value = saved.ship || '';
    };
    fillPick();
    // Typing only narrows the list; the page is not rebuilt, so the cursor stays where it is.
    search.addEventListener('input', () => { filter = search.value; fillPick(); });
    pick.addEventListener('change', () => { setShip(pick.value); status = ''; paint(); });
    const link = () => `${location.origin}${location.pathname}#calc?b=${encodeBuild(s, overrides(s))}`;
    const share = el('button', { type: 'button', text: 'Share link', onclick: async () => {
      try { await navigator.clipboard.writeText(link()); status = 'Link copied. Anyone who opens it sees this build.'; }
      catch { status = link(); }
      paint();
    } });
    const reset = el('button', { type: 'button', class: 'ghost', text: 'Reset to stock', onclick: () => { setBuild(s, {}); status = ''; paint(); } });
    const tabs = el('div', { class: 'tabs' });
    for (const id of saved.recent || []) {
      const x = data.ships.find((y) => y.id === id);
      if (x) tabs.append(el('button', { type: 'button', 'aria-pressed': String(id === saved.ship), text: x.name, onclick: () => { setShip(id); status = ''; paint(); } }));
    }
    return el('div', { class: 'card' }, el('div', { class: 'calc-bar' }, search, pick, el('div', { class: 'btnrow' }, share, reset)), tabs.childNodes.length ? tabs : null,
      status ? el('p', { class: 'small mt8', role: 'status', text: status }) : null);
  }

  function shipCard(s, base, mine, ov) {
    const hp = delta(base.shieldHp, mine.shieldHp), bu = delta(base.burstDps, mine.burstDps);
    const bits = [s.role, s.career, s.size != null ? `size ${s.size}` : '', s.crew?.max ? `crew ${s.crew.min ?? 1}–${s.crew.max}` : '', s.cargo ? `${s.cargo} SCU` : ''].filter(Boolean);
    const n = changedSlots(s, ov).length;
    return el('div', { class: 'card accent shipcard' }, shipArt(s),
      el('div', {}, el('div', { class: 'lbl', text: s.mfr }), el('h3', { class: 'big', text: s.name }),
        el('div', { class: 'tagrow' }, ...bits.map((b) => el('span', { class: 'tag2', text: b })), n ? el('span', { class: 'tag2', text: `${n} swap${n === 1 ? '' : 's'}` }) : null),
        s.msrp ? el('p', { class: 'small muted mt8', text: `Pledge price from ${num(s.msrp)} USD. In-game prices are not in the wiki data for most ships.` }) : null));
  }

  function summaryCard(base, mine, s) {
    const hp = delta(base.shieldHp, mine.shieldHp), bu = delta(base.burstDps, mine.burstDps), rg = delta(base.shieldRegen, mine.shieldRegen);
    return card('', title('ops', 'At a glance'),
      el('div', { class: 'big3' }, bigstat(fmt1(mine.burstDps), 'Burst DPS', bu.text, bu.cls, true), bigstat(fmt1(mine.shieldHp), 'Shield HP', hp.text, hp.cls, true), bigstat(s.stats?.hull != null ? num(s.stats.hull) : '—', 'Hull HP')),
      kv([['Shield regen / s', fmt1(mine.shieldRegen), rg.text, rg.cls], ['Guns fitted', String(mine.guns), ''], ['Parts mass (swappable)', `${num(mine.mass)} kg`, '']]));
  }

  function paint() {
    const s = ship();
    host.textContent = '';
    if (!s) return;
    const ov = overrides(s);
    const base = summaryOf(s, {});
    const mine = summaryOf(s, ov);
    host.append(topBar(s));
    host.append(el('div', { class: 'calc-top' }, shipCard(s, base, mine, ov), summaryCard(base, mine, s)));
    if (!s.stats) host.append(el('div', { class: 'note info', text: 'Hull, armor, flight and fuel figures arrive with the next data refresh (about a day after a deploy).' }));
    host.append(el('div', { class: 'calc-cols' },
      el('div', { class: 'calc' }, damagePanel(s, base, mine, ov), defensePanel(s, base, mine), hullPanel(s), powerPanel(s, base, mine), flightPanel(s)),
      el('div', { class: 'calc' }, armamentPanel(s, ov)),
      el('div', { class: 'calc' }, systemsPanel(s, ov))));
    host.append(el('div', { class: 'grid g2' }, totalsPanel(s, base, mine), costPanel(s, ov)));
    host.append(el('div', { class: 'grid g2' }, comparePanel(s, mine), savedPanel(s)));
    host.append(el('p', { class: 'small muted', text: `Data: Star Citizen Wiki API (api.star-citizen.wiki), game version ${data.version}, updated ${String(data.updatedAt || '').slice(0, 10)}. Shop prices come from UEX through the same API. Unofficial fan tool; figures follow the game data and can change each patch.` }));
  }

  // A shared link looks like #calc?b=<code>. Apply it once, then tidy the address.
  function applyLink() {
    const m = /[?&]b=([\w-]+)/.exec(location.hash);
    if (!m) return;
    const res = decodeBuild(m[1], data.ships, partsById);
    if (res) { setShip(res.ship.id); setBuild(res.ship, res.overrides); status = `Opened a shared ${res.ship.name} build.`; }
    else status = 'That link could not be read, so it was ignored.';
    try { history.replaceState(null, '', `${location.pathname}${location.search}#calc`); } catch { /* ignore */ }
  }

  async function show() {
    if (started) { if (data) { applyLink(); paint(); } return; }
    started = true;
    message('Loading ship data…');
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status');
      const json = await res.json();
      if (!json.ready) { started = false; return message('Ship data is still being collected. Check back in a little while.', true); }
      data = json;
      partsById = indexParts(data.parts);
      if (!data.ships.some((x) => x.id === saved.ship)) saved.ship = (data.ships.find((x) => x.name === 'Cutlass Black') || data.ships.find((x) => x.name === 'Gladius') || data.ships[0]).id;
      applyLink();
      paint();
    } catch {
      started = false;
      message('The ship data could not be loaded.', true);
    }
  }

  return { show };
}
