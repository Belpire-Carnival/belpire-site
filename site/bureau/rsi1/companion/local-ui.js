// "From your game": shows the local data OmniGlass Desktop hands to this page, only when the page runs inside that app.
// Read-only: it listens for the app's snapshot and draws it. It makes no requests and cannot call the app. Text nodes only.
import { readLocal, dataLine } from './local-core.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function initLocal() {
  const host = document.getElementById('localGame');
  function draw() {
    const s = readLocal(window.__OMNIGLASS__);
    document.documentElement.classList.toggle('in-app', !!s);
    if (!s || !host) return;
    host.replaceChildren(el('h3', null, 'From your game'));
    host.append(el('p', 'small muted', `Live from OmniGlass Desktop on this PC. ${dataLine(s)}.`));
    if (s.pending && !s.blueprints.length && !s.recent.length) { host.append(el('p', 'small muted', 'Waiting for the first events from your game.')); return; }
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
  }
  draw();
  window.addEventListener('omniglass-local', draw);
}
