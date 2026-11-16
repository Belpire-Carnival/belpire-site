// "From your game": shows the local data OmniGlass Desktop hands to this page: inside the app directly, or in a normal browser over the
// local link (window.omniglass) once the player has pressed Connect. Read-only: it draws the snapshot and cannot change the app.
// Text nodes only.
import { readLocal, dataLine } from './local-core.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const STATUS = {
  connecting: 'Connecting…',
  waiting: 'Trying again…',
  on: 'Connected to OmniGlass Desktop.',
  failed: 'Could not connect. In OmniGlass Desktop, open Settings and switch on "Website link on this PC". Your browser may also ask whether to let this site reach your PC.',
};

// A Connect / Disconnect button for the browser link, or null when the link is not available (inside the app, or an old page).
function connectRow() {
  const link = window.omniglass;
  if (!link) return null;
  const st = link.status().state;
  const row = el('p', 'small');
  const btn = el('button', null, st === 'off' || st === 'failed' ? 'Connect to OmniGlass Desktop' : 'Disconnect');
  btn.type = 'button';
  btn.addEventListener('click', () => { const now = link.status().state; if (now === 'off' || now === 'failed') link.connect(); else link.disconnect(); });
  row.append(btn);
  if (STATUS[st]) row.append(el('span', 'muted', ' ' + STATUS[st]));
  return row;
}

export function initLocal() {
  const host = document.getElementById('localGame');
  function draw() {
    const app = readLocal(window.__OMNIGLASS__);
    document.documentElement.classList.toggle('in-app', !!app);
    if (!host) return;
    const s = app || readLocal(window.omniglass?.snapshot());
    const tail = () => { if (!app) { const row = connectRow(); if (row) host.append(row); } };
    if (!s) {
      const row = app ? null : connectRow();
      if (!row) { host.replaceChildren(); return; }
      host.replaceChildren(el('h3', null, 'From your game'), el('p', 'small muted', 'OmniGlass Desktop can show your blueprints and recent events here. In its Settings, switch on "Website link on this PC", then connect.'), row);
      return;
    }
    host.replaceChildren(el('h3', null, 'From your game'));
    host.append(el('p', 'small muted', `Live from OmniGlass Desktop on this PC. ${dataLine(s)}.`));
    if (s.pending && !s.blueprints.length && !s.recent.length) { host.append(el('p', 'small muted', 'Waiting for the first events from your game.')); tail(); return; }
    const row = el('div', 'chips');
    row.append(el('span', 'chip', `${s.blueprints.length} blueprint${s.blueprints.length === 1 ? '' : 's'} received`), el('span', 'chip', `${s.ranks} rank${s.ranks === 1 ? '' : 's'} set`));
    host.append(row);
    if (s.blueprints.length) host.append(el('p', 'small', `Received: ${s.blueprints.slice(0, 12).join(', ')}${s.blueprints.length > 12 ? ` and ${s.blueprints.length - 12} more` : ''}`));
    if (s.recent.length) {
      const ul = el('ul', 'small');
      for (const r of s.recent.slice(0, 8)) {
        const t = new Date(r.ts), when = isNaN(t) ? '' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ';
        ul.append(el('li', r.tone, `${when}${r.label}${r.detail ? ' · ' + r.detail : ''}`));
      }
      host.append(ul);
    }
    tail();
  }
  draw();
  window.addEventListener('omniglass-local', draw);
  window.addEventListener('omniglass-bridge', draw);
}
