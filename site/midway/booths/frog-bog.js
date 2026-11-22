// Frog Bog: a slowly turning pond of lily pads around a brass-crowned centre pad. Strike the springboard;
// the rubber frog tumbles through the air and lands on an outer pad, an inner pad, the crown, or in the drink.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, fly, particles, v3 } from './common.js';

const POND = { x: 0, y: 0.8, z: -0.45, r: 0.6 };
const TURN = 0.18;
export const RING = { outer: 0.45, inner: 0.24, crown: 0 };
const LAUNCH = [0, 0.95, 0.55];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.4 });
  bulbs(ctx, { y: 1.9, z: -1.1 });
  const tub = kit.mesh(new THREE.CylinderGeometry(POND.r + 0.08, POND.r + 0.12, POND.y, 48), mats.walnut);
  tub.position.set(POND.x, POND.y / 2, POND.z);
  const water = kit.mesh(new THREE.CircleGeometry(POND.r, 48), new THREE.MeshStandardMaterial({ color: 0x14383a, emissive: 0x051a1a, roughness: 0.05, metalness: 0.2 }), { cast: false });
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND.x, POND.y + 0.001, POND.z);
  scene.add(tub, water);

  // the turning pads
  const pond = new THREE.Group();
  pond.position.set(POND.x, POND.y + 0.006, POND.z);
  scene.add(pond);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.7 });
  const pads = { outer: [], inner: [], crown: [] };
  const pad = (r, size, ring) => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, size, 0.35, Math.PI * 2 - 0.05, false);
    shape.lineTo(0, 0);
    const p = kit.mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false }), padMat);
    p.rotation.x = -Math.PI / 2;
    return p;
  };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = pad(RING.outer, 0.075);
    p.position.set(Math.cos(a) * RING.outer, 0, Math.sin(a) * RING.outer);
    pond.add(p);
    pads.outer.push(p);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const p = pad(RING.inner, 0.065);
    p.position.set(Math.cos(a) * RING.inner, 0, Math.sin(a) * RING.inner);
    pond.add(p);
    pads.inner.push(p);
  }
  const crown = pad(0, 0.08);
  pond.add(crown);
  pads.crown.push(crown);
  const crownRing = kit.mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24), mats.gold);
  crownRing.rotation.x = Math.PI / 2;
  crownRing.position.y = 0.02;
  pond.add(crownRing);

  // the springboard catapult and the frog
  const board = new THREE.Group();
  board.position.set(...LAUNCH).add(v3(0, -0.12, 0));
  const plank = kit.mesh(new THREE.BoxGeometry(0.06, 0.012, 0.3), mats.oak);
  board.add(plank);
  scene.add(board);
  meshy(ctx, 'frog-bog/catapult', { size: 0.34 }, plank, (m) => { m.rotation.y = Math.PI / 2; board.add(m); });
  const frog = new THREE.Group();
  const body = kit.mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2a6a3a, roughness: 0.6 }));
  body.scale.set(1.2, 0.7, 1);
  frog.add(body);
  frog.position.set(...LAUNCH);
  scene.add(frog);
  meshy(ctx, 'frog-bog/frog', { size: 0.09 }, body, (m) => { m.rotation.y = Math.PI; frog.add(m); });
  const splash = particles(ctx);
  let landed = null;
  let spinning = true;

  return {
    camera: { pos: [0, 1.4, 1.1], target: [0, 0.82, -0.3], fov: 44, fovPortrait: 64, dolly: 1.2 },
    controls: [{ label: 'Strike the springboard', choice: null, primary: true }],
    pickables: [board],
    waiting: 'You raise the mallet…',
    winPoint: () => (landed && landed !== 'splash' ? frog.getWorldPosition(new THREE.Vector3()) : null),
    intro() { ctx.setHint('Land the frog on a lily pad. The brass-crowned pad in the middle pays the most.'); },
    async play(choice, pending) {
      const r = await pending;
      const tier = r.outcomeTier;
      audio.knock(1);
      audio.spring();
      await tween(120, (t) => { board.rotation.x = -0.4 * Math.sin(Math.PI * t); });
      let to;
      let target = null;
      if (tier === 'splash') {
        const a = ctx.rand() * Math.PI * 2;
        const rr = (RING.outer + RING.inner) / 2 + 0.02;
        to = v3(POND.x + Math.cos(a) * rr, POND.y, POND.z + Math.sin(a) * rr);
        // nudge off any pad it would otherwise touch
        for (const p of [...pads.outer, ...pads.inner]) {
          const w = p.getWorldPosition(new THREE.Vector3());
          if (w.distanceTo(to) < 0.09) to.add(w.sub(to).setY(0).normalize().multiplyScalar(-0.1));
        }
      } else {
        const list = pads[tier];
        target = list[Math.floor(ctx.rand() * list.length)];
        to = target.getWorldPosition(new THREE.Vector3()).add(v3(0, 0.02, 0));
      }
      spinning = false; // the pond holds still while the frog is in the air, so the landing is true
      await fly(ctx, frog, LAUNCH, [to.x, to.y + 0.02, to.z], { height: 0.45, ms: 700, spin: [Math.PI * 4, 0, 0] });
      frog.rotation.set(0, 0, 0);
      landed = tier;
      if (tier === 'splash') {
        audio.slide();
        splash.fire(to, { count: 60, colors: [0x9fe0e0, 0xffffff], speed: 0.8, up: 1.2, seconds: 0.8 });
        await tween(400, (t) => { frog.position.y = to.y + 0.02 - 0.08 * t; });
      } else {
        audio.knock(0.4);
        pond.attach(frog);
        if (tier === 'crown') splash.fire(to, { count: 60, speed: 1, up: 1.2, seconds: 0.9 });
        await tween(300, (t) => { target.position.y = -0.01 * Math.sin(Math.PI * t); });
      }
      spinning = true;
      return r;
    },
    async reset() {
      await sleep(400);
      scene.attach(frog);
      frog.position.set(...LAUNCH);
      frog.rotation.set(0, 0, 0);
      board.rotation.x = 0;
      landed = null;
    },
    update(dt) {
      splash.update(dt);
      if (spinning && !ctx.reduced) pond.rotation.y += TURN * dt;
    },
    _state: () => {
      const w = frog.getWorldPosition(new THREE.Vector3());
      const dist = Math.hypot(w.x - POND.x, w.z - POND.z);
      return { landed, dist, onPad: frog.parent === pond };
    }
  };
}
