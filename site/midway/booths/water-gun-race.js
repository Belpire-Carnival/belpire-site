// Water Gun Race: four brass water pistols aimed at four painted clown mouths, each with a balloon above.
// Fire to start the three-second race; the balloons swell in the server's finishing order and the winner pops.
import { THREE } from '../kit.js';
import { raceProgress } from '../choreo.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

const LANE_X = [-0.66, -0.22, 0.22, 0.66];
const FACE = { y: 1.25, z: -0.55 };
const RACE_MS = 3000;
const COLORS = [0x8e1b2b, 0x1f7a4a, 0xb5651d, 0x3a2a6b];

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -0.9 });
  bulbs(ctx, { y: 2.2, z: -0.7 });
  const back = kit.mesh(new THREE.BoxGeometry(2.0, 1.3, 0.05), mats.walnut);
  back.position.set(0, 1.4, -0.68);
  const counter = kit.mesh(new THREE.BoxGeometry(2.2, 0.9, 0.5), mats.walnut);
  counter.position.set(0, 0.45, 1.0);
  scene.add(back, counter);

  const faces = [];
  const balloons = [];
  const pistols = [];
  const streams = [];
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.7 });
  const streamMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.55, emissive: 0x204050, roughness: 0.1 });
  LANE_X.forEach((x, i) => {
    const face = new THREE.Group();
    face.position.set(x, FACE.y, FACE.z);
    const disc = kit.mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 28), faceMat);
    disc.rotation.x = Math.PI / 2;
    const mouth = kit.mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 20), mats.velvet);
    mouth.position.set(0, -0.05, 0.03);
    face.add(disc, mouth);
    face.userData.stand = [disc, mouth];
    scene.add(face);
    faces.push(face);
    const balloon = kit.mesh(new THREE.SphereGeometry(0.1, 20, 16), new THREE.MeshPhysicalMaterial({ color: COLORS[i], roughness: 0.15, clearcoat: 1 }));
    balloon.position.set(x, FACE.y + 0.28, FACE.z + 0.04);
    balloon.scale.setScalar(0.2);
    scene.add(balloon);
    balloons.push(balloon);
    const pistol = new THREE.Group();
    pistol.position.set(x, 0.98, 0.95);
    const barrel = kit.mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.24, 10), mats.brass);
    barrel.rotation.x = Math.PI / 2;
    pistol.add(barrel);
    pistol.userData.stand = barrel;
    pistol.lookAt(x, FACE.y - 0.05, FACE.z);
    scene.add(pistol);
    pistols.push(pistol);
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 1, 8, 1, true), streamMat);
    stream.visible = false;
    scene.add(stream);
    streams.push(stream);
  });
  meshy(ctx, 'water-gun-race/clown-head', { size: 0.34 }, faces.flatMap((f) => f.userData.stand), (m) => {
    faces.forEach((f, i) => f.add(i ? m.clone(true) : m));
  });
  meshy(ctx, 'water-gun-race/pistol', { size: 0.3 }, pistols.map((p) => p.userData.stand), (m) => {
    pistols.forEach((p, i) => { const c = i ? m.clone(true) : m; c.rotation.y = Math.PI / 2; p.add(c); });
  });
  const pop = particles(ctx, 120);

  // a stream from the pistol tip to the clown's mouth
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  function aimStream(i, wobble) {
    a.set(LANE_X[i], 1.02, 0.85);
    b.set(LANE_X[i] + wobble, FACE.y - 0.05, FACE.z + 0.04);
    const s = streams[i];
    s.position.copy(a).lerp(b, 0.5);
    s.scale.set(1, a.distanceTo(b), 1);
    s.lookAt(b);
    s.rotateX(Math.PI / 2);
  }

  let order = null;
  let lane = 1;
  return {
    camera: { pos: [0, 1.5, 2.6], target: [0, 1.2, -0.4], fov: 42, fovPortrait: 62, dolly: 1.25 },
    controls: [{ label: 'Pull the trigger', choice: null, primary: true }],
    pickables: pistols,
    waiting: 'The race is on…',
    winPoint: () => (order && order[0] === lane ? balloons[lane - 1].position.clone() : null),
    intro() { ctx.setHint('Fill your balloon first. Your gun is marked when the race starts.'); },
    async play(choice, pending) {
      const r = await pending;
      lane = r.visualParams.lane;
      const place = r.visualParams.place;
      // the other three lanes finish in a random order around the member's place
      const others = [1, 2, 3, 4].filter((l) => l !== lane).sort(() => ctx.rand() - 0.5);
      order = [...others];
      order.splice(place - 1, 0, lane);
      pistols[lane - 1].scale.setScalar(1.15);
      ctx.setHint(`You're on gun ${lane}. Go!`);
      streams.forEach((s) => { s.visible = !ctx.reduced; });
      audio.slide();
      await tween(RACE_MS, (t) => {
        const p = raceProgress(order, t);
        p.forEach((v, i) => {
          balloons[i].scale.setScalar(0.2 + v * 0.95);
          if (!ctx.reduced) aimStream(i, Math.sin(t * 40 + i) * 0.01);
        });
      }, (t) => t);
      streams.forEach((s) => { s.visible = false; });
      const winner = order[0] - 1;
      balloons[winner].visible = false;
      audio.knock(1.2);
      pop.fire(balloons[winner].position, { count: 90, colors: [COLORS[winner], 0xffd36b, 0xffffff], speed: 1.5, up: 1.2, seconds: 1 });
      await sleep(350);
      return r;
    },
    async reset() {
      await sleep(250);
      balloons.forEach((bl) => { bl.visible = true; bl.scale.setScalar(0.2); });
      pistols.forEach((p) => p.scale.setScalar(1));
      order = null;
    },
    update(dt) { pop.update(dt); },
    _state: () => ({ order: order && [...order], lane, popped: balloons.findIndex((bl) => !bl.visible) + 1 })
  };
}
