// The Big Tent: game-night ballot box and upcoming nights. Talks to /api/polls (Worker). Text always goes in with textContent.
import { easternToIso, formatEastern, formatLocal } from './time.js';

const MAX_RANK = 4;
const POINTS = [4, 3, 2, 1];
const app = document.getElementById('gn-app');
// The same script runs Backstage (/backstage/), the Ringleaders' staff page, which shows only the tools.
const BACKSTAGE = document.body?.dataset.page === 'backstage';
let arrived = false; // jump to #section once, after the first render
let state = null; // { me, polls, poll (the one on screen), upcoming, catalog }
let pollId = new URLSearchParams(location.search).get('poll'); // which of several polls is on screen
let ranking = []; // candidate keys, best first
let selected = null; // a game picked up by tapping, waiting for a slot
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
    el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-gold', href: `/auth/login?return=${BACKSTAGE ? '/backstage/' : '/big-tent/'}`, text: 'Verify with Discord' })]),
    el('p', { class: 'meta', text: 'We only check your Discord account and server membership; see the Privacy Policy.' })
  ]);
}

function whoBar() {
  if (!state.me.signedIn) return null;
  const form = el('form', { method: 'post', action: '/auth/logout' }, [el('button', { type: 'submit', class: 'linklike', text: 'Sign out' })]);
  const role = state.me.manager ? ' · Ringleader' : state.me.member ? '' : ' · not in the server yet';
  const door = state.me.manager && !BACKSTAGE ? el('a', { class: 'btn btn-ghost btn-sm', href: '/backstage/', text: 'Go Backstage' }) : null;
  return el('div', { class: 'who' }, [el('span', { text: `Signed in as ${state.me.name}${role}` }), door, form].filter(Boolean));
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

// Put a game into slot i (0-based). Slots fill top-down, so a drop below the filled ones goes to the next open slot.
// A ranked game dropped on another slot swaps places with it. A new game dropped on a filled slot slides in there
// and pushes the rest down; if all four were full, the fourth goes back to the board.
function place(key, i) {
  const from = ranking.indexOf(key);
  if (from >= 0) {
    if (i >= ranking.length) {
      ranking.splice(from, 1);
      ranking.push(key);
    } else {
      [ranking[from], ranking[i]] = [ranking[i], ranking[from]];
    }
    return;
  }
  ranking.splice(Math.min(i, ranking.length), 0, key);
  ranking.length = Math.min(ranking.length, MAX_RANK);
}

// Drag with a mouse (move to start) or a finger (press and hold, then move). Works alongside tap-to-select.
let drag = null;
function draggable(node, key) {
  let start = null;
  let holdTimer = null;
  const begin = (e) => {
    const ghost = el('div', { class: 'drag-ghost', 'aria-hidden': 'true' }, [thumb(candOf(key), 'thumb thumb-sm'), el('span', { text: nameOf(key) })]);
    document.body.append(ghost);
    drag = { key, ghost, over: null, y: e.clientY, x: e.clientX };
    // Scroll the page when the dragged game nears the top or bottom edge (phones put the slots above the list).
    const edge = () => {
      if (!drag) return;
      const zone = 70;
      const dy = drag.y < zone ? -(zone - drag.y) / 4 : drag.y > innerHeight - zone ? (drag.y - (innerHeight - zone)) / 4 : 0;
      if (dy) {
        scrollBy(0, dy);
        move({ clientX: drag.x, clientY: drag.y });
      }
      requestAnimationFrame(edge);
    };
    requestAnimationFrame(edge);
    node.classList.add('dragging');
    document.body.classList.add('is-dragging');
    move(e);
  };
  const move = (e) => {
    if (!drag) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.ghost.style.setProperty('transform', `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`);
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('.slot[data-slot]');
    if (drag.over && drag.over !== hit) drag.over.classList.remove('drop-target');
    if (hit) hit.classList.add('drop-target');
    drag.over = hit || null;
  };
  const end = (drop) => {
    clearTimeout(holdTimer);
    start = null;
    if (!drag) return;
    const { over } = drag;
    drag.ghost.remove();
    node.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    if (over) over.classList.remove('drop-target');
    const wasKey = drag.key;
    drag = null;
    node.dataset.justDragged = '1';
    setTimeout(() => delete node.dataset.justDragged, 0);
    if (drop && over) {
      place(wasKey, Number(over.dataset.slot));
      selected = null;
      render();
    }
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    if (start.touch) holdTimer = setTimeout(() => { if (start) { node.setPointerCapture?.(e.pointerId); begin(e); } }, 280);
  });
  node.addEventListener('pointermove', (e) => {
    if (drag) return move(e);
    if (!start) return;
    const far = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8;
    if (!far) return;
    if (start.touch) { clearTimeout(holdTimer); start = null; return; } // it was a scroll
    node.setPointerCapture?.(e.pointerId);
    begin(e);
  });
  node.addEventListener('pointerup', () => end(true));
  node.addEventListener('pointercancel', () => end(false));
  node.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  node.addEventListener('contextmenu', (e) => { if (drag || start?.touch) e.preventDefault(); });
  node.addEventListener('click', (e) => { if (node.dataset.justDragged) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

function slotsList(locked) {
  const slots = el('ol', { class: 'slots', 'aria-label': 'Your ranking' });
  const placeBtn = (i) => selected && !locked
    ? button(i < ranking.length ? 'Put here' : 'Place here', () => { place(selected, i); selected = null; render(); }, 'btn btn-gold btn-sm place-btn', { 'aria-label': `Put ${nameOf(selected)} in slot ${Math.min(i, ranking.length) + 1}` })
    : null;
  for (let i = 0; i < MAX_RANK; i++) {
    const key = ranking[i];
    if (!key) {
      slots.append(el('li', { class: `slot empty${selected ? ' awaiting' : ''}`, 'data-slot': locked ? null : String(i) }, [
        el('span', { class: 'rank', text: String(i + 1) }),
        el('span', { class: 'thumb thumb-none', 'aria-hidden': 'true' }),
        el('span', { text: selected ? '' : i === 0 ? 'Drag a game here, or tap one' : 'Optional' }),
        placeBtn(i)
      ]));
      continue;
    }
    const li = el('li', { class: `slot${locked ? ' doomed' : ''}${selected === key ? ' picked' : ''}${selected && selected !== key ? ' awaiting' : ''}`, 'data-slot': locked ? null : String(i) }, [
      el('span', { class: 'rank', text: String(i + 1) }),
      thumb(candOf(key)),
      el('span', { class: 'name' }, [document.createTextNode(nameOf(key)), el('span', { class: 'pts', text: `${POINTS[i]} ${POINTS[i] === 1 ? 'point' : 'points'}` })]),
      locked ? null : (selected && selected !== key) ? placeBtn(i) : el('span', { class: 'slot-tools' }, [
        button('↑', () => { [ranking[i - 1], ranking[i]] = [ranking[i], ranking[i - 1]]; render(); }, 'icon-btn', { 'aria-label': `Move ${nameOf(key)} up`, disabled: i === 0 }),
        button('↓', () => { [ranking[i + 1], ranking[i]] = [ranking[i], ranking[i + 1]]; render(); }, 'icon-btn', { 'aria-label': `Move ${nameOf(key)} down`, disabled: i === ranking.length - 1 }),
        button('×', () => { ranking.splice(i, 1); if (selected === key) selected = null; render(); }, 'icon-btn', { 'aria-label': `Remove ${nameOf(key)}` })
      ])
    ]);
    if (!locked) {
      li.classList.add('grab');
      draggable(li, key);
    }
    slots.append(li);
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
      const btn = el('button', {
        type: 'button', class: `cand grab${selected === c.key ? ' picked' : ''}`, 'aria-pressed': String(selected === c.key),
        'aria-label': `${c.name}${pos >= 0 ? `, ranked ${pos + 1}` : ''}. ${selected === c.key ? 'Selected: choose a slot.' : 'Select, then choose a slot.'}`,
        onclick: () => {
          selected = selected === c.key ? null : c.key;
          render();
          if (selected) (document.querySelector('.slot.empty .place-btn') || [...document.querySelectorAll('.place-btn')].pop())?.focus();
        }
      }, [thumb(c), el('span', { class: 'cand-name', text: c.name }), el('span', { class: 'tag', text: pos >= 0 ? `#${pos + 1}` : selected === c.key ? 'Pick a slot' : '' })]);
      draggable(btn, c.key);
      list.append(el('li', {}, [btn]));
    }
  };
  filter.addEventListener('input', draw);
  draw();

  const had = Array.isArray(poll.myBallot) && poll.myBallot.length;
  const submit = button(had ? 'Update my vote' : 'Cast my vote', () => act(`/api/polls/${poll.id}/ballot`, { ranking: [...ranking] }, had ? 'Vote updated.' : 'Vote counted. You can change it until voting closes.'), 'btn btn-gold', { disabled: ranking.length === 0 });

  return el('div', { class: 'panel' }, [
    el('p', { text: 'Drag a game onto a slot, or tap a game and then tap the slot you want. Drag ranked games up and down to reorder.' }),
    selected ? el('p', { class: 'select-hint', role: 'status' }, [document.createTextNode(`${nameOf(selected)} picked up. Choose a slot, or `), button('cancel', () => { selected = null; render(); }, 'linklike')]) : null,
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
  const day = el('input', { type: 'date', id: `gn-day-${poll.id}`, required: true });
  const time = el('input', { type: 'time', id: `gn-time-${poll.id}`, required: true, value: '20:00', step: '900' });
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
      el('div', { class: 'field' }, [el('label', { for: day.id, text: 'Date' }), day]),
      el('div', { class: 'field' }, [el('label', { for: time.id, text: 'Start time (ET)' }), time]),
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
  const count = el('span', { class: 'meta', text: `${(state.prizePicks || []).length} selected` });
  const filter = el('input', { class: 'board-filter', type: 'search', placeholder: 'Filter games', 'aria-label': 'Filter the game list' });
  const lists = el('div', { class: 'picklist' });
  const boxes = [];
  // Prize Booth "Put a game on the ballot" orders arrive pre-ticked.
  const picks = new Map((state.prizePicks || []).map((p) => [p.key, p.by]));
  for (const [group, items] of groups) {
    const ul = el('ul', { class: 'checks' });
    for (const c of items) {
      const box = el('input', { type: 'checkbox', value: c.key, checked: picks.has(c.key) });
      box.addEventListener('change', () => { count.textContent = `${boxes.filter((b) => b.checked).length} selected`; });
      boxes.push(box);
      ul.append(el('li', { 'data-name': c.name.toLowerCase() }, [el('label', {}, [box, thumb(c, 'thumb thumb-sm'), el('span', { text: c.players ? `${c.name} · ${c.players}` : c.name }), picks.has(c.key) ? el('span', { class: 'prize-pick', text: `🎟 ${picks.get(c.key)}'s pick` }) : null])]));
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
    act('/api/polls', { title: title.value, candidates }, (d) => `Voting is open. Share the link in Discord!${d.prizePicks ? ` ${d.prizePicks} Prize Booth pick${d.prizePicks === 1 ? '' : 's'} delivered.` : ''}`);
  });
  return el('div', { class: 'panel' }, [
    el('h2', { text: 'Start a poll' }),
    el('div', { class: 'field' }, [el('label', { for: 'gn-title', text: 'Name' }), title]),
    el('div', { class: 'btn-row' }, [el('span', { class: 'label meta', text: 'Games on the ballot (2–24)' }), count]),
    (state.prizePicks || []).length ? el('p', { class: 'prize-picks-note', text: `🎟 ${state.prizePicks.length} game${state.prizePicks.length === 1 ? '' : 's'} bought at the Prize Booth ${state.prizePicks.length === 1 ? 'is' : 'are'} pre-ticked. Opening the poll with ${state.prizePicks.length === 1 ? 'it' : 'them'} completes the order${state.prizePicks.length === 1 ? '' : 's'}.` }) : null,
    filter,
    lists,
    el('div', { class: 'btn-row' }, [open])
  ]);
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

// Scheduled nights, soonest first, in the same row style the home page used.
// The carnival ticker across the top: the open poll and every booked night, scrolling like a marquee.
// The moving copy is decorative (aria-hidden); a plain list carries the same text for screen readers,
// and with reduced motion the items simply sit still and wrap.
let liveNow = { live: false, streamers: [] };
document.addEventListener('belpire:live', (e) => {
  const next = e.detail || { live: false, streamers: [] };
  if (next.live === liveNow.live && next.streamers.join() === liveNow.streamers.join()) return;
  liveNow = next;
  if (state) renderUpcoming();
});

function renderUpcoming() {
  const box = document.getElementById('gn-ticker');
  const track = document.getElementById('gn-ticker-track');
  const sr = document.getElementById('gn-ticker-sr');
  const tools = document.getElementById('gn-ticker-tools');
  if (!box || !track) return;
  const items = [];
  const tag = document.getElementById('gn-ticker-tag');
  // "NOW SHOWING" only while a Ringleader is live in The Main Stage; otherwise it's just the bill.
  box.classList.toggle('is-live', liveNow.live);
  if (tag) tag.textContent = liveNow.live ? 'NOW SHOWING' : 'ON THE BILL';
  if (liveNow.live) {
    const who = liveNow.streamers.length < 3 ? liveNow.streamers.join(' and ') : `${liveNow.streamers.slice(0, -1).join(', ')} and ${liveNow.streamers.at(-1)}`;
    items.push({ icon: '🔴', kicker: 'LIVE IN THE MAIN STAGE', text: `${who || 'A Ringleader'} ${liveNow.streamers.length > 1 ? 'are' : 'is'} on stage right now` });
  }
  for (const poll of state.polls || []) {
    if (poll.status === 'open') items.push({ icon: '🗳️', kicker: 'VOTING OPEN', text: `${poll.title} · ${poll.voteCount} ${poll.voteCount === 1 ? 'ballot' : 'ballots'} cast · rank your four below` });
    else items.push({ icon: '📜', kicker: 'THE VOTES ARE IN', text: `${poll.title} · the RingMaster is setting the date` });
  }
  for (const n of state.upcoming || []) {
    const d = new Date(n.eventStart);
    const local = formatLocal(n.eventStart);
    const et = formatEastern(n.eventStart);
    items.push({
      icon: '🎪',
      kicker: `${dayFmt.format(d).toUpperCase()} · ${timeFmt.format(d)} ET`,
      text: `${n.title}${n.lineup.length ? ` · ${n.lineup.join(' ✦ ')}` : ''}${local && local !== et ? ` (your time ${local})` : ''}`,
      href: n.eventUrl
    });
  }
  if (!items.length) items.push({ icon: '🎟️', kicker: 'INTERMISSION', text: 'No show on the bill yet. Watch Discord for the next poll' });
  const piece = (it) => [
    el('span', { class: 'tick-item' }, [
      el('span', { class: 'tick-icon', text: it.icon }),
      el('span', { class: 'tick-kicker', text: it.kicker }),
      el('span', { class: 'tick-text', text: it.text })
    ]),
    el('span', { class: 'tick-sep', text: '✦' })
  ];
  const run = () => el('span', { class: 'ticker-run' }, items.flatMap(piece));
  track.replaceChildren(run(), run());
  sr.replaceChildren(el('li', { text: liveNow.live ? 'Now showing:' : 'On the bill:' }), ...items.map((it) => el('li', { text: `${it.kicker}: ${it.text}` })));
  track.style.setProperty('--ticker-duration', `${Math.max(18, items.reduce((n, it) => n + it.text.length + it.kicker.length, 0) * 0.28)}s`);
  box.hidden = false;
  // Links and Ringleader tools can't live in a moving strip, so they sit just below it.
  const links = (state.upcoming || []).flatMap((n) => [
    n.eventUrl ? el('a', { class: 'btn btn-ghost btn-sm', href: n.eventUrl, target: '_blank', rel: 'noopener', text: `Open "${n.title}" in Discord` }) : null,
    state.me.manager && !n.eventPosted ? button(`Post "${n.title}" to Discord again`, () => act(`/api/polls/${n.id}/announce`, {}, 'Posted to #general.'), 'btn btn-ghost btn-sm') : null
  ]).filter(Boolean);
  tools.replaceChildren(...links);
  tools.hidden = links.length === 0;
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
    el('summary', { text: 'Check the bot\'s permissions' }),
    el('p', { class: 'meta', text: 'If posts to #general or event creation fail, this shows exactly which permission the bot is missing.' }),
    el('div', { class: 'btn-row' }, [run]),
    out
  ]);
}

// ---------------------------------------------------------------- backstage (Ringleaders only, after sign-in)
// The server checks the role on every action; this only decides what the page shows.
function renderBackstage() {
  const stage = document.getElementById('backstage');
  if (!stage) return;
  const { me } = state;
  if (!me.manager) {
    stage.hidden = true;
    return;
  }
  stage.hidden = false;
  const pollSlot = document.getElementById('gn-backstage-poll');
  const live = (state.polls || []).length;
  document.getElementById('bs-polls-count')?.replaceChildren(live ? `${live} running` : 'none running');
  const tools = [];
  for (const p of state.polls || []) {
    tools.push(el('section', { class: 'backstage-poll' }, [
      el('p', { class: 'backstage-poll-name' }, [el('span', { class: `pill ${p.status}`, text: p.status === 'open' ? 'Voting open' : 'Votes in' }), document.createTextNode(` ${p.title} · ${p.voteCount} ${p.voteCount === 1 ? 'ballot' : 'ballots'}`)]),
      p.status === 'open' ? managerOpenControls(p) : scheduleForm(p)
    ]));
  }
  const form = createForm();
  tools.push((state.polls || []).length ? el('details', { class: 'backstage-new' }, [el('summary', { text: '＋ Open another poll' }), form]) : form);
  pollSlot.replaceChildren(...tools);
  // The Discord check keeps its results between re-renders, so it is only built once.
  const disc = document.getElementById('gn-backstage-discord');
  if (!disc.firstChild) disc.append(discordCheck());
  document.dispatchEvent(new CustomEvent('belpire:backstage'));
}

// The Backstage page: a gate for everyone else, the tools for Ringleaders.
function renderStaffPage() {
  const gate = document.getElementById('backstage-gate');
  const stage = document.getElementById('backstage');
  const { me } = state;
  if (!me.manager) {
    stage.hidden = true;
    gate.hidden = false;
    const block = !me.signedIn
      ? signInBlock('Backstage is for the RingMaster, RingMistress, Carnival Guards and the Fortune Teller. Verify with Discord to come through.')
      : el('div', { class: 'panel' }, [
        el('h2', { text: 'Staff only' }),
        el('p', { text: 'This door is for the Ringleaders. If you think you should be back here, ask the RingMaster in Discord.' }),
        el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-gold', href: '/big-tent/', text: 'Back to The Big Tent' })])
      ]);
    gate.replaceChildren(...[block, whoBar()].filter(Boolean));
    return;
  }
  gate.hidden = true;
  gate.replaceChildren();
  document.getElementById('backstage-flash').replaceChildren(...[flashNode()].filter(Boolean));
  renderBackstage();
  document.getElementById('backstage-who').replaceChildren(...[whoBar()].filter(Boolean));
  if (!arrived) {
    arrived = true;
    const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
}

// ---------------------------------------------------------------- render

function render() {
  if (BACKSTAGE) return renderStaffPage();
  const { me, poll } = state;
  const out = [];
  const f = flashNode();
  if (f) out.push(f);
  const tabs = pollTabs();
  if (tabs) out.push(tabs);

  if (!poll) {
    out.push(el('div', { class: 'panel' }, [el('h2', { text: 'No poll is open right now' }), el('p', { text: (state.upcoming || []).length ? 'The next night is booked. Watch Discord for the next poll.' : 'When a Ringleader opens a poll, it shows up here and in Discord.' })]));
    if (!me.signedIn) out.push(signInBlock('Members: verify with Discord to vote and get event links.'));
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
    } else {
      head.append(el('p', { text: 'Voting is closed. The RingMaster is picking the date and time.' }));
      if (poll.results) head.append(resultsList(poll.results));
      if (voters) out.push(voters);
    }
  }
  const who = whoBar();
  if (who) out.push(who);
  app.replaceChildren(...out);
  renderUpcoming();
}

async function load(resetBallot = true) {
  const r = await call('/api/polls/current');
  if (!r.ok) {
    (app || document.getElementById('backstage-gate')).replaceChildren(el('div', { class: 'panel' }, [el('p', { text: r.data.message || 'The ballot box is closed for a moment. Try again shortly.' })]));
    return;
  }
  state = r.data;
  const polls = Array.isArray(state.polls) ? state.polls : state.poll ? [state.poll] : [];
  state.polls = polls;
  const keep = polls.find((p) => p.id === pollId);
  const shown = keep || polls.find((p) => p.status === 'open') || polls[0] || null;
  if (shown?.id !== pollId) resetBallot = true;
  pollId = shown?.id || null;
  state.poll = shown;
  if (resetBallot || state.poll?.status !== 'open') ranking = Array.isArray(state.poll?.myBallot) ? [...state.poll.myBallot] : [];
  selected = null;
  render();
}

function showPoll(id) {
  const p = state.polls.find((x) => x.id === id);
  if (!p || p.id === pollId) return;
  pollId = p.id;
  state.poll = p;
  ranking = Array.isArray(p.myBallot) ? [...p.myBallot] : [];
  selected = null;
  flash = null;
  const u = new URL(location.href);
  u.searchParams.set('poll', p.id);
  history.replaceState(null, '', u);
  render();
  document.getElementById(`tab-${p.id}`)?.focus();
}

// One tab per poll when several are running, so each night's vote stays separate.
function pollTabs() {
  const polls = state.polls || [];
  if (polls.length < 2) return null;
  const tabs = el('div', { class: 'poll-tabs', role: 'tablist', 'aria-label': 'Game night polls' });
  polls.forEach((p, i) => {
    const on = p.id === pollId;
    const t = el('button', {
      type: 'button', role: 'tab', id: `tab-${p.id}`, class: `poll-tab${on ? ' on' : ''}`,
      'aria-selected': String(on), 'aria-controls': 'gn-app', tabindex: on ? '0' : '-1',
      onclick: () => showPoll(p.id)
    }, [
      el('span', { class: 'poll-tab-title', text: p.title }),
      el('span', { class: `poll-tab-state ${p.status}`, text: p.status === 'open' ? (p.myBallot?.length ? '✓ voted' : 'vote now') : 'votes in' })
    ]);
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) showPoll(polls[(i + d + polls.length) % polls.length].id);
    });
    tabs.append(t);
  });
  return tabs;
}

load();
