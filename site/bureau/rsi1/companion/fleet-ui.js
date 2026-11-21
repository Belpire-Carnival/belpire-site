// Fleet manager pane (Hangar hub). Text nodes only. Ships come from the Hangar (arsenal.fleet); the plan for each ship
// (role, status, crew, saved builds) lives under arsenal.fleet.plan and the group fleet under arsenal.fleet.group, which the
// companion profile sync carries between devices. The maths is in fleet-core.js.
import { ROLES, STATUSES, MAX_CREW, MAX_BUILDS, cleanPlan, planFor, setRole, setStatus, setNote, addCrew, removeCrew, addBuild, removeBuild, setActiveBuild,
  pruneFor, overview, groupOverview, encodeFleet, decodeFleet, mergeMember, removeMember, cleanGroup, totals, parseBuildCode } from './fleet-core.js';
import { photo } from './art.js';

const K_FLEET = 'arsenal.fleet', K_PLAN = 'arsenal.fleet.plan', K_GROUP = 'arsenal.fleet.group', K_WHO = 'arsenal.fleet.who';
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
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const kpi = (label, value) => el('div', { class: 'kpi' }, el('div', { class: 'lbl', text: label }), el('div', { class: 'val', text: value }));
const fleetList = () => (Array.isArray(read(K_FLEET, [])) ? read(K_FLEET, []) : []).filter((s) => s && typeof s.name === 'string');

export function initFleetManager(host, { toast = () => {}, copy = async () => false } = {}) {
  if (!host) return null;
  const plan = () => pruneFor(read(K_PLAN, {}), fleetList());
  const savePlan = (p) => { write(K_PLAN, p); draw(); };
  const group = () => cleanGroup(read(K_GROUP, []));
  const saveGroup = (g) => { write(K_GROUP, g); draw(); };

  const summary = el('div', { class: 'kpis' });
  const ships = el('div', { class: 'fm-ships mt12' });
  const grp = el('div', { class: 'mt12' });
  host.append(el('div', { class: 'card' }, el('h3', { text: 'Fleet overview' }), summary),
    el('h3', { class: 'mt12', text: 'Your ships' }), ships,
    el('div', { class: 'card mt12' }, el('h3', { text: 'Group fleet' }), grp));

  function shipCard(s, p) {
    const role = el('select', { 'aria-label': `${s.name} role` }, el('option', { value: '', text: 'No role' }), ...ROLES.map((r) => el('option', { value: r, text: r })));
    role.value = p.role; role.addEventListener('change', () => savePlan(setRole(plan(), s.name, role.value)));
    const status = el('select', { 'aria-label': `${s.name} status` }, ...STATUSES.map((t) => el('option', { value: t, text: t })));
    status.value = p.status; status.addEventListener('change', () => savePlan(setStatus(plan(), s.name, status.value)));

    // crew
    const crew = el('ul', { class: 'fm-list' });
    p.crew.forEach((c, i) => crew.append(el('li', {}, el('b', { text: c.name }), c.seat ? el('span', { class: 'muted small', text: ` · ${c.seat}` }) : null,
      el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove ${c.name} from ${s.name}`, onclick: () => savePlan(removeCrew(plan(), s.name, i)) }))));
    if (!p.crew.length) crew.append(el('li', { class: 'muted small', text: 'No crew assigned.' }));
    const cn = el('input', { type: 'text', maxlength: '40', placeholder: 'Player', 'aria-label': `Crew member for ${s.name}` });
    const cs = el('input', { type: 'text', maxlength: '30', placeholder: 'Seat (pilot, gunner...)', 'aria-label': `Seat for ${s.name}` });
    const ca = el('button', { type: 'button', class: 'ghost', text: 'Add crew', onclick: () => {
      if (p.crew.length >= MAX_CREW) { toast(`Up to ${MAX_CREW} crew per ship`); return; }
      if (!cn.value.trim()) { toast('Type a player name'); return; }
      savePlan(addCrew(plan(), s.name, cn.value, cs.value.trim()));
    } });

    // saved builds
    const builds = el('ul', { class: 'fm-list' });
    p.builds.forEach((b, i) => builds.append(el('li', {}, i === p.active ? el('span', { class: 'chip ok', text: 'ACTIVE' }) : null, ' ', el('b', { text: b.label }), ' ',
      el('a', { class: 'btnlink', href: `#calc?b=${b.code}`, text: 'Open' }),
      i === p.active ? null : el('button', { type: 'button', class: 'ghost', text: 'Make active', onclick: () => savePlan(setActiveBuild(plan(), s.name, i)) }),
      el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove build ${b.label}`, onclick: () => savePlan(removeBuild(plan(), s.name, i)) }))));
    if (s.code && !p.builds.some((b) => b.code === s.code)) builds.append(el('li', { class: 'small muted' }, 'Hangar build: ', el('a', { class: 'btnlink', href: `#calc?b=${s.code}`, text: 'Open' })));
    if (!p.builds.length && !s.code) builds.append(el('li', { class: 'muted small', text: 'No saved builds. Build one in the Avionics Lab and paste its link or code below.' }));
    const bl = el('input', { type: 'text', maxlength: '40', placeholder: 'Label (PvP, Bounty...)', 'aria-label': `Build label for ${s.name}` });
    const bc = el('input', { type: 'text', maxlength: '3200', placeholder: 'Paste a build link or code', 'aria-label': `Build code for ${s.name}` });
    const ba = el('button', { type: 'button', class: 'ghost', text: 'Save build', onclick: () => {
      if (!parseBuildCode(bc.value)) { toast('That is not a build link or code'); return; }
      if (p.builds.length >= MAX_BUILDS && !p.builds.some((b) => b.code === parseBuildCode(bc.value))) { toast(`Up to ${MAX_BUILDS} builds per ship`); return; }
      savePlan(addBuild(plan(), s.name, bl.value, bc.value));
    } });

    const note = el('input', { type: 'text', maxlength: '200', placeholder: 'Note', 'aria-label': `Note for ${s.name}` }); note.value = p.note;
    note.addEventListener('change', () => savePlan(setNote(plan(), s.name, note.value)));

    const fig = totals([s]);
    const pic = photo(s.img, '', el('span', { class: 'photo thumb none' }), 'photo thumb');
    return el('div', { class: `card fm-ship${p.status === 'Stored' ? ' fm-stored' : ''}` },
      el('div', { class: 'row' }, pic, el('div', {}, el('b', { text: s.name }), el('div', { class: 'small muted', text: [fig.cargo ? `${fmt(fig.cargo)} SCU` : '', fig.dps ? `${fmt(fig.dps)} DPS` : '', fig.hull ? `${fmt(fig.hull)} hull` : ''].filter(Boolean).join(' · ') || 'No stat sheet; save it from the Avionics Lab for figures.' }))),
      el('div', { class: 'row mt8' }, role, status),
      el('h4', { class: 'fm-h', text: `Crew (${p.crew.length})` }), crew, el('div', { class: 'row' }, cn, cs, ca),
      el('h4', { class: 'fm-h', text: 'Saved builds' }), builds, el('div', { class: 'row' }, bl, bc, ba),
      el('div', { class: 'mt8' }, note));
  }

  function drawGroup(ov) {
    grp.replaceChildren();
    const who = el('input', { type: 'text', maxlength: '40', placeholder: 'Your name or handle', 'aria-label': 'Your name for the group fleet' }); who.value = read(K_WHO, '') || '';
    who.addEventListener('change', () => write(K_WHO, who.value.trim().slice(0, 40)));
    const mine = el('button', { type: 'button', class: 'ghost', text: 'Copy my fleet code', onclick: async () => {
      const name = who.value.trim(); if (!name) { toast('Type your name first'); return; }
      write(K_WHO, name.slice(0, 40));
      const code = encodeFleet(fleetList(), plan(), name);
      toast((code && await copy(code)) ? 'Fleet code copied. Send it to your group.' : 'Could not copy');
    } });
    const paste = el('input', { type: 'text', maxlength: '24100', placeholder: 'Paste a teammate’s fleet code', 'aria-label': 'Fleet code from a teammate' });
    const imp = el('button', { type: 'button', class: 'primary', text: 'Add to group', onclick: () => {
      const m = decodeFleet(paste.value); if (!m) { toast('That is not a fleet code'); return; }
      saveGroup(mergeMember(group(), m)); toast(`Added ${m.who}`);
    } });
    grp.append(el('p', { class: 'small muted', text: 'Everyone copies their own fleet code and sends it to the group. Paste the codes here to see what your whole group flies. Codes carry ship names, roles and figures only, never crew names, notes or pictures. Re-adding a name replaces their older list. This stays in your browser; there is no shared server fleet yet.' }),
      el('div', { class: 'row' }, who, mine), el('div', { class: 'row mt8' }, paste, imp));
    const members = group();
    const mineData = who.value.trim() ? { who: who.value.trim(), ships: fleetList().map((s) => ({ name: s.name, role: planFor(plan(), s.name).role, stats: s.stats })) } : null;
    const g = groupOverview(members, mineData);
    if (!members.length) { grp.append(el('p', { class: 'small muted mt12', text: 'No teammates added yet.' })); return; }
    grp.append(el('div', { class: 'kpis mt12' }, kpi('Members', String(g.members)), kpi('Ships', String(g.ships)), kpi('Cargo SCU', fmt(g.cargo)), kpi('DPS', fmt(g.dps)), kpi('Crew seats', fmt(g.crewMax))));
    grp.append(el('p', { class: 'small mt8', text: 'By role: ' + (Object.entries(g.byRole).map(([r, n]) => `${r} ${n}`).join(' · ') || 'none') }));
    const tb = el('tbody');
    for (const m of members) {
      const t = totals(m.ships);
      tb.append(el('tr', {}, el('td', {}, el('b', { text: m.who })), el('td', { class: 'num', text: String(t.ships) }), el('td', { class: 'num', text: fmt(t.cargo) }), el('td', { class: 'num', text: fmt(t.dps) }),
        el('td', { class: 'small muted', text: m.ships.map((s) => s.name).join(', ') }),
        el('td', {}, el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Remove ${m.who}`, onclick: () => saveGroup(removeMember(group(), m.who)) }))));
    }
    grp.append(el('div', { class: 'scrollx mt8' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Member', 'Ships', 'SCU', 'DPS', 'Fleet', ''].map((h, i) => el('th', { class: i && i < 4 ? 'num' : '', text: h })))), tb)));
  }

  function draw() {
    const list = fleetList(), p = plan(), ov = overview(list, p);
    summary.replaceChildren(kpi('Ships', String(ov.ships)), kpi('Active', String(ov.byStatus.Active)), kpi('Standby', String(ov.byStatus.Standby)), kpi('Stored', String(ov.byStatus.Stored)),
      kpi('Cargo SCU', fmt(ov.cargo)), kpi('DPS', fmt(ov.dps)), kpi('Hull + shield', fmt(ov.hull + ov.shield)), kpi('Crew assigned', `${ov.crewAssigned}${ov.crewMax ? ' / ' + fmt(ov.crewMax) : ''}`));
    const roles = Object.entries(ov.byRole);
    summary.parentNode.querySelectorAll('.fm-note').forEach((n) => n.remove());
    summary.after(el('p', { class: 'small muted fm-note mt8', text: [roles.length ? 'By role: ' + roles.map(([r, n]) => `${r} ${n.length}`).join(' · ') : 'Give each ship a role to see the split', ov.unassigned ? `${ov.unassigned} with no role` : '', ov.noCrew.length ? `Active with no crew: ${ov.noCrew.join(', ')}` : ''].filter(Boolean).join('. ') + '.' }));
    ships.replaceChildren();
    if (!list.length) ships.append(el('p', { class: 'small muted', text: 'No ships yet. Add ships in Hangar Command, or save a build from the Avionics Lab, then manage them here.' }));
    for (const s of list) ships.append(shipCard(s, planFor(p, s.name)));
    drawGroup(ov);
  }
  draw();
  return { draw };
}
