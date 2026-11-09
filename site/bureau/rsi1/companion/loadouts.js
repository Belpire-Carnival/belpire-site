// Ground-combat loadouts for the Armory: armor, weapons and supplies saved per kind of mission, so a bunker run,
// a Contested Zone push and a boarding job each have a kit you can pull up and copy into Discord.
// Saved in this browser (and to the player's profile when signed in, like everything under "arsenal.*").
// The page is built with text nodes only.

import { attachPicker, cleanImg, thumbStrip } from './items.js';

const KEY = 'arsenal.loadouts';
const MAX = 60;

export const MISSIONS = ['Bunker', 'Contested Zone', 'Mercenary contract', 'Bounty (on foot)', 'Outpost or drug lab', 'Cave or derelict', 'Ship boarding', 'Escort or defence', 'Other'];
export const THREATS = ['Low', 'Medium', 'High'];

// Slot groups, in the order they appear in the form and in the briefing.
export const GROUPS = [
  ['Armor', [['undersuit', 'Undersuit'], ['helmet', 'Helmet'], ['core', 'Core'], ['arms', 'Arms'], ['legs', 'Legs'], ['backpack', 'Backpack']]],
  ['Weapons', [['primary', 'Primary'], ['primaryAttach', 'Primary attachments'], ['secondary', 'Secondary'], ['sidearm', 'Sidearm'], ['sidearmAttach', 'Sidearm attachments'], ['melee', 'Melee or utility']]],
  ['Gadgets', [['gadget1', 'Gadget 1'], ['gadget2', 'Gadget 2'], ['tool', 'Tool']]]
];
// Which kind of item each slot searches for, so Helmet only suggests helmets and Arms only arms.
export const PICK_TYPE = { undersuit: 'undersuit', helmet: 'helmet', core: 'core', arms: 'arms', legs: 'legs', backpack: 'backpack', primary: 'weapon', secondary: 'weapon', sidearm: 'weapon', melee: 'weapon', primaryAttach: 'attach', sidearmAttach: 'attach', gadget1: 'gadget', gadget2: 'gadget', tool: 'gadget' };
// Consumables, with a plain-language label and the amount the briefing flags as "low".
export const SUPPLIES = [['medpens', 'Medpens', 3], ['medgel', 'MedGel', 2], ['oxypens', 'Oxy pens', 1], ['ammoPrimary', 'Primary magazines', 4], ['ammoSidearm', 'Sidearm magazines', 3], ['grenades', 'Grenades', 0]];

const store = {
  read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } },
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

const clean = (v, n = 80) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const count = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 999) : 0; };

// Anything read back from storage is checked and trimmed, so a hand-edited or old entry cannot break the page.
export function normalize(o) {
  const slots = {};
  for (const [, list] of GROUPS) for (const [k] of list) slots[k] = clean(o?.slots?.[k]);
  const imgs = {}, infos = {};
  for (const [, list] of GROUPS) for (const [k] of list) { imgs[k] = slots[k] ? cleanImg(o?.imgs?.[k]) : ''; infos[k] = slots[k] ? clean(o?.infos?.[k], 220) : ''; }
  const supplies = {};
  for (const [k] of SUPPLIES) supplies[k] = count(o?.supplies?.[k]);
  return {
    id: clean(o?.id, 30) || `l${Date.now().toString(36)}`,
    name: clean(o?.name, 50) || 'Untitled loadout',
    mission: MISSIONS.includes(o?.mission) ? o.mission : 'Other',
    threat: THREATS.includes(o?.threat) ? o.threat : 'Medium',
    slots, imgs, infos, supplies,
    notes: String(o?.notes ?? '').slice(0, 600),
    at: Number(o?.at) || Date.now()
  };
}

// What to flag before launching: empty key slots and supplies under the usual amount.
export function gaps(l) {
  const out = [];
  for (const k of ['helmet', 'core', 'primary', 'sidearm']) if (!l.slots[k]) out.push(`${k === 'core' ? 'Core armor' : k[0].toUpperCase() + k.slice(1)} is empty`);
  for (const [k, label, low] of SUPPLIES) if (low && l.supplies[k] < low) out.push(`${label}: ${l.supplies[k]} (usual minimum ${low})`);
  return out;
}

// Text for Discord.
export function briefing(l) {
  const lines = [`**${l.name}** · ${l.mission} · threat ${l.threat}`];
  for (const [group, list] of GROUPS) {
    const rows = list.filter(([k]) => l.slots[k]).map(([k, label]) => `${label}: ${l.slots[k]}${l.infos?.[k] ? ` (${l.infos[k]})` : ''}`);
    if (rows.length) lines.push('', `__${group}__`, ...rows);
  }
  const sup = SUPPLIES.filter(([k]) => l.supplies[k]).map(([k, label]) => `${label} ${l.supplies[k]}`);
  if (sup.length) lines.push('', '__Supplies__', sup.join(' · '));
  if (l.notes.trim()) lines.push('', l.notes.trim());
  return lines.join('\n');
}

export function initLoadouts(host, { toast = () => {}, copy = async () => false } = {}) {
  let list = store.read().map(normalize).slice(0, MAX);
  let editing = null; // the loadout being edited, or null
  let q = '';

  const persist = () => store.write(list);
  const blank = () => normalize({ name: '', mission: 'Bunker', threat: 'Medium' });

  function field(label, input) { return el('label', { class: 'f' }, label, input); }

  function editor() {
    const l = editing;
    const name = el('input', { type: 'text', value: l.name === 'Untitled loadout' ? '' : l.name, placeholder: 'Name, for example Bunker clear, medic', 'aria-label': 'Loadout name', maxlength: '50' });
    const mission = el('select', { 'aria-label': 'Mission type' }, ...MISSIONS.map((m) => el('option', { value: m, text: m })));
    mission.value = l.mission;
    const threat = el('select', { 'aria-label': 'Threat' }, ...THREATS.map((m) => el('option', { value: m, text: m })));
    threat.value = l.threat;
    const inputs = {};
    const groupsEl = GROUPS.map(([group, slots]) => el('div', {}, el('h3', { class: 'mt10', text: group }),
      el('div', { class: 'fields' }, ...slots.map(([k, label]) => {
        inputs[k] = el('input', { type: 'text', value: l.slots[k], maxlength: '80', 'aria-label': label, autocomplete: 'off' });
        let picked = l.slots[k];
        inputs[k].addEventListener('input', () => { if (inputs[k].value !== picked) { l.imgs[k] = ''; l.infos[k] = ''; } });
        const f = field(label, inputs[k]);
        attachPicker(inputs[k], ({ name, img, info }) => { picked = name; l.imgs[k] = img; l.infos[k] = info || ''; }, { type: PICK_TYPE[k] || '' });
        return f;
      }))));
    const sup = {};
    const supEl = el('div', {}, el('h3', { class: 'mt10', text: 'Supplies' }), el('div', { class: 'fields' }, ...SUPPLIES.map(([k, label]) => {
      sup[k] = el('input', { type: 'number', min: '0', max: '999', value: String(l.supplies[k]), 'aria-label': label });
      return field(label, sup[k]);
    })));
    const notes = el('textarea', { rows: '3', maxlength: '600', placeholder: 'Plan, callouts, who carries what', 'aria-label': 'Notes' });
    notes.value = l.notes;
    const read = () => normalize({ ...l, imgs: l.imgs, infos: l.infos, name: name.value, mission: mission.value, threat: threat.value, notes: notes.value,
      slots: Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])), supplies: Object.fromEntries(Object.entries(sup).map(([k, i]) => [k, i.value])) });
    const save = el('button', { type: 'button', class: 'primary', text: 'Save loadout', onclick: () => {
      const next = read();
      next.at = Date.now();
      list = [next, ...list.filter((x) => x.id !== next.id)].slice(0, MAX);
      persist(); editing = null; toast('Loadout saved'); paint();
    } });
    const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { editing = null; paint(); } });
    return el('div', { class: 'card accent' }, el('h3', { text: list.some((x) => x.id === l.id) ? 'Edit loadout' : 'New loadout' }),
      el('div', { class: 'fields' }, field('Name', name), field('Mission', mission), field('Threat', threat)),
      ...groupsEl, supEl, el('div', { class: 'mt10' }, field('Notes', notes)), el('div', { class: 'row mt10' }, save, cancel));
  }

  function item(l) {
    const flags = gaps(l);
    const armor = GROUPS[0][1].filter(([k]) => l.slots[k]).length;
    const guns = ['primary', 'secondary', 'sidearm'].map((k) => l.slots[k]).filter(Boolean);
    return el('div', { class: `lo-item threat-${l.threat.toLowerCase()}` },
      el('div', { class: 'row between' }, el('b', { text: l.name }), el('span', { class: 'row' }, el('span', { class: 'chip', text: l.mission }), el('span', { class: `chip ${l.threat === 'High' ? 'warn' : l.threat === 'Low' ? 'ok' : ''}`.trim(), text: l.threat }))),
      thumbStrip(GROUPS.flatMap(([, list]) => list).filter(([k]) => l.imgs[k]).map(([k, label]) => [label, l.slots[k], l.imgs[k]])),
      ...GROUPS.flatMap(([, list]) => list).filter(([k]) => l.infos[k]).slice(0, 4).map(([k, label]) => el('p', { class: 'small muted m0', text: `${l.slots[k]}: ${l.infos[k]}` })),
      el('p', { class: 'small muted m0', text: `${armor} of 6 armor pieces${guns.length ? ` · ${guns.join(', ')}` : ' · no weapons set'}` }),
      flags.length ? el('p', { class: 'small warn m0', text: flags.slice(0, 3).join(' · ') + (flags.length > 3 ? ` · +${flags.length - 3} more` : '') }) : el('p', { class: 'small ok m0', text: 'Ready to go' }),
      el('div', { class: 'row mt6' },
        el('button', { type: 'button', text: 'Edit', onclick: () => { editing = normalize(l); paint(); } }),
        el('button', { type: 'button', class: 'ghost', text: 'Copy for Discord', onclick: async () => { toast((await copy(briefing(l))) ? 'Copied for Discord' : 'Could not copy'); } }),
        el('button', { type: 'button', class: 'ghost', text: 'Duplicate', onclick: () => { list = [normalize({ ...l, id: '', name: `${l.name} copy`.slice(0, 50), at: Date.now() }), ...list].slice(0, MAX); persist(); paint(); } }),
        (() => {
          const del = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Delete ${l.name}` });
          del.addEventListener('click', () => {
            if (del.dataset.armed) { list = list.filter((x) => x.id !== l.id); persist(); paint(); return; }
            del.dataset.armed = '1'; del.textContent = 'Delete?'; del.className = 'danger';
            setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕'; del.className = 'ghost'; }, 3000);
          });
          return del;
        })()));
  }

  function paint() {
    host.textContent = '';
    if (editing) { host.append(editor()); return; }
    const search = el('select', { 'aria-label': 'Filter by mission' }, el('option', { value: '', text: 'All missions' }), ...MISSIONS.map((m) => el('option', { value: m, text: m })));
    search.value = q;
    search.addEventListener('change', () => { q = search.value; paint(); });
    const shown = list.filter((l) => !q || l.mission === q);
    host.append(el('div', { class: 'card' },
      el('div', { class: 'row between' }, el('h3', { class: 'm0', text: 'Ground loadouts' }), el('span', { class: 'row' }, search, el('button', { type: 'button', class: 'primary', text: 'New loadout', onclick: () => { editing = blank(); paint(); } }))),
      el('p', { class: 'small muted', text: 'Save a kit for each kind of ground mission: armor, weapons, gadgets and supplies. Saved in this browser, and on your profile when you are signed in.' }),
      shown.length ? el('div', { class: 'lo-list' }, ...shown.map(item)) : el('p', { class: 'small muted', text: list.length ? 'No loadouts for that mission yet.' : 'Nothing saved yet. Press New loadout to build your first kit.' })));
  }

  paint();
  return { paint };
}
