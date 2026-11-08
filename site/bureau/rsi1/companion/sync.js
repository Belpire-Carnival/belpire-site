// Sign in with Discord and keep the companion's saved data on your profile.
// Signed out, nothing changes: everything stays in this browser. Signed in, everything the companion keeps in this
// browser (the "arsenal.*" entries) is saved to your profile as you work and loaded on any device you sign in on.
// Newest save wins; an older device is never allowed to overwrite a newer save without being told.

const API = '/api/companion/profile';
const KEY = /^arsenal\.(?!__)[A-Za-z0-9._-]{1,40}$/;
const META = 'arsenal.__sync'; // this device's bookkeeping; never uploaded
const PUSH_AFTER_MS = 3000;
const POLL_MS = 2000;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage full or blocked */ } };

// Canonical text for a set of entries, so two copies can be compared with ===.
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

export function snapshot() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (KEY.test(k)) out[k] = localStorage.getItem(k);
    }
  } catch { /* storage blocked */ }
  return out;
}

function readMeta() {
  try {
    const m = JSON.parse(read(META) || '{}');
    return { uid: typeof m.uid === 'string' ? m.uid : '', base: Number(m.base) || 0, synced: typeof m.synced === 'string' ? m.synced : '', changedAt: Number(m.changedAt) || 0 };
  } catch { return { uid: '', base: 0, synced: '', changedAt: 0 }; }
}

const MESSAGES = {
  ok: 'Signed in.',
  cancelled: 'Sign-in cancelled.',
  expired: 'That sign-in link expired. Try again.',
  error: 'Discord sign-in failed. Try again in a minute.',
  setup: 'Sign-in is not switched on yet.',
};

export function initSync(host) {
  if (!host) return;
  const meta = readMeta();
  const saveMeta = () => write(META, JSON.stringify(meta));
  let busy = false, lastSeen = canon(snapshot()), user = null;

  const status = document.createElement('span'); status.className = 'small muted'; status.setAttribute('role', 'status');
  const render = (...parts) => { host.textContent = ''; host.append(...parts.filter(Boolean)); };
  const btn = (text, fn, cls = 'ghost') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; };
  const say = (t) => { status.textContent = t; };

  function paintOut(note) {
    const a = document.createElement('a'); a.className = 'btn-link'; a.href = '/auth/login'; a.textContent = 'Sign in with Discord';
    const s = document.createElement('span'); s.className = 'small muted'; s.textContent = note || 'Save your runs, contracts and fleet to a profile.';
    render(a, s);
  }
  function paintIn() {
    const who = document.createElement('b'); who.textContent = user;
    let armed = false;
    const del = btn('Delete saved data', async () => {
      if (!armed) { armed = true; del.textContent = 'Really delete?'; del.className = 'danger'; setTimeout(() => { armed = false; del.textContent = 'Delete saved data'; del.className = 'ghost'; }, 3000); return; }
      try {
        const r = await fetch(API, { method: 'DELETE' });
        if (!r.ok) throw new Error();
        // Nothing to upload until the next change here; this browser keeps its data.
        meta.base = 0; meta.synced = canon(snapshot()); saveMeta(); say('Saved copy deleted. This browser keeps its data.');
      } catch { say('Could not delete. Try again.'); }
      armed = false; del.textContent = 'Delete saved data'; del.className = 'ghost';
    });
    const out = btn('Sign out', async () => {
      await push();
      // A fully saved copy is removed from this browser so the next person on it starts clean; sign in to load it again.
      if (meta.base > 0 && canon(snapshot()) === meta.synced) for (const k of Object.keys(snapshot())) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
      meta.uid = ''; meta.base = 0; meta.synced = ''; saveMeta();
      try { await fetch('/auth/logout', { method: 'POST' }); } catch { /* the cookie lasts 30 days at most */ }
      location.reload();
    });
    render(document.createTextNode('Signed in as '), who, status, out, del);
  }

  function applyServer(serverData, updatedAt) {
    const keep = serverData || {};
    for (const k of Object.keys(snapshot())) if (!(k in keep)) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    for (const [k, v] of Object.entries(keep)) if (KEY.test(k) && typeof v === 'string') write(k, v);
    meta.base = updatedAt; meta.synced = canon(snapshot()); meta.changedAt = updatedAt; saveMeta();
    location.reload(); // the page reads its saved data at start-up
  }

  async function push(keepalive = false) {
    if (busy || !user) return;
    const snap = snapshot(), text = canon(snap);
    if (text === meta.synced) return;
    busy = true;
    try {
      const r = await fetch(API, { method: 'PUT', keepalive, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: snap, base: meta.base }) });
      const body = await r.json().catch(() => ({}));
      if (r.ok) { meta.base = body.updatedAt; meta.synced = text; saveMeta(); say(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`); }
      else if (r.status === 409) {
        // Another device saved since this one last looked. Newest wins.
        if (meta.changedAt > body.updatedAt) { meta.base = body.updatedAt; saveMeta(); busy = false; return push(); }
        applyServer(body.data, body.updatedAt);
      } else if (r.status === 413) say('Too much data to save to your profile. Clear old runs in the Ops Log.');
      else say('Could not save just now. Will retry.');
    } catch { say('Offline: will save when you are back.'); }
    busy = false;
  }

  function watch() {
    setInterval(() => {
      const text = canon(snapshot());
      if (text !== lastSeen) { lastSeen = text; meta.changedAt = Date.now(); saveMeta(); }
      if (text !== meta.synced && Date.now() - meta.changedAt >= PUSH_AFTER_MS) push();
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.hidden) push(true); });
    window.addEventListener('pagehide', () => push(true));
  }

  // First sign-in on a browser that already has data, and the profile has different data: never guess.
  function askFirstTime(p) {
    const msg = document.createElement('span'); msg.className = 'small';
    msg.textContent = 'This browser and your saved profile both have data. Which one do you want to keep?';
    const useSaved = btn('Use saved profile', () => applyServer(p.data, p.updatedAt), 'primary');
    const useHere = btn('Keep this browser’s data', async () => { meta.base = p.updatedAt; saveMeta(); paintIn(); await push(); watch(); });
    render(msg, useSaved, useHere);
  }

  async function start() {
    const q = new URLSearchParams(location.search);
    const note = q.get('signin');
    if (note) { history.replaceState(null, '', location.pathname + location.hash); }
    let res;
    try { res = await fetch(API); } catch { paintOut('Could not reach sign-in. Everything still saves in this browser.'); return; }
    if (res.status === 503) { host.hidden = true; return; }
    if (res.status === 401) { paintOut(MESSAGES[note] && note !== 'ok' ? MESSAGES[note] : null); return; }
    if (!res.ok) { paintOut('Sign-in is unavailable right now.'); return; }
    const p = await res.json();
    user = String(p.name || 'pilot').slice(0, 64);
    // Another person's bookkeeping must never carry over to this account.
    if (meta.uid !== p.uid) { meta.uid = p.uid; meta.base = 0; meta.synced = ''; meta.changedAt = 0; saveMeta(); }
    paintIn();
    const local = snapshot(), localText = canon(local), hasLocal = Object.keys(local).length > 0;
    if (!p.saved) { if (hasLocal) { meta.changedAt = meta.changedAt || Date.now(); await push(); } }
    else {
      const serverText = canon(p.data || {});
      if (serverText === localText) { meta.base = p.updatedAt; meta.synced = localText; saveMeta(); say('Saved copy matches this browser.'); }
      else if (!hasLocal || meta.synced === localText) applyServer(p.data, p.updatedAt);
      else if (meta.base === 0) { askFirstTime(p); return; }
      else if (p.updatedAt === meta.base) await push();
      else if (meta.changedAt > p.updatedAt) { meta.base = p.updatedAt; saveMeta(); await push(); }
      else applyServer(p.data, p.updatedAt);
    }
    watch();
  }
  start();
}
