// The Big Tent: game-night ballot box and upcoming nights. Talks to /api/polls (Worker). Text always goes in with textContent.
import { easternToIso, formatEastern, formatLocal } from './time.js';

const MAX_RANK = 4;
const POINTS = [4, 3, 2, 1];
const app = document.getElementById('gn-app');
let state = null; // { me, poll, catalog }
let ranking = []; // candidate keys, best first
let flash = null; // { kind, text }

// ---------------------------------------------------------------- helpers

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c) n.append(c);
  return n;
}
const button = (text, onclick, cls = 'btn btn-gold', extra = {}) => el('button', { type: 'button', class: cls, text, onclick, ...extra });
const candOf = (key) => state.poll?.candidates.find((c) => c.key === key) || { key, name: key };
const nameOf = (key) => candOf(key).name;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doomEligible = (c) => c.tent === 'horror' || c.tent === 'party' || c.group === 'Jackbox';

function safeArt(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

// Small cover art from Steam; a lettered tile when there's no art yet.
function thumb(c, cls = 'thumb') {
  const src = safeArt(c.image);
  if (src) return el('img', { class: cls, src, alt: '', loading: 'lazy', decoding: 'async', width: '92', height: '43' });
  const letters = String(c.name || '?').replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return el('span', { class: `${cls} thumb-none`, 'aria-hidden': 'true', text: letters || '?' });
}

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function act(path, body, success) {
  flash = null;
  const r = await call(path, body);
  if (r.ok) flash = { kind: 'ok', text: typeof success === 'function' ? success(r.data) : success };
  else flash = { kind: 'error', text: r.data.message || 'Something went wrong. Try again.' };
  await load(false);
}

function flashNode() {
  return flash ? el('p', { class: `msg ${flash.kind}`, role: flash.kind === 'error' ? 'alert' : 'status', text: flash.text }) : null;
}

function signInBlock(text) {
  return el('div', { class: 'panel' }, [
    el('p', { text }),
    el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-gold', href: '/auth/login?return=/big-tent/', text: 'Verify with Discord' })]),
    el('p', { class: 'meta', text: 'We only check your Discord account and server membership; see the Privacy Policy.' })
  ]);
}

function whoBar() {
  if (!state.me.signedIn) return null;
  const form = el('form', { method: 'post', action: '/auth/logout' }, [el('button', { type: 'submit', class: 'linklike', text: 'Sign out' })]);
  const role = state.me.manager ? ' · can run polls' : state.me.member ? '' : ' · not in the server yet';
  return el('div', { class: 'who' }, [el('span', { text: `Signed in as ${state.me.name}${role}` }), form]);
}

// Two-step confirm without browser dialogs: the first click arms the button.
function confirmButton(text, confirmText, onConfirm, cls) {
  const b = button(text, () => {
    if (b.dataset.armed) return onConfirm();
    b.dataset.armed = '1';
    b.textContent = confirmText;
    setTimeout(() => {
      if (b.isConnected) {
        delete b.dataset.armed;
        b.textContent = text;
      }
    }, 5000);
  }, cls);
  return b;
}

// ---------------------------------------------------------------- views

function statusPill(status) {
  const label = { open: 'Voting open', closed: 'Voting closed', scheduled: 'Scheduled' }[status] || status;
  return el('span', { class: `pill ${status}`, text: label });
}

function pollHeader(poll) {
  const votes = `${poll.voteCount} ${poll.voteCount === 1 ? 'vote' : 'votes'}`;
  return el('div', { class: 'panel-head' }, [
    el('h2', { text: poll.title }),
    el('div', { class: 'btn-row' }, [statusPill(poll.status), el('span', { class: 'meta', text: `${votes} · started by ${poll.createdByName}` })])
  ]);
}

// Who has voted so far (members only see this). Picks stay secret; the wheel marks Wheel of Doom ballots.
function votersPanel(poll) {
  if (!Array.isArray(poll.voters)) return null;
  const doomed = poll.voters.filter((v) => v.doom).length;
  const list = el('ul', { class: 'voters' }, poll.voters.map((v) => el('li', { class: `voter${v.doom ? ' voter-doom' : ''}` }, [
    v.doom ? el('span', { class: 'voter-mark', 'aria-hidden': 'true', text: '☠' }) : el('span', { class: 'voter-mark', 'aria-hidden': 'true', text: '✓' }),
    document.createTextNode(String(v.name)),
    v.doom ? el('span', { class: 'visually-hidden', text: ' (Wheel of Doom)' }) : null
  ])));
  return el('section', { class: 'panel voters-panel', 'aria-labelledby': 'voters-h' }, [
    el('div', { class: 'panel-head' }, [
      el('h3', { id: 'voters-h', text: poll.voters.length ? `Ballots cast (${poll.voters.length})` : 'No ballots yet' }),
      doomed ? el('span', { class: 'meta', text: `${doomed} braved the Wheel of Doom ☠` }) : null
    ]),
    poll.voters.length ? list : el('p', { class: 'gn-note', text: 'Be the first to cast your ballot.' }),
    el('p', { class: 'gn-note small', text: 'Only names are shown here. Nobody sees what anyone picked until voting closes, and even then only the totals.' })
  ]);
}

function slotsList(locked) {
  const slots = el('ol', { class: 'slots', 'aria-label': 'Your ranking' });
  for (let i = 0; i < MAX_RANK; i++) {
    const key = ranking[i];
    if (!key) {
      slots.append(el('li', { class: 'slot empty' }, [el('span', { class: 'rank', text: String(i + 1) }), el('span', { class: 'thumb thumb-none', 'aria-hidden': 'true' }), el('span', { text: i === 0 ? 'Pick your favorite' : 'Optional' })]));
      continue;
    }
    slots.append(el('li', { class: `slot${locked ? ' doomed' : ''}` }, [
      el('span', { class: 'rank', text: String(i + 1) }),
      thumb(candOf(key)),
      el('span', { class: 'name' }, [document.createTextNode(nameOf(key)), el('span', { class: 'pts', text: `${POINTS[i]} ${POINTS[i] === 1 ? 'point' : 'points'}` })]),
      locked ? null : el('span', { class: 'slot-tools' }, [
        button('↑', () => { [ranking[i - 1], ranking[i]] = [ranking[i], ranking[i - 1]]; render(); }, 'icon-btn', { 'aria-label': `Move ${nameOf(key)} up`, disabled: i === 0 }),
        button('×', () => { ranking.splice(i, 1); render(); }, 'icon-btn', { 'aria-label': `Remove ${nameOf(key)}` })
      ])
    ]));
  }
  return slots;
}

function ballotView(poll) {
  if (poll.myBallotLocked) {
    return el('div', { class: 'panel doom-locked' }, [
      el('h2', { text: 'The wheel has spoken' }),
      el('p', { text: 'The Wheel of Doom chose your ballot. It is locked in until voting closes. No take-backs.' }),
      slotsList(true)
    ]);
  }

  const filter = el('input', { class: 'board-filter', type: 'search', placeholder: 'Filter games', 'aria-label': 'Filter games', id: 'gn-filter' });
  const list = el('ul', { class: 'board-list' });
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren();
    for (const c of poll.candidates) {
      if (q && !c.name.toLowerCase().includes(q)) continue;
      const pos = ranking.indexOf(c.key);
      list.append(el('li', {}, [el('button', {
        type: 'button', class: 'cand', 'aria-pressed': String(pos >= 0),
        onclick: () => {
          if (pos >= 0) ranking.splice(pos, 1);
          else if (ranking.length < MAX_RANK) ranking.push(c.key);
          else ranking[MAX_RANK - 1] = c.key;
          render();
        }
      }, [thumb(c), el('span', { class: 'cand-name', text: c.name }), el('span', { class: 'tag', text: pos >= 0 ? `#${pos + 1}` : '' })])]));
    }
  };
  filter.addEventListener('input', draw);
  draw();

  const had = Array.isArray(poll.myBallot) && poll.myBallot.length;
  const submit = button(had ? 'Update my vote' : 'Cast my vote', () => act(`/api/polls/${poll.id}/ballot`, { ranking: [...ranking] }, had ? 'Vote updated.' : 'Vote counted. You can change it until voting closes.'), 'btn btn-gold', { disabled: ranking.length === 0 });

  return el('div', { class: 'panel' }, [
    el('p', { text: 'Tap games to rank them. First tap is your #1. Tap again to remove.' }),
    el('div', { class: 'ballot' }, [slotsList(false), el('div', { class: 'board' }, [filter, list])]),
    el('div', { class: 'btn-row' }, [submit, had ? el('span', { class: 'meta', text: 'Your vote is in.' }) : null])
  ]);
}

// ---------------------------------------------------------------- the Wheel of Doom

function doomOffer(poll) {
  const pool = poll.candidates.filter(doomEligible);
  if (!pool.length || poll.myBallotLocked) return null;
  const go = confirmButton('Spin the Wheel of Doom', 'Click again. No take-backs.', () => spinDoom(poll, go), 'btn doom-btn');
  return el('div', { class: 'panel doom-offer' }, [
    el('p', { class: 'doom-kicker', text: 'Feeling daring?' }),
    el('h2', { text: 'Spin the Wheel of Doom' }),
    el('p', { text: `The wheel spins four times over the ${pool.length} horror, party and Jackbox games on this ballot and fills your whole vote. Whatever it lands on is final: your ballot locks and can't be changed.` }),
    el('div', { class: 'btn-row' }, [go])
  ]);
}

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of kids) n.append(c);
  return n;
};
const short = (name) => (name.length > 18 ? `${name.slice(0, 17)}…` : name);

// One wheel for the games still in play; returns the rotating group.
function drawWheel(holder, games) {
  const n = games.length;
  const seg = 360 / n;
  const spin = svg('g', { class: 'wheel-spin' });
  const colors = ['#7A1625', '#1A1218', '#4A0C17', '#2A1820'];
  games.forEach((g, i) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
    const large = seg > 180 ? 1 : 0;
    const d = n === 1 ? 'M0,-100 A100,100 0 1,1 -0.01,-100 Z' : `M0,0 L${100 * Math.cos(a0)},${100 * Math.sin(a0)} A100,100 0 ${large},1 ${100 * Math.cos(a1)},${100 * Math.sin(a1)} Z`;
    spin.append(svg('path', { d, fill: colors[i % colors.length], stroke: '#D9B26A', 'stroke-width': 0.8 }));
    const mid = i * seg + seg / 2;
    const label = svg('text', { x: 58, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'wheel-label', transform: `rotate(${mid - 90}) ` + (mid > 180 ? 'rotate(180 58 0)' : '') });
    label.style.setProperty('font-size', `${Math.max(4.2, Math.min(8, 70 / n))}px`);
    label.textContent = short(g.name);
    spin.append(label);
  });
  spin.append(svg('circle', { r: 14, fill: '#0E0B10', stroke: '#D9B26A', 'stroke-width': 2 }));
  const wheel = svg('svg', { viewBox: '-112 -118 224 230', class: 'wheel', role: 'img', 'aria-label': 'The Wheel of Doom' }, [
    svg('circle', { r: 106, fill: 'none', stroke: '#D9B26A', 'stroke-width': 3, 'stroke-dasharray': '1 7.2', 'stroke-linecap': 'round', class: 'wheel-bulbs' }),
    spin,
    svg('path', { d: 'M-9,-116 L9,-116 L0,-96 Z', fill: '#F0D49A', stroke: '#0E0B10', 'stroke-width': 1.5 })
  ]);
  holder.replaceChildren(wheel);
  return spin;
}

// The spin sound (site/big-tent/wheel-spin.mp3) and its timing: each point is [seconds, share of the
// total turn], measured from the clicks in the recording, so the wheel speeds up, races and slows
// exactly as the clicks do and stops on the last click.
const SPIN_STOP = 7.518;
const SPIN_TICKS = 95;
const SPIN_CURVE = [[0.0, 0.0], [0.157, 0.016], [0.313, 0.0289], [0.47, 0.0421], [0.626, 0.052], [0.783, 0.0602], [0.94, 0.0714], [1.096, 0.0903], [1.253, 0.116], [1.41, 0.144], [1.566, 0.1707], [1.723, 0.1963], [1.879, 0.2206], [2.036, 0.2454], [2.193, 0.2725], [2.349, 0.3047], [2.506, 0.3396], [2.663, 0.3747], [2.819, 0.4072], [2.976, 0.437], [3.132, 0.4628], [3.289, 0.4848], [3.446, 0.5041], [3.602, 0.523], [3.759, 0.544], [3.916, 0.5689], [4.072, 0.5985], [4.229, 0.6306], [4.385, 0.6627], [4.542, 0.6935], [4.699, 0.723], [4.855, 0.7507], [5.012, 0.7758], [5.169, 0.7969], [5.325, 0.8157], [5.482, 0.8328], [5.638, 0.851], [5.795, 0.8695], [5.952, 0.8882], [6.108, 0.9059], [6.265, 0.9225], [6.422, 0.9384], [6.578, 0.9535], [6.735, 0.9668], [6.891, 0.9772], [7.048, 0.9847], [7.205, 0.9904], [7.361, 0.9948], [7.518, 1.0]];
let spinAudio = null;
let soundOn = true;

function loadSpinSound() {
  if (!spinAudio) {
    spinAudio = new Audio('/big-tent/wheel-spin.mp3');
    spinAudio.preload = 'auto';
    spinAudio.volume = 0.8;
  }
  spinAudio.load();
}

function curveAt(t) {
  if (t <= 0) return 0;
  if (t >= SPIN_STOP) return 1;
  for (let i = 1; i < SPIN_CURVE.length; i++) {
    const [t1, f1] = SPIN_CURVE[i];
    if (t <= t1) {
      const [t0, f0] = SPIN_CURVE[i - 1];
      return f0 + ((f1 - f0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}

// Pegs on the rim, spaced so one peg passes the pointer for each click in the recording.
function addPegs(spinEl, totalDeg) {
  const count = Math.max(8, Math.round((SPIN_TICKS * 360) / totalDeg));
  for (let i = 0; i < count; i++) {
    const a = ((i * 360) / count - 90) * (Math.PI / 180);
    spinEl.append(svg('circle', { cx: 96 * Math.cos(a), cy: 96 * Math.sin(a), r: 2.2, fill: '#F0D49A' }));
  }
}

// Plays one spin. The wheel follows the audio clock (or a stopwatch if sound can't play), so they stay in step.
async function spinTo(spinEl, games, key) {
  const n = games.length;
  const seg = 360 / n;
  const i = games.findIndex((g) => g.key === key);
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const target = 360 * 5 + (360 - (i * seg + seg / 2)) + jitter;
  addPegs(spinEl, target);
  spinEl.setAttribute('transform', 'rotate(0)');

  let useAudio = false;
  if (spinAudio) {
    spinAudio.muted = !soundOn;
    try {
      spinAudio.currentTime = 0;
      await spinAudio.play();
      useAudio = true;
    } catch {
      useAudio = false; // autoplay blocked or file missing: spin silently on the same timing
    }
  }
  const t0 = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const clock = (performance.now() - t0) / 1000;
      // Follow the audio while it plays; never fall more than a beat behind if it stalls.
      const t = useAudio ? Math.max(spinAudio.currentTime, clock - 0.35) : clock;
      spinEl.setAttribute('transform', `rotate(${target * curveAt(t)})`);
      if (t >= SPIN_STOP) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

const QUIPS = [
  'No refunds. No take-backs. No mercy.',
  'Somewhere under the big top, a clown is laughing. It is probably at you.',
  'You could have voted like a normal person. Bold choice.',
  'Please keep your arms, legs and dignity inside the tent at all times.',
  'The carnival thanks you for your bravery. Your friends thank you for nothing.',
  'Fate has been notified. It cracked its knuckles.'
];

// The full-screen Wheel of Doom show: intro, four spins with face-down cards flipping, then the verdict.
async function spinDoom(poll, btn) {
  btn.disabled = true;
  const r = await call(`/api/polls/${poll.id}/doom`, {});
  if (!r.ok) {
    flash = { kind: 'error', text: r.data.message || 'The wheel jammed. Try again.' };
    return load(false);
  }
  const picks = r.data.ranking;
  let finished = false;
  if (!reduceMotion) loadSpinSound();

  const intro = el('div', { class: 'doom-intro' }, [
    el('p', { class: 'doom-small', text: 'You have chosen' }),
    el('p', { class: 'doom-title', 'data-text': 'THE WHEEL OF DOOM', text: 'THE WHEEL OF DOOM' }),
    el('p', { class: 'doom-quip', text: QUIPS[Math.floor(Math.random() * QUIPS.length)] })
  ]);
  const wheelBox = el('div', { class: 'wheel-holder' });
  const status = el('p', { class: 'doom-status', role: 'status', 'aria-live': 'polite', text: '' });
  const cards = el('ol', { class: 'doom-cards', 'aria-label': 'Your fate' });
  const slots = picks.map((key, k) => {
    const c = candOf(key);
    const card = el('li', { class: 'doom-card' }, [
      el('div', { class: 'doom-card-inner' }, [
        el('div', { class: 'doom-face doom-back', 'aria-hidden': 'true' }, [el('span', { text: '?' })]),
        el('div', { class: 'doom-face doom-front' }, [el('span', { class: 'rank', text: `#${k + 1}` }), thumb(c, 'thumb doom-art'), el('span', { class: 'name', text: c.name })])
      ])
    ]);
    cards.append(card);
    return card;
  });
  const verdict = el('div', { class: 'doom-verdict', hidden: true }, [
    el('p', { class: 'doom-title small', text: 'THE WHEEL HAS SPOKEN' }),
    el('p', { class: 'doom-stamp', text: 'LOCKED IN' })
  ]);
  const closeBtn = button('Accept my fate', () => dialog.close(), 'btn btn-gold doom-close', { hidden: true });
  const soundBtn = button('Sound: on', () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? 'Sound: on' : 'Sound: off';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (spinAudio) spinAudio.muted = !soundOn;
  }, 'linklike doom-sound', { 'aria-pressed': String(soundOn), hidden: reduceMotion });
  soundBtn.textContent = soundOn ? 'Sound: on' : 'Sound: off';
  const show = el('div', { class: 'doom-show', hidden: true }, [soundBtn, wheelBox, status, cards, verdict, closeBtn]);
  const dialog = el('dialog', { class: 'doom-dialog', 'aria-label': 'The Wheel of Doom' }, [intro, show]);
  dialog.addEventListener('cancel', (e) => { if (!finished) e.preventDefault(); });
  dialog.addEventListener('close', () => { if (spinAudio) spinAudio.pause(); dialog.remove(); load(true); });
  document.body.append(dialog);
  dialog.showModal();

  await sleep(reduceMotion ? 1500 : 3000);
  intro.classList.add('leaving');
  await sleep(reduceMotion ? 0 : 450);
  intro.hidden = true;
  show.hidden = false;

  let remaining = poll.candidates.filter(doomEligible);
  for (let k = 0; k < picks.length; k++) {
    status.textContent = `Spin ${k + 1} of ${picks.length}…`;
    const spinEl = drawWheel(wheelBox, remaining);
    if (reduceMotion) await sleep(700);
    else await spinTo(spinEl, remaining, picks[k]);
    status.textContent = `#${k + 1}: ${nameOf(picks[k])}`;
    slots[k].classList.add('flipped');
    remaining = remaining.filter((g) => g.key !== picks[k]);
    await sleep(reduceMotion ? 400 : 1400);
  }
  wheelBox.hidden = true;
  status.textContent = 'Your ballot is cast and locked until voting closes.';
  verdict.hidden = false;
  closeBtn.hidden = false;
  finished = true;
  closeBtn.focus();
  flash = { kind: 'ok', text: 'The Wheel of Doom cast your vote. No take-backs.' };
}

function resultsList(results) {
  const ol = el('ol', { class: 'results', 'aria-label': 'Final standings' });
  results.forEach((r, i) => {
    const win = i < MAX_RANK && r.points > 0;
    ol.append(el('li', { class: `result${win ? ' win' : ''}` }, [
      el('span', { class: 'place', text: String(i + 1) }),
      el('span', { class: 'result-name' }, [thumb(candOf(r.key)), el('span', { text: r.name })]),
      el('span', { class: 'score' }, [el('b', { text: `${r.points} ${r.points === 1 ? 'pt' : 'pts'}` }), document.createTextNode(r.firsts ? ` · ${r.firsts} first-place ${r.firsts === 1 ? 'vote' : 'votes'}` : '')])
    ]));
  });
  return ol;
}

function managerOpenControls(poll) {
  return el('div', { class: 'panel' }, [
    el('h2', { text: 'Run the poll' }),
    el('p', { class: 'meta', text: 'Closing voting posts the top four to #general. You set the date and time next.' }),
    el('div', { class: 'btn-row' }, [
      confirmButton('Close voting', 'Click again to close and post results', () => act(`/api/polls/${poll.id}/close`, {}, (d) => (d.posted ? 'Voting closed. Results posted to #general.' : `Voting closed, but the #general post failed. ${d.reason || ''} Fix it, then use "Post to Discord again".`))),
      confirmButton('Cancel poll', 'Click again to cancel', () => act(`/api/polls/${poll.id}/cancel`, {}, 'Poll cancelled.'), 'btn btn-danger')
    ])
  ]);
}

function scheduleForm(poll) {
  const day = el('input', { type: 'date', id: 'gn-day', required: true });
  const time = el('input', { type: 'time', id: 'gn-time', required: true, value: '20:00', step: '900' });
  const go = button('Create the Discord event', async () => {
    const start = easternToIso(day.value, time.value);
    if (!start) {
      flash = { kind: 'error', text: 'Pick a date and a time (Eastern).' };
      return render();
    }
    go.disabled = true;
    await act(`/api/polls/${poll.id}/schedule`, { start }, (d) => (d.posted ? 'Event created in The Main Stage and announced in #general.' : `Event created, but the #general announcement failed. ${d.reason || ''} Fix it, then use "Post to Discord again".`));
  });
  const kids = [
    el('h2', { text: 'Set the date' }),
    el('p', { class: 'meta', text: 'Times are Eastern. This creates the event in The Main Stage and posts it to #general.' }),
    el('div', { class: 'when' }, [
      el('div', { class: 'field' }, [el('label', { for: 'gn-day', text: 'Date' }), day]),
      el('div', { class: 'field' }, [el('label', { for: 'gn-time', text: 'Start time (ET)' }), time]),
      go
    ])
  ];
  const retry = !poll.resultsPosted ? button('Post to Discord again', () => act(`/api/polls/${poll.id}/announce`, {}, 'Posted to #general.'), 'btn btn-ghost') : null;
  kids.push(el('div', { class: 'btn-row' }, [retry, confirmButton('Cancel poll', 'Click again to cancel', () => act(`/api/polls/${poll.id}/cancel`, {}, 'Poll cancelled.'), 'btn btn-danger')]));
  return el('div', { class: 'panel' }, kids);
}

function createForm() {
  const groups = new Map();
  for (const c of state.catalog || []) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  const title = el('input', { id: 'gn-title', type: 'text', maxlength: '60', value: 'Game Night', autocomplete: 'off' });
  const count = el('span', { class: 'meta', text: '0 selected' });
  const filter = el('input', { class: 'board-filter', type: 'search', placeholder: 'Filter games', 'aria-label': 'Filter the game list' });
  const lists = el('div', { class: 'picklist' });
  const boxes = [];
  for (const [group, items] of groups) {
    const ul = el('ul', { class: 'checks' });
    for (const c of items) {
      const box = el('input', { type: 'checkbox', value: c.key });
      box.addEventListener('change', () => { count.textContent = `${boxes.filter((b) => b.checked).length} selected`; });
      boxes.push(box);
      ul.append(el('li', { 'data-name': c.name.toLowerCase() }, [el('label', {}, [box, thumb(c, 'thumb thumb-sm'), el('span', { text: c.players ? `${c.name} · ${c.players}` : c.name })])]));
    }
    lists.append(el('section', {}, [el('h3', { text: group }), ul]));
  }
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const li of lists.querySelectorAll('li')) li.hidden = Boolean(q) && !li.dataset.name.includes(q);
  });
  const open = button('Open voting', () => {
    const candidates = boxes.filter((b) => b.checked).map((b) => b.value);
    if (candidates.length < 2) {
      flash = { kind: 'error', text: 'Pick at least two games.' };
      return render();
    }
    act('/api/polls', { title: title.value, candidates }, 'Voting is open. Share the link in Discord!');
  });
  return el('div', { class: 'panel' }, [
    el('h2', { text: 'Start a poll' }),
    el('div', { class: 'field' }, [el('label', { for: 'gn-title', text: 'Name' }), title]),
    el('div', { class: 'btn-row' }, [el('span', { class: 'label meta', text: 'Games on the ballot (2–24)' }), count]),
    filter,
    lists,
    el('div', { class: 'btn-row' }, [open])
  ]);
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

// Scheduled nights, soonest first, in the same row style the home page used.
function renderUpcoming() {
  const section = document.getElementById('gn-upcoming');
  const list = document.getElementById('gn-nights');
  const nights = state.upcoming || [];
  section.hidden = nights.length === 0;
  list.replaceChildren();
  for (const n of nights) {
    const d = new Date(n.eventStart);
    const local = formatLocal(n.eventStart);
    const et = formatEastern(n.eventStart);
    list.append(el('div', { class: 'night' }, [
      el('div', { class: 'night-day', text: dayFmt.format(d) }),
      el('div', { class: 'night-time', text: `${timeFmt.format(d)} ET` }),
      el('div', { class: 'night-game' }, [
        el('strong', { text: n.title }),
        el('span', { class: 'lineup', text: n.lineup.join(' · ') }),
        local && local !== et ? el('span', { class: 'meta', text: `Your time: ${local}` }) : null
      ]),
      n.eventUrl
        ? el('a', { class: 'btn btn-ghost btn-sm', href: n.eventUrl, target: '_blank', rel: 'noopener', text: 'Open in Discord' })
        : el('span', { class: 'meta', text: 'The Main Stage' }),
      state.me.manager && !n.eventPosted ? button('Post to Discord again', () => act(`/api/polls/${n.id}/announce`, {}, 'Posted to #general.'), 'btn btn-ghost btn-sm') : null
    ]));
  }
}

// ---------------------------------------------------------------- Discord setup check (Ringleaders)

function discordCheck() {
  const out = el('ul', { class: 'checks-list', 'aria-live': 'polite' });
  const run = button('Check Discord setup', async () => {
    run.disabled = true;
    out.replaceChildren(el('li', { class: 'meta', text: 'Asking Discord…' }));
    const r = await call('/api/polls/discord-check');
    run.disabled = false;
    out.replaceChildren();
    if (!r.ok) return out.append(el('li', { class: 'check bad', text: r.data.message || 'The check did not run. Try again.' }));
    for (const c of r.data.checks) {
      out.append(el('li', { class: `check ${c.ok ? 'good' : 'bad'}` }, [
        el('span', { class: 'mark', 'aria-hidden': 'true', text: c.ok ? '✓' : '✗' }),
        el('span', {}, [el('strong', { text: c.label }), c.fix ? el('span', { class: 'fix', text: c.fix }) : null]),
        el('span', { class: 'visually-hidden', text: c.ok ? ' (ok)' : ' (needs fixing)' })
      ]));
    }
    if (r.data.checks.every((c) => c.ok)) out.append(el('li', { class: 'meta', text: 'All good: the bot can post to #general and create events in The Main Stage.' }));
  }, 'btn btn-ghost btn-sm');
  return el('details', { class: 'panel discord-check' }, [
    el('summary', { text: 'Discord connection' }),
    el('p', { class: 'meta', text: 'If posts to #general or event creation fail, this shows exactly which permission the bot is missing.' }),
    el('div', { class: 'btn-row' }, [run]),
    out
  ]);
}

// ---------------------------------------------------------------- render

function render() {
  const { me, poll } = state;
  const out = [];
  const f = flashNode();
  if (f) out.push(f);

  if (!poll) {
    out.push(el('div', { class: 'panel' }, [el('h2', { text: 'No poll is open right now' }), el('p', { text: (state.upcoming || []).length ? 'The next night is booked. Watch Discord for the next poll.' : 'When a Ringleader opens a poll, it shows up here and in Discord.' })]));
    if (!me.signedIn) out.push(signInBlock('Members: verify with Discord to vote and get event links.'));
    if (me.manager) out.push(createForm());
  } else {
    const head = el('div', { class: 'panel' }, [pollHeader(poll)]);
    out.push(head);
    const voters = votersPanel(poll);
    if (poll.status === 'open') {
      if (!me.signedIn) out.push(signInBlock('Voting is open to everyone in the Belpire Discord. Verify with Discord to cast your ballot.'));
      else if (!me.member) out.push(el('div', { class: 'panel' }, [el('p', { text: 'Only members of the Belpire Discord can vote. Join the server, then come back to this page.' }), el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-gold', href: '/join/', text: 'Get your ticket' })])]));
      else {
        out.push(ballotView(poll));
        const doom = doomOffer(poll);
        if (doom) out.push(doom);
      }
      if (voters) out.push(voters);
      if (me.manager) out.push(managerOpenControls(poll));
    } else {
      head.append(el('p', { text: 'Voting is closed. The RingMaster is picking the date and time.' }));
      if (poll.results) head.append(resultsList(poll.results));
      if (voters) out.push(voters);
      if (me.manager) out.push(scheduleForm(poll));
    }
  }
  if (me.manager) out.push(discordCheck());
  const who = whoBar();
  if (who) out.push(who);
  app.replaceChildren(...out);
  renderUpcoming();
}

async function load(resetBallot = true) {
  const r = await call('/api/polls/current');
  if (!r.ok) {
    app.replaceChildren(el('div', { class: 'panel' }, [el('p', { text: r.data.message || 'The ballot box is closed for a moment. Try again shortly.' })]));
    return;
  }
  state = r.data;
  if (resetBallot || state.poll?.status !== 'open') ranking = Array.isArray(state.poll?.myBallot) ? [...state.poll.myBallot] : [];
  render();
}

load();
