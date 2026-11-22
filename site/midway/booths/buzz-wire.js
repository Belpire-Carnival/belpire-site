// Buzz Wire: a twisted copper wire over a mahogany box with a red warning bulb. Start the run and the brass
// wand loop travels the wire; it buzzes and sparks at the point the server rolled, or rings clean at the end.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

const BASE_Y = 0.95;
// how far along the wire the run ends, by tier (a range, picked at random inside it)
export const REACH = { early: [0.08, 0.3], halfway: [0.42, 0.6], almost: [0.78, 0.94], clean: [1, 1] };
const RUN_MS = 3200;

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.2 });
  bulbs(ctx, { y: 2.0, z: -0.9 });
  const table = kit.mesh(new THREE.BoxGeometry(1.6, BASE_Y - 0.1, 0.8), mats.walnut);
  table.position.set(0, (BASE_Y - 0.1) / 2, -0.25);
  scene.add(table);
  const box = kit.mesh(new THREE.BoxGeometry(1.2, 0.1, 0.3), mats.walnut);
  box.position.set(0, BASE_Y - 0.05, -0.25);
  scene.add(box);
  meshy(ctx, 'buzz-wire/base', { size: 0.34, axis: 'y', anchor: 'base' }, null, (m) => { m.position.set(0.72, BASE_Y - 0.1, -0.45); scene.add(m); });
  // the warning bulb
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2020, emissiveIntensity: 0.1, roughness: 0.2 });
  const warn = kit.mesh(new THREE.SphereGeometry(0.04, 16, 12), bulbMat);
  warn.position.set(-0.55, BASE_Y + 0.05, -0.2);
  const warnLight = new THREE.PointLight(0xff3030, 0, 1.2);
  warnLight.position.copy(warn.position);
  scene.add(warn, warnLight);

  // the twisted wire: a wavy spline between two brass posts
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push(new THREE.Vector3(-0.5 + t, BASE_Y + 0.18 + Math.sin(t * Math.PI * 3) * 0.08 + Math.sin(t * Math.PI * 7) * 0.025, -0.25 + Math.sin(t * Math.PI * 2) * 0.06));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const wire = kit.mesh(new THREE.TubeGeometry(curve, 160, 0.004, 6), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3 }));
  const posts = [pts[0], pts.at(-1)].map((p) => {
    const post = kit.mesh(new THREE.CylinderGeometry(0.012, 0.012, p.y - BASE_Y, 8), mats.brass);
    post.position.set(p.x, (p.y + BASE_Y) / 2, p.z);
    return post;
  });
  scene.add(wire, ...posts);

  // the wand: loop around the wire, handle hanging toward the player
  const wand = new THREE.Group();
  const loop = kit.mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 20), mats.brass);
  const rod = kit.mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6), mats.brass);
  rod.position.set(0, -0.07, 0.03);
  rod.rotation.x = 0.4;
  const handle = kit.mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 10), mats.walnut);
  handle.position.set(0, -0.16, 0.07);
  handle.rotation.x = 0.4;
  wand.add(loop, rod, handle);
  wand.scale.setScalar(1.5);
  scene.add(wand);
  meshy(ctx, 'buzz-wire/wand', { size: 0.24, axis: 'y' }, [loop, rod, handle], (m) => { m.position.set(0, -0.1, 0.03); m.rotation.x = 0.35; wand.add(m); });
  const sparks = particles(ctx);
  const tangent = new THREE.Vector3();
  const place = (u) => {
    const p = curve.getPointAt(Math.min(1, Math.max(0, u)));
    curve.getTangentAt(Math.min(1, Math.max(0, u)), tangent);
    wand.position.copy(p);
    wand.lookAt(p.clone().add(tangent));
    wand.rotateY(Math.PI / 2);
  };
  place(0);
  let reached = 0;
  let buzzed = false;

  return {
    camera: { pos: [0.05, 1.38, 0.72], target: [0, 1.12, -0.25], fov: 44, fovPortrait: 66, dolly: 1.2 },
    controls: [{ label: 'Start the run', choice: null, primary: true }],
    pickables: [wand],
    waiting: 'Steady hands…',
    winPoint: () => (reached > 0 ? wand.position.clone() : null),
    intro() { ctx.setHint('Guide the loop along the wire without touching it. The further you get, the more it pays.'); },
    async play(choice, pending) {
      const r = await pending;
      const [lo, hi] = REACH[r.outcomeTier];
      const end = lo + (hi - lo) * ctx.rand();
      reached = end;
      await tween(RUN_MS * Math.max(0.25, end), (t) => {
        place(end * t);
        // a nervous little tremble
        if (!ctx.reduced) wand.position.y += Math.sin(t * 90) * 0.0015;
      }, (t) => t);
      if (r.outcomeTier === 'clean') {
        audio.bell();
        sparks.fire(wand.position, { count: 60, speed: 1, up: 1, seconds: 0.9 });
      } else {
        buzzed = true;
        audio.spring();
        audio.lose();
        sparks.fire(wand.position, { count: 40, colors: [0xffffff, 0x9fd8ff, 0xffd36b], speed: 1.1, up: 0.6, seconds: 0.5, size: 0.02 });
        await tween(600, (t) => { bulbMat.emissiveIntensity = 0.1 + 3 * Math.abs(Math.sin(t * Math.PI * 3)); warnLight.intensity = 3 * Math.abs(Math.sin(t * Math.PI * 3)); });
      }
      return r;
    },
    async reset() {
      await sleep(250);
      bulbMat.emissiveIntensity = 0.1;
      warnLight.intensity = 0;
      buzzed = false;
      reached = 0;
      place(0);
    },
    update(dt) { sparks.update(dt); },
    _state: () => ({ reached, buzzed, at: wand.position.clone(), end: curve.getPointAt(Math.min(1, reached)) })
  };
}
