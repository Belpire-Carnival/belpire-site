// The BoothStage: one 3D canvas, created only when a member opens a booth that has a 3D scene and torn down
// (every geometry, material, texture and the WebGL context) when they leave, so the Ticket Booth never holds
// more than one canvas. Shared for every booth: dark carnival lighting with a swaying overhead spotlight,
// dust motes, a slow "breathing" camera, the HUD (title, plays left, odds, sound, leave), synthesized sound,
// and the win toast. Each booth (./booths/<id>.js) only builds its props and plays out a result.
//
// "Server rolls, 3D stages": the stage sends the member's pick, the Worker rolls the outcome, and the booth
// animates whatever the server says. Nothing measured here (aim, timing, physics) can change a payout.
import { THREE, materials, environment, dustMotes, disposeTree, lathe, mesh, fitProp, wrap, PALETTE } from './kit.js';
import { GLTFLoader } from '../vendor/three-0.170.0/loaders/GLTFLoader.js';
import { createAudio } from './audio.js';
import { easeInOut, mulberry32, shake as shakeAt } from './choreo.js';

// Booths with a 3D scene. Keep in step with STAGE_3D in site/me/me.js (a test checks they match).
const BOOTHS = {
  'find-the-pea': () => import('./booths/find-the-pea.js'),
  'ring-toss': () => import('./booths/ring-toss.js'),
  'high-striker': () => import('./booths/high-striker.js'),
  'shooting-gallery': () => import('./booths/shooting-gallery.js'),
  'milk-bottle-knockdown': () => import('./booths/milk-bottle-knockdown.js'),
  'balloon-darts': () => import('./booths/balloon-darts.js'),
  'skee-ball': () => import('./booths/skee-ball.js'),
  'dunk-tank': () => import('./booths/dunk-tank.js'),
  'water-gun-race': () => import('./booths/water-gun-race.js'),
  'goldfish-bowl-toss': () => import('./booths/goldfish-bowl-toss.js'),
  'rigged-hoop': () => import('./booths/rigged-hoop.js'),
  'plinko': () => import('./booths/plinko.js'),
  'big-six': () => import('./booths/big-six.js'),
  'duck-pond': () => import('./booths/duck-pond.js'),
  'derby-race': () => import('./booths/derby-race.js'),
  'coin-pusher': () => import('./booths/coin-pusher.js'),
  'knife-thrower': () => import('./booths/knife-thrower.js'),
  'whac-a-mole': () => import('./booths/whac-a-mole.js'),
  'claw-machine': () => import('./booths/claw-machine.js'),
  'buzz-wire': () => import('./booths/buzz-wire.js'),
  'frog-bog': () => import('./booths/frog-bog.js'),
  'rope-ladder-climb': () => import('./booths/rope-ladder-climb.js'),
  'guess-the-jar': () => import('./booths/guess-the-jar.js'),
  'test-your-grip': () => import('./booths/test-your-grip.js'),
  'hall-of-mirrors': () => import('./booths/hall-of-mirrors.js')
};
export const BOOTH_IDS = Object.keys(BOOTHS);

export function supported() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of [].concat(kids)) if (k) n.append(k);
  return n;
}

// Opens a booth. `play(choice)` must return the server's result (a promise); `onResult(r)` runs once per play,
// even if the member leaves mid-animation; `message(r)` words the result for the status line.
export async function openBooth({ game, play, onResult, message, onClose = () => {} }) {
  const load = BOOTHS[game.id];
  if (!load) throw new Error(`No 3D booth for ${game.id}`);
  const { create } = await load();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const low = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const audio = createAudio();
  let left = game.playsMax - game.playsUsed;
  let busy = false;
  let closed = false;

  // ---------------------------------------------------------------- HUD
  const titleId = `mw-stage-h-${game.id}`;
  const leftLine = el('p', { class: 'mw-stage-left' });
  const status = el('p', { class: 'mw-stage-status', role: 'status' });
  const hint = el('p', { class: 'mw-stage-hint' });
  const controls = el('div', { class: 'mw-stage-controls', role: 'group', 'aria-label': game.choice ? game.choice.label : game.name });
  const toast = el('div', { class: 'mw-toast', 'aria-hidden': 'true' });
  const view = el('div', { class: 'mw-stage-view' });
  const oddsRows = (Array.isArray(game.odds) ? game.odds : Object.entries(game.odds).map(([row, tiers]) => ({ label: `${row[0].toUpperCase()}${row.slice(1)} row: ringer`, chance: tiers.at(-1).chance, pay: tiers.at(-1).pay })))
    .slice().reverse();
  const odds = el('div', { class: 'mw-stage-odds', id: `mw-odds-${game.id}`, hidden: true }, el('table', { class: 'mw-odds' }, [
    el('thead', {}, el('tr', {}, [el('th', { scope: 'col', text: 'Result' }), el('th', { scope: 'col', text: 'Chance' }), el('th', { scope: 'col', text: 'Slivers' })])),
    el('tbody', {}, oddsRows.map((o) => el('tr', {}, [el('td', { text: o.label }), el('td', { text: `${o.chance}%` }), el('td', { text: String(o.pay) })])))
  ]));
  const oddsBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Odds', 'aria-expanded': 'false', 'aria-controls': odds.id });
  oddsBtn.addEventListener('click', () => {
    odds.hidden = !odds.hidden;
    oddsBtn.setAttribute('aria-expanded', String(!odds.hidden));
  });
  const soundBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': String(!audio.muted), text: audio.muted ? 'Sound off' : 'Sound on' });
  soundBtn.addEventListener('click', () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    soundBtn.textContent = audio.muted ? 'Sound off' : 'Sound on';
    soundBtn.setAttribute('aria-pressed', String(!audio.muted));
  });
  const leave = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Leave the booth' });
  const dialog = el('dialog', { class: 'mw-stage', 'aria-labelledby': titleId }, [
    el('div', { class: 'mw-stage-top' }, [
      el('div', {}, [el('h2', { id: titleId, text: game.name }), leftLine]),
      el('div', { class: 'mw-stage-tools' }, [oddsBtn, soundBtn, leave])
    ]),
    odds,
    el('div', { class: 'mw-stage-frame' }, [view, toast]),
    el('div', { class: 'mw-stage-bottom' }, [hint, controls, status])
  ]);
  leave.addEventListener('click', () => dialog.close());
  document.body.append(dialog);
  dialog.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  dialog.addEventListener('keydown', () => audio.unlock(), { capture: true });

  // ---------------------------------------------------------------- renderer and scene
  const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'mw-canvas';
  view.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.char);
  scene.fog = new THREE.Fog(PALETTE.char, 5, 11);
  const envTex = environment(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 40);

  scene.add(new THREE.AmbientLight(0xffe2c4, 0.12));
  scene.add(new THREE.HemisphereLight(0x6b3a36, 0x0c0607, 0.45));
  const spot = new THREE.SpotLight(PALETTE.tungsten, 22, 9, 0.5, 0.65, 1.6);
  spot.position.set(0.2, 4.2, 1.6);
  spot.castShadow = true;
  spot.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  spot.shadow.bias = -0.0004;
  scene.add(spot, spot.target);

  const mats = materials({ low });
  const motes = dustMotes(low ? 90 : 180);
  scene.add(motes.points);

  // ---------------------------------------------------------------- animation helpers for the booths
  const started = performance.now();
  let time = 0;
  const tweens = new Set();
  function tween(ms, fn, ease = easeInOut) {
    if (reduced || closed || ms <= 0) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => tweens.add({ start: time, dur: ms / 1000, fn, ease, resolve }));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, closed ? 0 : reduced ? Math.min(ms, 400) : ms));
  let shaking = null;
  const camBase = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 44, fovPortrait: 58, dolly: 1.15 };
  const camTarget = new THREE.Vector3();

  // Meshy props (site/assets/midway/<game>/<prop>.glb, see scripts/meshy-manifest.json). Each is loaded once per
  // stage and cloned for repeats; a missing or broken file resolves to null and the booth keeps its own props.
  const loader = new GLTFLoader();
  const loaded = new Map();
  function prop(path, { size = 1, axis = null, anchor = 'center', shadows = true } = {}) {
    if (!loaded.has(path)) loaded.set(path, loader.loadAsync(`/assets/midway/${path}.glb`).then((g) => g.scene, () => null));
    return loaded.get(path).then((src) => {
      if (!src || closed) return null;
      const obj = src.clone(true);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = true; } });
      return wrap(fitProp(obj, { size, axis, anchor }));
    });
  }

  // The win flourish: Sliver coins (the Meshy token) spring up from the booth and tumble back down.
  const coins = [];
  async function coinShower(at, count) {
    if (reduced || closed || !at) return;
    const base = await prop('shared/sliver-coin', { size: 0.09 });
    if (!base) return;
    for (let i = 0; i < count; i++) {
      const c = i ? base.clone(true) : base;
      c.position.copy(at);
      const a = ctx.rand() * Math.PI * 2;
      c.userData.v = new THREE.Vector3(Math.cos(a) * (0.4 + ctx.rand() * 0.6), 2 + ctx.rand() * 1.4, Math.sin(a) * 0.3);
      c.userData.spin = (ctx.rand() - 0.5) * 18;
      c.userData.life = 1.6;
      scene.add(c);
      coins.push(c);
    }
  }

  const ctx = {
    THREE, scene, camera, mats, audio, tween, sleep, reduced, low, kit: { lathe, mesh }, prop,
    rand: mulberry32(Math.floor(Math.random() * 2 ** 31)),
    camTarget,
    camBase,
    canvas: renderer.domElement,
    request: (choice) => go(choice),
    shake(ms = 450, amount = 0.05) { if (!reduced) shaking = { start: time, dur: ms / 1000, amount }; },
    setHint(text) { hint.textContent = text || ''; }
  };
  const booth = create(ctx, game);
  Object.assign(camBase, booth.camera);
  camBase.pos = new THREE.Vector3(...booth.camera.pos);
  camBase.target = new THREE.Vector3(...booth.camera.target);
  camTarget.copy(camBase.target);

  // ---------------------------------------------------------------- sizing (portrait phones widen the view)
  function resize() {
    const w = view.clientWidth || 1;
    const h = view.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? camBase.fovPortrait : camBase.fov;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(view);

  // ---------------------------------------------------------------- the frame loop
  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    // Tweens follow the wall clock, so a slow phone sees fewer frames but the same timing;
    // drifting things (dust, sparks) use a capped step so a stall never makes them jump.
    const dt = Math.min(clock.getDelta(), 0.05);
    time = (performance.now() - started) / 1000;
    for (const tw of tweens) {
      const t = Math.min(1, (time - tw.start) / tw.dur);
      tw.fn(tw.ease(t));
      if (t >= 1) {
        tweens.delete(tw);
        tw.resolve();
      }
    }
    if (!reduced) {
      spot.target.position.set(Math.sin(time * 0.45) * 0.35, 0.6, Math.cos(time * 0.3) * 0.15);
      motes.update(dt * 60);
    }
    booth.update?.(dt, time);
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.userData.v.y -= 6 * dt;
      c.position.addScaledVector(c.userData.v, dt);
      c.rotation.x += c.userData.spin * dt;
      c.rotation.y += c.userData.spin * 0.6 * dt;
      c.userData.life -= dt;
      if (c.userData.life <= 0) {
        scene.remove(c);
        coins.splice(i, 1);
      }
    }
    // camera: base position (pulled back in portrait), a slow breath, and any shake
    const portrait = camera.aspect < 1;
    const pos = camBase.pos.clone().sub(camBase.target).multiplyScalar(portrait ? camBase.dolly : 1).add(camBase.target);
    if (!reduced) {
      pos.y += Math.sin(time * 0.8) * 0.012;
      pos.x += Math.sin(time * 0.37) * 0.01;
    }
    if (shaking) {
      const t = (time - shaking.start) / shaking.dur;
      if (t >= 1) shaking = null;
      else {
        const [sx, sy] = shakeAt(t, shaking.amount);
        pos.x += sx;
        pos.y += sy;
      }
    }
    camera.position.copy(pos);
    camera.lookAt(camTarget);
    if (!document.hidden) renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- picking (tap a shell, a row…)
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  function choiceAt(e) {
    if (!booth.pickables?.length) return undefined;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObjects(booth.pickables, true)) {
      for (let o = hit.object; o; o = o.parent) if (o.userData.choice !== undefined) return o.userData.choice;
    }
    return undefined;
  }
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
    down = null;
    const c = choiceAt(e);
    if (c !== undefined) go(c);
  });
  renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || busy) return;
    const c = choiceAt(e);
    renderer.domElement.classList.toggle('pick', c !== undefined && left > 0);
    booth.hover?.(c);
  });

  // ---------------------------------------------------------------- playing
  const buttons = (booth.controls || []).map((c) => {
    const b = el('button', { type: 'button', class: `btn ${c.primary ? 'btn-gold' : 'btn-ghost'} mw-stage-btn` }, [
      el('strong', { text: c.label }), c.sub ? el('span', { class: 'meta', text: c.sub }) : null
    ]);
    // steering buttons (the claw's gantry) move things without playing
    b.addEventListener('click', () => (c.steer ? booth.steer?.(c.choice) : go(c.choice)));
    return b;
  });
  // A booth can ask for a number instead of (or as well as) buttons: Guess the Jar.
  if (booth.input) {
    const { label, min, max, button } = booth.input;
    const id = `mw-input-${game.id}`;
    const field = el('input', { type: 'number', id, min: String(min), max: String(max), step: '1', inputmode: 'numeric', class: 'mw-stage-input', required: true });
    const submit = el('button', { type: 'submit', class: 'btn btn-gold mw-stage-btn' }, el('strong', { text: button }));
    const form = el('form', { class: 'mw-stage-form' }, [el('label', { for: id, text: `${label} (${min}–${max})` }), field, submit]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Number(field.value);
      if (!Number.isInteger(n) || n < min || n > max) {
        status.textContent = `Pick a whole number from ${min} to ${max}.`;
        field.focus();
        return;
      }
      go(String(n));
    });
    controls.append(form);
    buttons.push(submit, field);
  }
  controls.append(...buttons.filter((b) => !b.closest('form')));
  function refresh() {
    leftLine.textContent = left > 0 ? `${left} of ${game.playsMax} ${game.playsMax === 1 ? 'play' : 'plays'} left today` : 'No plays left today. The booth reopens at midnight Eastern.';
    for (const b of buttons) b.disabled = busy || left <= 0;
  }
  let toastTimer = 0;
  function showToast(r) {
    clearTimeout(toastTimer);
    toast.textContent = r.totalPayout ? `+${r.totalPayout} Sliver${r.totalPayout === 1 ? '' : 's'}${r.sweepBonus ? ' · Sweep!' : ''}` : 'No prize';
    toast.className = `mw-toast show ${r.totalPayout ? 'win' : 'miss'}`;
    toastTimer = setTimeout(() => { toast.className = 'mw-toast'; }, 2200);
  }

  async function go(choice) {
    if (busy || left <= 0 || closed) return;
    busy = true;
    refresh();
    status.textContent = booth.waiting || 'The barker takes your Sliver…';
    let reported = false;
    const report = (r) => {
      if (reported) return;
      reported = true;
      onResult(r);
    };
    const pending = play(choice);
    // If the member leaves mid-animation, the result still reaches the Ticket Booth.
    pending.then((r) => { if (closed) report(r); }, () => {});
    try {
      const r = await booth.play(choice, pending);
      if (closed) return;
      report(r);
      left = r.playsMax - r.playsUsed;
      showToast(r);
      if (r.totalPayout) {
        audio.win(r.totalPayout >= 40);
        coinShower(booth.winPoint?.(r), Math.min(14, 3 + Math.ceil(r.totalPayout / 5)));
      } else audio.lose();
      status.textContent = message(r);
      await sleep(1400);
      if (!closed) await booth.reset?.({ more: left > 0 });
    } catch (err) {
      status.textContent = err.message || 'Something went wrong. Try again.';
      if (!closed) await booth.reset?.({ more: true, failed: true });
    }
    busy = false;
    if (!closed) {
      refresh();
      if (left <= 0) ctx.setHint('That\'s all for today. Back at midnight Eastern.');
    }
  }

  // ---------------------------------------------------------------- open and close
  dialog.addEventListener('close', () => {
    closed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    for (const tw of tweens) tw.resolve();
    tweens.clear();
    clearTimeout(toastTimer);
    booth.dispose?.();
    disposeTree(scene);
    for (const m of Object.values(mats)) if (m?.isMaterial) m.dispose();
    envTex.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    audio.close();
    dialog.remove();
    onClose();
  });

  refresh();
  dialog.showModal();
  resize();
  frame();
  // The controls wait until the intro (the shuffle) has finished.
  if (left > 0 && booth.intro) {
    busy = true;
    refresh();
    await booth.intro();
    busy = false;
    if (!closed) refresh();
  }
  return dialog;
}
