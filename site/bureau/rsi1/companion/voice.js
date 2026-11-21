// Voice navigation: say a module name and the companion opens it, with the
// ">> command." caption strip. Uses the browser's own speech recognition, so
// audio is handled by the browser; nothing is sent to this site.
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

// phrase fragments -> view id. First match wins, so keep specific phrases first.
export const COMMANDS = [
  [['ops', 'operations', 'home', 'dashboard', 'omniops'], 'ops'],
  [['contract', 'mission', 'job', 'tacboard', 'bounty'], 'contracts'],
  [['log', 'history', 'omnilog', 'runs'], 'log'],
  [['salvage', 'scrap', 'slag'], 'salvage'],
  [['mining', 'mine', 'extraction'], 'mining'],
  [['trade', 'route', 'hauling', 'commodity', 'omniroute'], 'trade'],
  [['cargo', 'grid', 'container', 'gridmaster'], 'cargo'],
  [['calculator', 'avionics', 'ship build', 'builder', 'loadout builder'], 'calc'],
  [['combat', 'ballistics', 'weapon', 'armor', 'armory'], 'combat'],
  [['fleet', 'hangar', 'ships'], 'fleet'],
  [['manual', 'help', 'guide', 'field manual'], 'manual'],
];

export function parse(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\b(close|hide|dismiss) (the )?menu\b/.test(t)) return { type: 'menu', open: false };
  if (/\b(open|show|display) (the )?menu\b|\bmenu\b/.test(t)) return { type: 'menu', open: true };
  if (/\b(scroll|page) up\b/.test(t)) return { type: 'scroll', dir: -1 };
  if (/\b(scroll|page) down\b/.test(t)) return { type: 'scroll', dir: 1 };
  if (/\b(top|go back up)\b/.test(t)) return { type: 'scroll', dir: -2 };
  for (const [words, id] of COMMANDS) if (words.some((w) => t.includes(w))) return { type: 'view', id };
  return null;
}

export function initVoice({ labels, go, menu, toast }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = el('button', { type: 'button', id: 'voiceBtn', class: 'voicebtn', 'aria-pressed': 'false', 'aria-label': 'Voice commands' }, el('span', { class: 'vdot' }), el('span', { class: 'vtxt', text: 'VOICE' }));
  const cap = el('div', { id: 'voiceCap', class: 'voicecap', role: 'status', 'aria-live': 'polite', hidden: '' });
  document.body.append(btn, cap);
  if (!SR) { btn.disabled = true; btn.title = 'This browser has no speech recognition (try Chrome or Edge)'; btn.querySelector('.vtxt').textContent = 'NO VOICE'; return; }
  let rec = null, on = false, capT;
  const say = (msg, bad) => { cap.hidden = false; cap.classList.toggle('bad', !!bad); cap.textContent = '>> ' + msg; clearTimeout(capT); capT = setTimeout(() => { cap.hidden = true; }, 3200); };
  function run(text) {
    const c = parse(text);
    if (!c) return say('Say a module name, e.g. “missions” or “fleet”.', true);
    if (c.type === 'view') { say(labels[c.id] ? `Opening ${labels[c.id]}.` : 'Opening.'); go(c.id); }
    else if (c.type === 'menu') { say(c.open ? 'Opening menu.' : 'Closing menu.'); menu(c.open); }
    else { say(c.dir === -2 ? 'Top.' : c.dir < 0 ? 'Scrolling up.' : 'Scrolling down.'); window.scrollTo({ top: c.dir === -2 ? 0 : window.scrollY + c.dir * Math.round(window.innerHeight * 0.8), behavior: 'smooth' }); }
  }
  function start() {
    rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; if (r.isFinal) run(r[0].transcript); };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; paint(); toast('Microphone blocked: allow it for this site to use voice'); } };
    rec.onend = () => { if (on) { try { rec.start(); } catch { /* already running */ } } };
    try { rec.start(); } catch { /* ignore */ }
  }
  function paint() { btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('live', on); btn.querySelector('.vtxt').textContent = on ? 'LISTENING' : 'VOICE'; }
  btn.addEventListener('click', () => {
    on = !on; paint();
    if (on) { start(); say('Voice online. Say a module name.'); } else { try { rec.stop(); } catch { /* ignore */ } say('Voice offline.'); }
  });
}
