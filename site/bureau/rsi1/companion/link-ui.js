// The "OmniGlass Desktop" card on the Blueprints pane: make a pairing code, see and revoke linked devices, and apply what the
// desktop app has sent (blueprints become owned blueprints; the rest shows in a short feed). Text nodes only.
// The page stays the only writer of your saved data: events wait in an inbox until this page applies them and acknowledges.
import { applyInbox, ago } from './link-core.js';

const API_DEVICES = '/api/companion/devices';
const API_PAIR_NEW = '/api/companion/pair/new';
const API_INBOX = '/api/companion/inbox';
const API_ACK = '/api/companion/inbox/ack';

const K_BP = 'arsenal.plan.bp';
const K_FEED = 'arsenal.link.feed';
const POLL_MS = 30000;
const CODE_POLL_MS = 3000;

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

export function initLink(host, { toast = () => {} } = {}) {
  if (!host) return null;
  let devices = [], code = null, codeTimer = 0, codePoll = 0, signedIn = null, busy = false, armed = '';

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });

  function stopCode() { clearInterval(codeTimer); clearInterval(codePoll); codeTimer = codePoll = 0; code = null; }

  function draw() {
    host.replaceChildren();
    if (signedIn === false) {
      host.append(el('p', { class: 'small muted', text: 'Sign in with Discord (bottom of the page) to link the OmniGlass Desktop app. It reads your Game.log on your PC and sends your blueprints here.' }));
      return;
    }
    if (signedIn === null) { host.append(el('p', { class: 'small muted', text: 'Checking…' })); return; }

    const make = el('button', { type: 'button', class: 'primary', text: code ? 'New code' : 'Link a device', onclick: makeCode });
    host.append(el('div', { class: 'row' }, make));
    if (code) {
      const left = el('span', { class: 'small muted' });
      const tick = () => {
        const s = Math.max(0, Math.round((code.until - Date.now()) / 1000));
        left.textContent = s ? ` Valid for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.` : ' This code has expired. Make a new one.';
        if (!s) stopCode();
      };
      host.append(el('div', { class: 'note info mt8' },
        el('div', { class: 'small', text: 'In OmniGlass Desktop, choose “Link to my profile” and type:' }),
        el('div', { class: 'row' },
          el('b', { class: 'linkcode', text: code.text, title: 'Click to select', onclick: (e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }),
          el('button', { type: 'button', class: 'ghost', text: 'Copy', onclick: async (e) => {
            const b = e.currentTarget;
            try { await navigator.clipboard.writeText(code.text); b.textContent = 'Copied'; }
            catch { b.textContent = 'Select and press Ctrl+C'; }
            setTimeout(() => { b.textContent = 'Copy'; }, 2000);
          } })),
        left));
      tick();
      clearInterval(codeTimer);
      if (code) codeTimer = setInterval(tick, 1000);
    }
    if (!devices.length) {
      host.append(el('p', { class: 'small muted mt8', text: 'No devices linked yet.' }));
    } else {
      const tb = el('tbody');
      for (const d of devices) {
        const rm = el('button', { type: 'button', class: armed === d.id ? 'danger' : 'ghost', text: armed === d.id ? 'Really unlink?' : 'Unlink', 'aria-label': `Unlink ${d.name}`, onclick: () => revoke(d) });
        tb.append(el('tr', {}, el('td', {}, el('b', { text: d.name })), el('td', { text: `seen ${ago(d.lastSeen)}` }), el('td', { text: d.waiting ? `${d.waiting} waiting` : '' }), el('td', {}, rm)));
      }
      host.append(el('div', { class: 'scrollx mt8' }, el('table', {}, tb)));
    }
    const feed = read(K_FEED, []);
    if (Array.isArray(feed) && feed.length) {
      host.append(el('h4', { class: 'mt12', text: 'Recent from the game' }),
        el('ul', { class: 'small' }, ...feed.slice(0, 12).map((f) => el('li', { text: `${f.text} · ${ago(f.at)}` }))));
    }
  }

  async function loadDevices() {
    let r;
    try { r = await fetch(API_DEVICES); } catch { return false; }
    if (r.status === 503) { (host.closest('.card') || host).hidden = true; return false; }
    if (r.status === 401) { signedIn = false; devices = []; draw(); return false; }
    if (!r.ok) return false;
    const body = await r.json().catch(() => ({}));
    signedIn = true;
    devices = Array.isArray(body.devices) ? body.devices : [];
    draw();
    return true;
  }

  async function makeCode() {
    stopCode();
    let r;
    try { r = await post(API_PAIR_NEW); } catch { toast('Could not reach the server'); return; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { toast(body.error === 'too_many_devices' ? 'You have 8 devices linked. Unlink one first.' : body.error === 'too_many_codes' ? 'Too many codes waiting. Try again in a few minutes.' : 'Could not make a code'); return; }
    code = { text: String(body.code || ''), until: Date.now() + Number(body.expiresIn || 600) * 1000 };
    const before = devices.length;
    draw();
    // While the code is showing, notice the moment the app uses it.
    codePoll = setInterval(async () => {
      if (!code) return;
      await loadDevices();
      if (devices.length > before) { stopCode(); draw(); toast('Device linked'); pull(); }
    }, CODE_POLL_MS);
  }

  async function revoke(d) {
    if (armed !== d.id) { armed = d.id; draw(); setTimeout(() => { if (armed === d.id) { armed = ''; draw(); } }, 3000); return; }
    armed = '';
    try {
      const r = await fetch(`${API_DEVICES}?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      toast('Device unlinked');
    } catch { toast('Could not unlink. Try again.'); }
    loadDevices();
  }

  // Take what the app has sent, apply it, then acknowledge. Applying twice is harmless, so a failed acknowledge only repeats it.
  async function pull() {
    if (busy || signedIn !== true || document.hidden) return;
    busy = true;
    try {
      const r = await fetch(API_INBOX);
      if (!r.ok) return;
      const { events } = await r.json();
      if (!Array.isArray(events) || !events.length) return;
      const res = applyInbox(events, read(K_BP, null), read(K_FEED, []));
      write(K_BP, res.bp); write(K_FEED, res.feed);
      window.dispatchEvent(new CustomEvent('arsenal:plan'));
      if (res.keys.length) await post(API_ACK, { keys: res.keys });
      if (res.added) toast(`${res.added} blueprint${res.added === 1 ? '' : 's'} added from the game`);
      draw();
    } catch { /* offline: try again next time */ } finally { busy = false; }
  }

  draw();
  loadDevices().then((ok) => { if (ok) pull(); });
  setInterval(() => { if (!document.hidden) pull(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  return { refresh: () => loadDevices().then(pull) };
}
