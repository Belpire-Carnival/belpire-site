// Shooting Gallery: tin ducks gliding on a track, a spinning brass bullseye and, now and then, a golden duck.
// Fire the cork rifle; the cork flies to whatever the server rolled (or ricochets off the backplate).
import { THREE } from '../kit.js';
import { room, bulbs, meshy, tint, fly, particles, v3 } from './common.js';

const TRACK_Y = 1.25;
const TRACK_Z = -0.6;
const SPAN = 1.6; // ducks wrap across -SPAN..SPAN
const SPEED = 0.35;
const MUZZLE = [0.28, 1.0, 1.35];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.0 });
  bulbs(ctx, { y: 2.0, z: -0.8 });
  const back = kit.mesh(new THREE.BoxGeometry(3.4, 1.5, 0.05), mats.walnut);
  back.position.set(0, 1.35, -0.85);
  const rail = kit.mesh(new THREE.BoxGeometry(3.4, 0.05, 0.12), mats.brass);
  rail.position.set(0, TRACK_Y - 0.12, TRACK_Z);
  const counter = kit.mesh(new THREE.BoxGeometry(3, 0.9, 0.4), mats.walnut);
  counter.position.set(0, 0.45, 1.25);
  scene.add(back, rail, counter);

  // tin ducks: a flat procedural silhouette until the Meshy duck arrives
  const duckShape = new THREE.Shape();
  duckShape.moveTo(-0.09, 0).lineTo(0.09, 0).quadraticCurveTo(0.12, 0.08, 0.06, 0.1).quadraticCurveTo(0.08, 0.17, 0.02, 0.17)
    .quadraticCurveTo(-0.04, 0.17, -0.02, 0.1).quadraticCurveTo(-0.1, 0.1, -0.09, 0);
  const duckGeo = new THREE.ExtrudeGeometry(duckShape, { depth: 0.015, bevelEnabled: false });
  const tin = new THREE.MeshStandardMaterial({ color: 0xd8cdb4, metalness: 0.6, roughness: 0.45 });
  const ducks = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const flat = kit.mesh(duckGeo, tin);
    g.add(flat);
    g.userData = { flat, x: -SPAN + (i * 2 * SPAN) / 6, down: 0 };
    g.position.set(g.userData.x, TRACK_Y - 0.1, TRACK_Z);
    scene.add(g);
    ducks.push(g);
  }
  const golden = ducks[3];
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 1, roughness: 0.2, emissive: 0x5a3a08 });
  golden.userData.flat.material = goldMat;
  meshy(ctx, 'shooting-gallery/duck', { size: 0.26, axis: 'y', anchor: 'base' }, ducks.map((d) => d.userData.flat), (m) => {
    ducks.forEach((d, i) => {
      const c = i ? m.clone(true) : m;
      if (d === golden) tint(c, 0xffd36b, 0x5a3a08);
      d.add(c);
    });
  });

  // the spinning bullseye
  const eye = new THREE.Group();
  eye.position.set(-0.55, 1.75, -0.78);
  const rings = [0.16, 0.12, 0.08, 0.04].map((r, i) => {
    const m = kit.mesh(new THREE.CylinderGeometry(r, r, 0.02 + i * 0.004, 32), i % 2 ? mats.charcoal : mats.brass);
    m.rotation.x = Math.PI / 2;
    return m;
  });
  eye.add(...rings);
  scene.add(eye);

  // the cork rifle at the counter, and the cork
  const rifle = new THREE.Group();
  rifle.position.set(0.4, 0.98, 1.45);
  const barrel = kit.mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.7, 8), mats.brass);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.25;
  const stock = kit.mesh(new THREE.BoxGeometry(0.06, 0.09, 0.35), mats.walnut);
  stock.position.z = 0.2;
  rifle.add(barrel, stock);
  scene.add(rifle);
  meshy(ctx, 'shooting-gallery/rifle', { size: 0.85 }, [barrel, stock], (m) => {
    m.rotation.y = Math.PI / 2;
    rifle.add(m);
  });
  const cork = kit.mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xa0743f, roughness: 0.9 }));
  cork.visible = false;
  scene.add(cork);
  const fx = particles(ctx);

  let paused = false;
  let hit = null;
  const target = (kind) => {
    if (kind === 'bullseye') return eye.position.clone().add(v3(0, 0, 0.05));
    if (kind === 'golden-duck') return golden.position.clone().add(v3(0, 0.1, 0.03));
    if (kind === 'tin-duck') {
      // the plain duck nearest the middle of the track
      const d = ducks.filter((x) => x !== golden && !x.userData.down).sort((a, b) => Math.abs(a.position.x) - Math.abs(b.position.x))[0];
      return d ? d.position.clone().add(v3(0, 0.1, 0.03)) : v3(0, TRACK_Y, TRACK_Z);
    }
    return v3((ctx.rand() - 0.5) * 2, 1.0 + ctx.rand() * 0.25, -0.82);
  };
  const duckAt = (p) => ducks.reduce((best, d) => (d.position.distanceTo(p) < best.position.distanceTo(p) ? d : best), ducks[0]);

  return {
    camera: { pos: [0.2, 1.35, 2.6], target: [0, 1.3, -0.5], fov: 44, fovPortrait: 62, dolly: 1.2 },
    controls: [{ label: 'Fire the cork rifle', choice: null, primary: true }],
    pickables: [rifle, eye, ...ducks],
    waiting: 'You line up the sights…',
    winPoint: () => (hit ? hit.clone() : null),
    intro() { ctx.setHint('Tin ducks pay a little, the bullseye more, the golden duck the most.'); },
    async play(choice, pending) {
      await tween(200, (t) => { rifle.rotation.x = -0.05 * t; });
      const r = await pending;
      paused = true;
      const to = target(r.outcomeTier);
      hit = to;
      audio.knock(0.6);
      cork.visible = true;
      await tween(90, (t) => { rifle.position.z = 1.45 + 0.05 * Math.sin(Math.PI * t); });
      await fly(ctx, cork, MUZZLE, [to.x, to.y, to.z], { height: 0.04, ms: 280, spin: [8, 0, 0] });
      if (r.outcomeTier === 'miss') {
        audio.clink(0.6);
        fx.fire(to, { count: 18, colors: [0xffd36b, 0xffffff], speed: 0.8, up: 0.6, seconds: 0.5, size: 0.02 });
        await fly(ctx, cork, [to.x, to.y, to.z], [to.x + 0.3, 0.05, to.z + 0.4], { height: 0.2, ms: 420, spin: [4, 3, 0] });
      } else if (r.outcomeTier === 'bullseye') {
        audio.bell();
        fx.fire(to, { count: 30, speed: 1, up: 0.8, seconds: 0.7 });
        await tween(700, (t) => { eye.rotation.z = t * Math.PI * 6; });
      } else {
        const d = duckAt(to);
        d.userData.down = 1;
        audio.knock(1);
        if (r.outcomeTier === 'golden-duck') fx.fire(to, { count: 50, speed: 1.4, up: 1.2, seconds: 0.9 });
        await tween(260, (t) => { d.rotation.x = -Math.PI / 2 * t; }, (t) => t * t);
      }
      cork.visible = false;
      return r;
    },
    async reset() {
      await sleep(250);
      for (const d of ducks) if (d.userData.down) { d.userData.down = 0; d.rotation.x = 0; }
      rifle.rotation.x = 0;
      hit = null;
      paused = false;
    },
    update(dt, t) {
      fx.update(dt);
      if (!ctx.reduced) eye.rotation.z += dt * 0.8;
      if (paused || ctx.reduced) return;
      for (const d of ducks) {
        d.userData.x += SPEED * dt;
        if (d.userData.x > SPAN) d.userData.x -= SPAN * 2;
        d.position.x = d.userData.x;
        d.position.y = TRACK_Y - 0.1 + Math.sin(t * 6 + d.userData.x * 4) * 0.004;
      }
    },
    _state: () => ({ downs: ducks.map((d) => d.userData.down), golden: golden.userData.down, eyeSpun: eye.rotation.z, hit })
  };
}
