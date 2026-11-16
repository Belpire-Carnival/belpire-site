// window.omniglass: the page's link to OmniGlass Desktop on this PC, for people who use the site in a normal browser.
// Nothing connects until the player presses Connect (and then it reconnects on later visits until they press Disconnect).
// Inside the desktop app the snapshot arrives another way, so this stays idle there. The page never gets more than the snapshot,
// and can ask only for a blueprint to be added to or removed from the Watching list.
import { BRIDGE_URL, parseBridge, watchMessage, retryDelay, MAX_RETRIES } from './bridge-core.js';

const KEY = 'og.bridge';

export function initBridge() {
  if (window.__OMNIGLASS__ || window.__OMNIGLASS_OS__) return;
  let ws = null, state = 'off', snap = null, version = '', tries = 0, timer = 0, wanted = false;
  const subs = new Set();
  const pref = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const setPref = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ } };
  const status = () => ({ state, version });
  const emit = () => { for (const f of subs) { try { f(status()); } catch { /* a listener failed */ } } window.dispatchEvent(new Event('omniglass-bridge')); };

  function open() {
    clearTimeout(timer);
    let s;
    try { s = new WebSocket(BRIDGE_URL); } catch { state = 'failed'; emit(); return; }
    ws = s; state = 'connecting'; emit();
    s.onopen = () => { try { s.send(JSON.stringify({ t: 'hello' })); } catch { /* closed already */ } };
    s.onmessage = (e) => {
      if (ws !== s) return;
      const m = parseBridge(e.data);
      if (!m) return;
      if (m.t === 'hello') { state = 'on'; tries = 0; version = m.version; if (m.snapshot) snap = { ...m.snapshot, app: 'omniglass-desktop' }; emit(); }
      else if (m.t === 'snapshot') { if (m.data) snap = { ...m.data, app: 'omniglass-desktop' }; emit(); }
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      if (!wanted) { state = 'off'; emit(); return; }
      if (tries >= MAX_RETRIES) { state = 'failed'; wanted = false; emit(); return; }
      state = 'waiting'; emit();
      timer = setTimeout(open, retryDelay(tries++));
    };
    s.onerror = () => { /* onclose follows and handles it */ };
  }

  window.omniglass = Object.freeze({
    connect() { wanted = true; setPref(true); tries = 0; if (!ws) open(); },
    disconnect() { wanted = false; setPref(false); clearTimeout(timer); const s = ws; ws = null; snap = null; state = 'off'; try { s?.close(); } catch { /* already closed */ } emit(); },
    status,
    snapshot: () => snap,
    watch(op, key) { const m = watchMessage(op, key); if (!m || !ws || state !== 'on') return false; try { ws.send(m); return true; } catch { return false; } },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  });

  if (pref()) { wanted = true; open(); }
}
