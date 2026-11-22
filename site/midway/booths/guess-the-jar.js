// Guess the Jar: a wide clear counting jar packed with Sliver coins on a velvet plinth. Type a guess and
// submit; the camera walks once round the jar, the brass lid lifts, and the tally board counts up to the
// real number the server rolled.
import { THREE } from '../kit.js';
import { room, bulbs, particles, v3 } from './common.js';
import { mulberry32 } from '../choreo.js';

const BASE = { x: 0, y: 0.9, z: -0.3 }; // the plinth top, where the jar stands
// The Meshy jar (largest side 1, base at 0) at this height: a straight body 0.29 x H in radius up to the
// shoulder, the brass lid above LID_CUT. The stand-in jar matches it.
const H = 0.62;
const INNER_R = 0.29 * H - 0.012;
const FILL_TOP = 0.62 * H;
const LID_CUT = 0.81 * H; // the model has a clean gap between the neck threads and the lid here
const COIN = 0.05; // coin diameter

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.3 });
  bulbs(ctx, { y: 2.15, z: -1.0 });
  const plinth = kit.mesh(new THREE.CylinderGeometry(0.3, 0.34, BASE.y, 40), mats.velvet);
  plinth.position.set(BASE.x, BASE.y / 2, BASE.z);
  const cap = kit.mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 40), mats.brass);
  cap.position.set(BASE.x, BASE.y, BASE.z);
  scene.add(plinth, cap);
  const floorY = BASE.y + 0.015;
  // a warm key light on the jar so the glass catches highlights and the coins read
  const key = new THREE.SpotLight(0xffe2b8, 5, 5, 0.42, 0.55, 1.2);
  key.position.set(0.7, 2.3, 1.0);
  key.target.position.set(BASE.x, BASE.y + 0.25, BASE.z);
  const rim = new THREE.PointLight(0xffc98a, 1.2, 2.5);
  rim.position.set(-0.6, 1.6, -0.9);
  scene.add(key, key.target, rim);

  // the stand-in jar: clear body, brass screw lid (hidden when the Meshy jar arrives)
  // crystal-clear glass: no tint, almost no roughness, thin walls (the slivers have to read through it)
  const glass = ctx.low
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, roughness: 0.02, metalness: 0, depthWrite: false })
    : new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: 0.004, roughness: 0.02, ior: 1.45, specularIntensity: 0.7, envMapIntensity: 0.8 });
  const R = 0.29 * H;
  const body = kit.mesh(kit.lathe([[0, 0], [R - 0.02, 0], [R, 0.02], [R, LID_CUT - 0.07], [R - 0.05, LID_CUT - 0.02], [R - 0.06, LID_CUT]], 48), glass, { cast: false });
  body.position.set(BASE.x, floorY, BASE.z);
  const lid = new THREE.Group();
  const lidRim = kit.mesh(new THREE.CylinderGeometry(R - 0.045, R - 0.045, 0.06, 40), mats.brass);
  lidRim.position.y = 0.03;
  const knob = kit.mesh(new THREE.SphereGeometry(0.025, 16, 12), mats.brass);
  knob.position.y = 0.08;
  lid.add(lidRim, knob);
  const lidHome = v3(BASE.x, floorY + LID_CUT, BASE.z);
  lid.position.copy(lidHome);
  scene.add(body, lid);
  const lidTop = floorY + H;

  if (ctx.prop) {
    ctx.prop('guess-the-jar/jar', { size: H, axis: 'y', anchor: 'base' }).then((m) => {
      if (!m) return;
      m.position.set(BASE.x, floorY, BASE.z);
      scene.add(m);
      m.updateMatrixWorld(true);
      // split every mesh at the shoulder: glass below, brass above (moved into our lid group so it lifts)
      const meshes = [];
      m.traverse((o) => { if (o.isMesh) meshes.push(o); });
      const p = new THREE.Vector3();
      for (const o of meshes) {
        const g = o.geometry;
        const pos = g.attributes.position;
        const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
        const below = [];
        const above = [];
        for (let i = 0; i < idx.length; i += 3) {
          let y = 0;
          for (let k = 0; k < 3; k++) y += p.fromBufferAttribute(pos, idx[i + k]).applyMatrix4(o.matrixWorld).y;
          (y / 3 - floorY > LID_CUT ? above : below).push(idx[i], idx[i + 1], idx[i + 2]);
        }
        const bodyGeo = g.clone();
        bodyGeo.setIndex(below);
        const lidGeo = g.clone();
        lidGeo.setIndex(above);
        // the model ships as bare positions (no normals): smooth them so the glass and brass catch light
        bodyGeo.computeVertexNormals();
        lidGeo.computeVertexNormals();
        o.geometry = bodyGeo;
        o.material = glass;
        o.castShadow = false;
        const top = new THREE.Mesh(lidGeo, mats.brightBrass);
        top.castShadow = true;
        o.matrixWorld.decompose(top.position, top.quaternion, top.scale);
        top.position.sub(lidHome);
        lid.add(top);
      }
      body.visible = false;
      lidRim.visible = false;
      knob.visible = false;
    });
  }

  // the Slivers: one instanced coin, packed against the glass in rings, a looser core, a heaped top
  const spots = [];
  {
    const rand = mulberry32(11);
    const dy = ctx.low ? 0.026 : 0.016;
    const ringR = INNER_R - COIN * 0.3;
    const perRing = Math.floor((2 * Math.PI * ringR) / (COIN * 0.72));
    let layer = 0;
    for (let y = COIN * 0.3; y < FILL_TOP - COIN * 0.4; y += dy, layer++) {
      for (let i = 0; i < perRing; i++) {
        // a jumble, not a pattern: each coin shifted, turned and tipped its own way
        const a = ((i + rand()) / perRing) * Math.PI * 2;
        spots.push({ a, r: ringR - rand() * 0.012, y: y + (rand() - 0.5) * dy, tilt: rand() * 1.4, roll: (rand() - 0.5) * 2.4, yaw: (rand() - 0.5) * 1.2 });
      }
      if (!ctx.low && layer % 2 === 0) {
        for (let i = 0; i < 8; i++) spots.push({ a: (i / 8) * Math.PI * 2 + layer, r: ringR * 0.5, y, tilt: rand() * 0.8, roll: rand() * 6 });
      }
    }
    // the heaped top: rough hex rings, rising a little to the middle
    for (const [r, n] of [[0, 1], [COIN * 0.9, 6], [COIN * 1.8, 12], [COIN * 2.6, 17]]) {
      if (r > ringR) continue;
      for (let i = 0; i < n; i++) {
        spots.push({ a: (i / n) * Math.PI * 2 + rand() * 0.3, r, y: FILL_TOP - COIN * 0.4 + (1 - r / ringR) * 0.025 + rand() * 0.006, tilt: rand() * 0.35, roll: rand() * 6, top: true });
      }
    }
  }
  const coinMatrix = (s, m4) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.top ? s.tilt : Math.PI / 2 - s.tilt, -s.a + Math.PI / 2 + (s.yaw || 0), s.roll, 'YXZ'));
    return m4.compose(v3(BASE.x + Math.cos(s.a) * s.r, floorY + s.y, BASE.z + Math.sin(s.a) * s.r), q, v3(1, 1, 1));
  };
  // The coins: a slim brass disc with the Sliver art on both faces (two designs, one instanced mesh each),
  // light enough to pack a jar full on a phone.
  const coinGeo = new THREE.CylinderGeometry(COIN / 2, COIN / 2, 0.006, 24);
  const faceMats = ['gold', 'the-big-tent'].map(() => mats.brightBrass);
  if (typeof document === 'object') {
    const loader = new THREE.TextureLoader();
    ['gold-256', 'the-big-tent-128'].forEach((name, i) => {
      const map = loader.load(`/assets/slivers/${name}.webp`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
      faceMats[i] = new THREE.MeshStandardMaterial({ map, metalness: 0.3, roughness: 0.4, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.28 });
    });
  }
  // the heart of the pile: a dark brassy core so gaps between coins show more coins, not the room
  const core = kit.mesh(new THREE.CylinderGeometry(INNER_R - COIN * 0.55, INNER_R - COIN * 0.55, FILL_TOP - COIN * 0.3, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x6a4a18, metalness: 0.6, roughness: 0.55 }), { cast: false });
  core.position.set(BASE.x, floorY + (FILL_TOP - COIN * 0.3) / 2, BASE.z);
  scene.add(core);
  const m4 = new THREE.Matrix4();
  [0, 1].forEach((design) => {
    const mine = spots.filter((_, i) => (i % 5 === 0) === (design === 1));
    const inst = new THREE.InstancedMesh(coinGeo, [mats.brightBrass, faceMats[design], faceMats[design]], mine.length);
    mine.forEach((s, i) => inst.setMatrixAt(i, coinMatrix(s, m4)));
    inst.receiveShadow = true;
    scene.add(inst);
  });

  // the tally board
  const board = new THREE.Group();
  board.position.set(0.55, 1.42, -0.55);
  board.rotation.y = -0.35;
  const frame = kit.mesh(new THREE.BoxGeometry(0.42, 0.3, 0.03), mats.walnut);
  board.add(frame);
  const canvas = typeof document === 'object' ? Object.assign(document.createElement('canvas'), { width: 256, height: 180 }) : null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = kit.mesh(new THREE.PlaneGeometry(0.38, 0.26), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7 }), { cast: false });
    face.position.z = 0.016;
    board.add(face);
  }
  scene.add(board);
  let shown = null;
  let guessed = null;
  const draw = (guess, count) => {
    guessed = guess;
    shown = count;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    g.fillStyle = '#160c0e';
    g.fillRect(0, 0, 256, 180);
    g.fillStyle = '#c9b48a';
    g.textAlign = 'center';
    g.font = '18px Georgia, serif';
    g.fillText('YOUR GUESS', 128, 32);
    g.fillText('SLIVERS IN THE JAR', 128, 112);
    g.fillStyle = '#ffd36b';
    g.font = 'bold 44px Georgia, serif';
    g.fillText(guess == null ? '—' : String(guess), 128, 78);
    g.fillText(count == null ? '???' : String(count), 128, 158);
    tex.needsUpdate = true;
  };
  draw(null, null);
  const sparkle = particles(ctx);
  const base = ctx.camBase;
  let home = null;

  return {
    camera: { pos: [-0.15, 1.5, 1.3], target: [0.12, 1.2, -0.35], fov: 44, fovPortrait: 64, dolly: 1.2 },
    controls: [],
    input: { label: 'How many Slivers are in the jar?', min: 100, max: 500, button: 'Submit guess' },
    pickables: [],
    waiting: 'The barker starts counting…',
    winPoint: () => v3(BASE.x, lidTop + 0.05, BASE.z),
    intro() {
      if (base) home = { pos: base.pos.clone(), target: base.target.clone() };
      ctx.setHint('Guess how many Slivers are in the jar. Within 20 pays; dead on pays big.');
    },
    async play(choice, pending) {
      const guess = Number(choice);
      draw(guess, null);
      const r = await pending;
      const { actual } = r.visualParams;
      // one slow walk round the jar while the barker counts
      if (home && !ctx.reduced) {
        const c = v3(BASE.x, 0, BASE.z);
        const off = home.pos.clone().sub(c);
        const look = v3(BASE.x, floorY + H * 0.45, BASE.z);
        await tween(1800, (t) => {
          const a = Math.PI * 2 * t;
          base.pos.set(c.x + off.x * Math.cos(a) - off.z * Math.sin(a), home.pos.y, c.z + off.x * Math.sin(a) + off.z * Math.cos(a));
          base.target.copy(home.target).lerp(look, Math.sin(Math.PI * t));
          ctx.camTarget.copy(base.target);
        }, (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
        base.pos.copy(home.pos);
        base.target.copy(home.target);
        ctx.camTarget.copy(home.target);
      }
      audio.slide();
      await tween(400, (t) => { lid.position.y = lidHome.y + 0.14 * t; lid.rotation.z = 0.45 * t; });
      await tween(1200, (t) => draw(guess, Math.round(actual * t)), (t) => 1 - (1 - t) ** 3);
      draw(guess, actual);
      if (r.outcomeTier === 'off') audio.lose();
      else {
        audio.bell();
        sparkle.fire(v3(BASE.x, floorY + LID_CUT + 0.05, BASE.z), { count: r.outcomeTier === 'exact' ? 90 : 35, speed: 0.9, up: 1.2, seconds: 0.9 });
      }
      return r;
    },
    async reset() {
      await sleep(300);
      await tween(300, (t) => { lid.position.y = lidHome.y + 0.14 * (1 - t); lid.rotation.z = 0.45 * (1 - t); });
      draw(null, null);
    },
    update(dt) { sparkle.update(dt); },
    _state: () => ({ shown, guessed, coins: spots.length })
  };
}
