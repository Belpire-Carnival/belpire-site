// Duck Pond: an illuminated circular trough with twelve weathered rubber ducks bobbing on the current. Tap a
// duck (or let the barker scoop one); it lifts toward you and flips to show the mark on its base.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

const N = 12;
const POND = { y: 0.85, r: 0.55 };
const CURRENT = 0.25; // radians a second

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.4 });
  bulbs(ctx, { y: 1.9, z: -0.9 });
  const trough = kit.mesh(new THREE.TorusGeometry(POND.r, 0.12, 14, 64), mats.walnut);
  trough.rotation.x = Math.PI / 2;
  trough.position.y = POND.y - 0.06;
  trough.scale.z = 0.5;
  const water = kit.mesh(new THREE.RingGeometry(POND.r - 0.1, POND.r + 0.1, 64), new THREE.MeshStandardMaterial({ color: 0x1a4a5a, emissive: 0x0a2a3a, roughness: 0.05, metalness: 0.2 }), { cast: false });
  water.rotation.x = -Math.PI / 2;
  water.position.y = POND.y - 0.02;
  const island = kit.mesh(new THREE.CylinderGeometry(POND.r - 0.12, POND.r - 0.08, 0.2, 40), mats.velvet);
  island.position.y = POND.y - 0.08;
  const base = kit.mesh(new THREE.CylinderGeometry(POND.r + 0.18, POND.r + 0.22, POND.y - 0.1, 40), mats.walnut);
  base.position.y = (POND.y - 0.1) / 2;
  const rimLights = new THREE.Group();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const b = kit.mesh(new THREE.SphereGeometry(0.018, 8, 6), mats.bulb, { cast: false });
    b.position.set(Math.cos(a) * (POND.r + 0.16), POND.y + 0.02, Math.sin(a) * (POND.r + 0.16));
    rimLights.add(b);
  }
  scene.add(trough, water, island, base, rimLights);

  const ducks = [];
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd9a830, roughness: 0.8 });
  for (let i = 0; i < N; i++) {
    const g = new THREE.Group();
    const body = kit.mesh(new THREE.SphereGeometry(0.05, 16, 12), yellow);
    body.scale.set(1.2, 0.8, 1);
    const head = kit.mesh(new THREE.SphereGeometry(0.03, 12, 10), yellow);
    head.position.set(0.04, 0.05, 0);
    g.add(body, head);
    g.userData = { stand: [body, head], a: (i / N) * Math.PI * 2, choice: String(i + 1) };
    scene.add(g);
    ducks.push(g);
  }
  meshy(ctx, 'duck-pond/duck', { size: 0.12, axis: 'y', anchor: 'base' }, ducks.flatMap((d) => d.userData.stand), (m) => {
    ducks.forEach((d, i) => { const c = i ? m.clone(true) : m; c.position.y = -0.04; c.rotation.y = -Math.PI / 2; d.add(c); });
  });

  // the marks on the bases
  const marks = {
    blank: null,
    'red-dot': () => kit.mesh(new THREE.CircleGeometry(0.025, 20), new THREE.MeshStandardMaterial({ color: 0xb01c2c, emissive: 0x400000 })),
    'silver-star': () => {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.014 : 0.034;
        const a = (i / 10) * Math.PI * 2;
        s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      return kit.mesh(new THREE.ShapeGeometry(s), new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.25 }));
    },
    'gold-crown': () => {
      const c = new THREE.Group();
      const band = kit.mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 20, 1, true), mats.gold);
      band.rotation.x = Math.PI / 2;
      c.add(band);
      for (let i = 0; i < 5; i++) {
        const p = kit.mesh(new THREE.ConeGeometry(0.007, 0.022, 6), mats.gold);
        const a = (i / 5) * Math.PI * 2;
        p.position.set(Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0.012);
        p.rotation.x = Math.PI / 2;
        c.add(p);
      }
      return c;
    }
  };
  const sparks = particles(ctx);
  let scooped = null;
  let shown = null;
  let mark = null;
  let time = 0;
  const place = (d, t) => {
    const a = d.userData.a + t * CURRENT;
    d.position.set(Math.cos(a) * POND.r, POND.y + Math.sin(t * 2.4 + d.userData.a * 3) * 0.006, Math.sin(a) * POND.r);
    d.rotation.y = -a;
  };
  ducks.forEach((d) => place(d, 0));

  return {
    camera: { pos: [0, 1.6, 1.6], target: [0, 0.85, -0.05], fov: 44, fovPortrait: 64, dolly: 1.2 },
    controls: [{ label: 'Scoop a duck', choice: null, primary: true }],
    pickables: ducks,
    waiting: 'You reach for a duck…',
    winPoint: () => (scooped && shown !== 'blank' ? scooped.position.clone() : null),
    intro() { ctx.setHint('Tap a duck, or let the barker scoop one. Red dots, silver stars and gold crowns pay.'); },
    async play(choice, pending) {
      const r = await pending;
      const v = r.visualParams;
      scooped = ducks[v.duck - 1];
      shown = v.mark;
      const from = scooped.position.clone();
      const lift = v3(0, 1.25, 0.75);
      audio.slide();
      await tween(650, (t) => { scooped.position.lerpVectors(from, lift, t); scooped.rotation.x = 0; }, (t) => 1 - (1 - t) ** 3);
      // flip over to show the base
      if (marks[shown]) {
        mark = marks[shown]();
        mark.position.y = -0.042;
        mark.rotation.x = Math.PI / 2;
        scooped.add(mark);
      }
      await tween(420, (t) => { scooped.rotation.x = Math.PI * t; scooped.rotation.y = 0; });
      audio.knock(0.5);
      if (shown !== 'blank') sparks.fire(scooped.position, { count: shown === 'gold-crown' ? 70 : 24, speed: 0.8, up: 0.8, seconds: 0.8 });
      return r;
    },
    async reset() {
      await sleep(400);
      if (mark) { scooped.remove(mark); mark = null; }
      if (scooped) scooped.rotation.x = 0;
      scooped = null;
      shown = null;
    },
    update(dt) {
      sparks.update(dt);
      if (!ctx.reduced) time += dt;
      for (const d of ducks) if (d !== scooped) place(d, time);
    },
    _state: () => ({ duck: scooped ? ducks.indexOf(scooped) + 1 : null, mark: shown, flipped: scooped ? scooped.rotation.x > 3 : false })
  };
}
