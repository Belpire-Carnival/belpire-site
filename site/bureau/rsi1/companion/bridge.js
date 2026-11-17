// window.omniglass: the page's link to OmniGlass Desktop on this PC, for people who use the site in a normal browser.
// Nothing connects until the player presses Connect and gives the pairing code shown in the app (first time only: the app then hands back a
// token that this browser keeps, and a new code in the app cancels it). Inside the desktop app the snapshot arrives another way, so this stays idle there.
// The page never gets more than the snapshot, and can ask only for a blueprint to be added to or removed from the Watching list.
import { BRIDGE_URL, parseBridge, watchMessage, helloMessage, normCode, normToken, retryDelay, MAX_RETRIES } from './bridge-core.js';

const KEY = 'og.bridge', TOKEN = 'og.bridge.token';

export function initBridge() {
  if (window.__OMNIGLASS__ || window.__OMNIGLASS_OS__) return;
  let ws = null, state = 'off', snap = null, version = '', tries = 0, timer = 0, wanted = false, code = null;
  const subs = new Set();
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };
  const token = () => normToken(read(TOKEN));
  const status = () => ({ state, version, paired: !!token() });
  const emit = () => { for (const f of subs) { try { f(status()); } catch { /* a listener failed */ } } window.dispatchEvent(new Event('omniglass-bridge')); };
  const stop = (why) => { wanted = false; write(KEY, '0'); clearTimeout(timer); state = why; emit(); };

  function open() {
    clearTimeout(timer);
    let s;
    try { s = new WebSocket(BRIDGE_URL); } catch { state = 'failed'; emit(); return; }
    ws = s; state = 'connecting'; emit();
    s.onopen = () => { const hello = helloMessage({ token: token(), code }); code = null; if (!hello) { ws = null; try { s.close(); } catch { /* closed already */ } stop('needcode'); return; } try { s.send(hello); } catch { /* closed already */ } };
    s.onmessage = (e) => {
      if (ws !== s) return;
      const m = parseBridge(e.data);
      if (!m) return;
      if (m.t === 'auth') {
        if (m.ok) { if (m.token) write(TOKEN, m.token); return; }
        write(TOKEN, null); ws = null; try { s.close(); } catch { /* closed already */ } stop(m.locked ? 'locked' : 'denied'); return; // a wrong code is not retried
      }
      if (m.t === 'hello') { state = 'on'; tries = 0; version = m.version; if (m.snapshot) snap = { ...m.snapshot, app: 'omniglass-desktop' }; emit(); }
      else if (m.t === 'snapshot') { if (m.data) snap = { ...m.data, app: 'omniglass-desktop' }; emit(); }
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      if (!wanted) { state = 'off'; emit(); return; }
      if (tries >= MAX_RETRIES) { stop('failed'); return; }
      state = 'waiting'; emit();
      timer = setTimeout(open, retryDelay(tries++));
    };
    s.onerror = () => { /* onclose follows and handles it */ };
  }

  window.omniglass = Object.freeze({
    /** Connect. The first time (no saved token) the pairing code from the app is needed. */
    connect(typed) {
      code = normCode(typed);
      if (!token() && !code) { state = typed ? 'denied' : 'needcode'; emit(); return false; }
      wanted = true; write(KEY, '1'); tries = 0; if (!ws) open(); return true;
    },
    disconnect() { wanted = false; write(KEY, '0'); clearTimeout(timer); const s = ws; ws = null; snap = null; code = null; state = 'off'; try { s?.close(); } catch { /* already closed */ } emit(); },
    /** Forget the pairing in this browser too. */
    unpair() { this.disconnect(); write(TOKEN, null); emit(); },
    status,
    snapshot: () => snap,
    watch(op, key) { const m = watchMessage(op, key); if (!m || !ws || state !== 'on') return false; try { ws.send(m); return true; } catch { return false; } },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  });

  if (read(KEY) === '1') { if (token()) { wanted = true; open(); } else { write(KEY, '0'); state = 'needcode'; } }
}
