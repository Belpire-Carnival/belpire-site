// Derby Race: a four-lane mechanical horse track with brass rails. Pick a horse; all four clockwork horses
// gallop for four seconds to a photo finish that matches the server's order.
import { THREE } from '../kit.js';
import { raceProgress } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

const LANE_Z = [-0.15, -0.38, -0.61, -0.84];
const START_X = -0.95;
const FINISH_X = 0.95;
const TRACK_Y = 0.92;
const RACE_MS = 4000;
const SILKS = [0x8e1b2b, 0x1f7a4a, 0xb5651d, 0x3a2a6b];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.4 });
  bulbs(ctx, { y: 1.95, z: -1.1 });
  const bed = kit.mesh(new THREE.BoxGeometry(2.3, 0.08, 1.0), mats.walnut);
  bed.position.set(0, TRACK_Y - 0.05, -0.5);
  const legs = kit.mesh(new THREE.BoxGeometry(2.25, TRACK_Y - 0.1, 0.95), mats.charcoal);
  legs.position.set(0, (TRACK_Y - 0.1) / 2, -0.5);
  scene.add(bed, legs);
  LANE_Z.forEach((z, i) => {
    const rail = kit.mesh(new THREE.BoxGeometry(2.1, 0.012, 0.02), mats.brass);
    rail.position.set(0, TRACK_Y, z);
    const num = kit.mesh(new THREE.CircleGeometry(0.035, 20), new THREE.MeshStandardMaterial({ color: SILKS[i], emissive: SILKS[i], emissiveIntensity: 0.3 }));
    num.rotation.x = -Math.PI / 2;
    num.position.set(START_X - 0.12, TRACK_Y + 0.002, z);
    scene.add(rail, num);
  });
  const finish = kit.mesh(new THREE.BoxGeometry(0.015, 0.006, 0.95), new THREE.MeshStandardMaterial({ color: 0xf0e2c0, emissive: 0x8a7050 }));
  finish.position.set(FINISH_X + 0.06, TRACK_Y + 0.003, -0.5);
  const posts = [-0.02, -0.98].map((z) => {
    const p = kit.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8), mats.brass);
    p.position.set(FINISH_X + 0.06, TRACK_Y + 0.17, z);
    return p;
  });
  scene.add(...posts);
  scene.add(finish);

  const horses = LANE_Z.map((z, i) => {
    const g = new THREE.Group();
    const body = kit.mesh(new THREE.BoxGeometry(0.16, 0.07, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.4 }));
    body.position.y = 0.12;
    const saddle = kit.mesh(new THREE.BoxGeometry(0.05, 0.02, 0.055), new THREE.MeshStandardMaterial({ color: SILKS[i] }));
    saddle.position.y = 0.165;
    const pole = kit.mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 6), mats.brass);
    pole.position.y = 0.06;
    g.add(body, saddle, pole);
    g.userData = { stand: [body], choice: String(i + 1) };
    g.position.set(START_X, TRACK_Y, z);
    scene.add(g);
    return g;
  });
  meshy(ctx, 'derby-race/horse', { size: 0.22, axis: 'y', anchor: 'base' }, horses.flatMap((h) => h.userData.stand), (m) => {
    horses.forEach((h, i) => { const c = i ? m.clone(true) : m; c.rotation.y = Math.PI / 2; h.add(c); });
  });
  const flash = new THREE.PointLight(0xffffff, 0, 3);
  flash.position.set(FINISH_X, TRACK_Y + 0.6, 0);
  scene.add(flash);
  const confetti = particles(ctx);
  let order = null;
  let picked = 1;

  return {
    camera: { pos: [0, 1.75, 1.45], target: [0, 0.9, -0.5], fov: 50, fovPortrait: 72, dolly: 1.3 },
    controls: [1, 2, 3, 4].map((n) => ({ label: `Horse ${n}`, choice: String(n), primary: false })),
    pickables: horses,
    waiting: 'And they\'re off…',
    winPoint: () => (order && order[0] === picked ? horses[picked - 1].position.clone() : null),
    intro() { ctx.setHint('Pick your horse: tap one or use the buttons.'); },
    hover(choice) { horses.forEach((h) => h.scale.setScalar(h.userData.choice === choice ? 1.12 : 1)); },
    async play(choice, pending) {
      picked = Number(choice);
      horses[picked - 1].scale.setScalar(1.15);
      const r = await pending;
      order = r.visualParams.order;
      audio.spring();
      await tween(RACE_MS, (t) => {
        const p = raceProgress(order, t);
        horses.forEach((h, i) => {
          h.position.x = START_X + (FINISH_X - START_X) * p[i];
          h.position.y = TRACK_Y + Math.abs(Math.sin(t * 40 + i)) * 0.012 * (p[i] < 1 ? 1 : 0);
          h.rotation.z = Math.sin(t * 40 + i) * 0.05 * (p[i] < 1 ? 1 : 0);
        });
        if (Math.floor(t * 20) !== Math.floor((t - 0.02) * 20)) audio.knock(0.15);
      }, (t) => t);
      // photo finish
      flash.intensity = 30;
      audio.clink(1);
      await tween(300, (t) => { flash.intensity = 30 * (1 - t); });
      if (order[0] === picked) confetti.fire(horses[picked - 1].position.clone().add(v3(0, 0.2, 0)), { count: 70, colors: [SILKS[picked - 1], 0xffd36b], speed: 1.2, up: 1.3, seconds: 1 });
      return r;
    },
    async reset() {
      await sleep(500);
      horses.forEach((h) => { h.position.x = START_X; h.rotation.z = 0; h.scale.setScalar(1); });
      order = null;
    },
    update(dt) { confetti.update(dt); },
    _state: () => ({
      // lanes in the order they sit across the line, front-runner first
      finishOrder: horses.map((h, i) => [i + 1, h.position.x]).sort((a, b) => b[1] - a[1]).map(([lane]) => lane),
      order: order && [...order]
    })
  };
}
