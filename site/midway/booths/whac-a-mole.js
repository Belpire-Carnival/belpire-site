// Whac-A-Mole: a 3x3 brass-rimmed cabinet of clockwork moles on springs. Start the round: four seconds of
// moles popping up and the padded mallet coming down, and the tally lands on the server's count (with the
// golden mole if it was rolled).
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, tint, v3 } from './common.js';

const TOP_Y = 0.95;
const HOLE = (i) => [(i % 3 - 1) * 0.26, TOP_Y, -0.2 + (Math.floor(i / 3) - 1) * 0.24];
const ROUND_MS = 4000;

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.2 });
  bulbs(ctx, { y: 1.95, z: -0.9 });
  const cab = kit.mesh(new THREE.BoxGeometry(0.95, TOP_Y, 0.9), mats.walnut);
  cab.position.set(0, TOP_Y / 2, -0.2);
  const top = kit.mesh(new THREE.BoxGeometry(0.97, 0.03, 0.92), mats.charcoal);
  top.position.set(0, TOP_Y, -0.2);
  const back = kit.mesh(new THREE.BoxGeometry(0.97, 0.5, 0.05), mats.walnut);
  back.position.set(0, TOP_Y + 0.25, -0.67);
  scene.add(cab, top, back);
  // the scoreboard
  const digits = [];
  const board = new THREE.Group();
  board.position.set(0, TOP_Y + 0.33, -0.64);
  for (let i = 0; i < 2; i++) {
    const d = kit.mesh(new THREE.PlaneGeometry(0.1, 0.16), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb46b, emissiveIntensity: 0.9 }), { cast: false });
    d.position.x = (i - 0.5) * 0.12;
    board.add(d);
    digits.push(d);
  }
  scene.add(board);
  let score = 0;
  const scoreCanvas = typeof document === 'object' ? Object.assign(document.createElement('canvas'), { width: 128, height: 64 }) : null;
  const scoreTex = scoreCanvas ? new THREE.CanvasTexture(scoreCanvas) : null;
  if (scoreTex) {
    digits.forEach((d) => { d.visible = false; });
    const plate = kit.mesh(new THREE.PlaneGeometry(0.26, 0.13), new THREE.MeshStandardMaterial({ map: scoreTex, emissive: 0xffffff, emissiveMap: scoreTex, emissiveIntensity: 0.8 }), { cast: false });
    board.add(plate);
  }
  const showScore = (n) => {
    score = n;
    if (!scoreCanvas) return;
    const g = scoreCanvas.getContext('2d');
    g.fillStyle = '#160c0e';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#ffd36b';
    g.font = 'bold 52px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(String(n).padStart(2, '0'), 64, 52);
    scoreTex.needsUpdate = true;
  };
  showScore(0);

  const holeGeo = new THREE.TorusGeometry(0.085, 0.012, 8, 28);
  const moleMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.6 });
  const moles = [];
  for (let i = 0; i < 9; i++) {
    const [x, y, z] = HOLE(i);
    const ring = kit.mesh(holeGeo, mats.brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + 0.016, z);
    const pit = kit.mesh(new THREE.CircleGeometry(0.075, 24), mats.charcoal, { cast: false });
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(x, y + 0.017, z);
    scene.add(ring, pit);
    const mole = new THREE.Group();
    const body = kit.mesh(new THREE.CapsuleGeometry(0.05, 0.06, 6, 12), moleMat);
    body.position.y = 0.06;
    mole.add(body);
    mole.userData = { stand: body, up: 0, x, z };
    mole.position.set(x, y - 0.14, z);
    scene.add(mole);
    moles.push(mole);
  }
  const golden = moles[4];
  meshy(ctx, 'whac-a-mole/mole', { size: 0.16, axis: 'y', anchor: 'base' }, moles.map((m) => m.userData.stand), (m) => {
    moles.forEach((mo, i) => mo.add(i ? m.clone(true) : m));
  });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 1, roughness: 0.2, emissive: 0x5a3a08 });

  const mallet = new THREE.Group();
  const head = kit.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 16), mats.velvet);
  head.rotation.z = Math.PI / 2;
  const handle = kit.mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.35, 8), mats.walnut);
  handle.position.set(0.17, 0.1, 0);
  handle.rotation.z = -1.1;
  mallet.add(head, handle);
  mallet.position.set(0.35, TOP_Y + 0.35, 0.3);
  scene.add(mallet);
  meshy(ctx, 'whac-a-mole/mallet', { size: 0.4 }, [head, handle], (m) => { m.rotation.z = Math.PI; mallet.add(m); });
  const stars = particles(ctx);

  let goldenShown = false;
  return {
    camera: { pos: [0, 1.75, 1.0], target: [0, 0.95, -0.25], fov: 46, fovPortrait: 66, dolly: 1.25 },
    controls: [{ label: 'Start the round', choice: null, primary: true }],
    pickables: [...moles],
    waiting: 'Moles at the ready…',
    winPoint: () => v3(0, TOP_Y + 0.3, -0.2),
    intro() { ctx.setHint('Four seconds of moles. Every round pays; a golden mole means the top prize.'); },
    async play(choice, pending) {
      const r = await pending;
      const { hits, golden: isGolden } = r.visualParams;
      showScore(0);
      // a schedule of whacks spread over the round; the golden mole, if any, comes last
      const times = Array.from({ length: hits }, (_, i) => (i + 0.5) / hits);
      let next = 0;
      const pops = new Set();
      await tween(ROUND_MS, (t) => {
        while (next < hits && t >= times[next]) {
          const last = next === hits - 1;
          const plain = moles.filter((m) => m !== golden);
          const mole = last && isGolden ? golden : plain[Math.floor(ctx.rand() * plain.length)];
          if (last && isGolden) {
            goldenShown = true;
            golden.traverse((o) => { if (o.isMesh) { o.userData.mat = o.userData.mat || o.material; o.material = goldMat; } });
          }
          mole.userData.up = 1;
          pops.add(mole);
          mallet.position.set(mole.userData.x + 0.05, TOP_Y + 0.2, mole.userData.z + 0.05);
          mallet.userData.swing = 1;
          showScore(next + 1);
          audio.knock(last && isGolden ? 1.2 : 0.7);
          if (last && isGolden) stars.fire(golden.position.clone().add(v3(0, 0.25, 0)), { count: 70, speed: 1, up: 1.2, seconds: 0.9 });
          next++;
        }
      }, (t) => t);
      showScore(hits);
      return r;
    },
    async reset() {
      await sleep(400);
      for (const m of moles) m.userData.up = 0;
      if (goldenShown) golden.traverse((o) => { if (o.isMesh && o.userData.mat) o.material = o.userData.mat; });
      goldenShown = false;
      showScore(0);
    },
    update(dt, t) {
      stars.update(dt);
      for (const m of moles) {
        // idle bobbing in and out; a whacked mole drops back down
        const idle = ctx.reduced ? 0 : Math.max(0, Math.sin(t * 2.3 + m.userData.x * 9 + m.userData.z * 5)) * 0.1;
        const target = m.userData.up ? 0.12 : idle;
        m.position.y += ((TOP_Y - 0.14 + target) - m.position.y) * Math.min(1, dt * 14);
        if (m.userData.up) m.userData.up = Math.max(0, m.userData.up - dt * 3);
      }
      if (mallet.userData.swing) {
        mallet.userData.swing = Math.max(0, mallet.userData.swing - dt * 5);
        mallet.rotation.x = -0.9 * mallet.userData.swing;
      }
    },
    _state: () => ({ score, golden: goldenShown })
  };
}
