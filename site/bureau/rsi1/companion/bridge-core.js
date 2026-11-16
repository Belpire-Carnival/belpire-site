// The local link to OmniGlass Desktop: fixed address, message checks and retry timing. Pure functions, so they can be tested.
// The address never changes and is never taken from the page or from the app: the desktop app listens on this PC only.
export const BRIDGE_URL = 'ws://127.0.0.1:47831/omniglass';
export const MAX_MESSAGE = 600000;
export const MAX_RETRIES = 3;
export const retryDelay = (n) => Math.min(30000, 1000 * 2 ** n);

const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** One message from the app, checked. Returns null for anything that is not one of the four kinds the app sends. */
export function parseBridge(text) {
  if (typeof text !== 'string' || text.length > MAX_MESSAGE) return null;
  let m; try { m = JSON.parse(text); } catch { return null; }
  if (!plain(m)) return null;
  if (m.t === 'hello') return { t: 'hello', version: typeof m.version === 'string' ? m.version.slice(0, 20) : '', snapshot: plain(m.snapshot) };
  if (m.t === 'snapshot') return { t: 'snapshot', data: plain(m.data) };
  if (m.t === 'ack') return { t: 'ack', ok: m.ok === true };
  if (m.t === 'error') return { t: 'error', error: typeof m.error === 'string' ? m.error.slice(0, 80) : '' };
  return null;
}

/** The one thing the page may ask the app to do: add a blueprint to, or remove it from, the Watching list. The key is the blueprint name in lowercase letters and digits. */
export function watchMessage(op, key) {
  if (op !== 'add' && op !== 'remove') return null;
  const k = String(key ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!k || k.length > 100) return null;
  return JSON.stringify({ t: 'watch', op, key: k });
}
