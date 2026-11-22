// Test Your Grip: an oak-and-brass strength tester with a big glass-fronted dial. Squeeze: the handles
// draw together, the needle shivers up the scale and settles in the rolled band, or slams past the top
// and shatters the dial glass.
import { THREE } from '../kit.js';
import { room, bulbs, meshy, particles, v3 } from './common.js';

// where the needle settles, as a fraction of the scale (picked at random inside the band)
export const BAND = { 'cold-fish': [0.06, 0.24], firm: [0.34, 0.56], crusher: [0.66, 0.88], shattered: [1, 1] };
const SWEEP = Math.PI * 1.4; // the dial's arc
const DIAL = [0, 1.57, -0.43]; // over the painted dial on the Meshy tester

export function create(ctx) {
  const { scene, mats, kit, tween, sleep, audio } = ctx;
  room(ctx, { curtainZ: -1.2 });
  bulbs(ctx, { y: 2.2, z: -0.95 });
  const cabinet = kit.mesh(new THREE.BoxGeometry(0.6, 1.7, 0.3), mats.oak);
  cabinet.position.set(0, 0.85, -0.6);
  scene.add(cabinet);
  meshy(ctx, 'test-your-grip/tester', { size: 1.75, axis: 'y', anchor: 'base' }, cabinet, (m) => { m.position.set(0, 0, -0.6); scene.add(m); });

  // the dial: a painted face with coloured bands, brass bezel, glass, needle
  const dial = new THREE.Group();
  dial.position.set(...DIAL);
  dial.scale.setScalar(1.36);
  const canvas = typeof document === 'object' ? Object.assign(document.createElement('canvas'), { width: 256, height: 256 }) : null;
  let faceMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 });
  if (canvas) {
    const g = canvas.getContext('2d');
    g.fillStyle = '#e8dcc0';
    g.fillRect(0, 0, 256, 256);
    const bands = [['#6a8aa8', 0, 0.3], ['#7aa85a', 0.3, 0.6], ['#d0902a', 0.6, 0.9], ['#a8202a', 0.9, 1]];
    for (const [col, a, b] of bands) {
      g.strokeStyle = col;
      g.lineWidth = 26;
      g.beginPath();
      g.arc(128, 128, 96, Math.PI / 2 + (Math.PI * 2 - SWEEP) / 2 + SWEEP * a, Math.PI / 2 + (Math.PI * 2 - SWEEP) / 2 + SWEEP * b);
      g.stroke();
    }
    g.fillStyle = '#2a1a14';
    g.font = 'bold 22px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('GRIP-O-METER', 128, 190);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  }
  const face = kit.mesh(new THREE.CircleGeometry(0.22, 48), faceMat, { cast: false });
  const bezel = kit.mesh(new THREE.TorusGeometry(0.225, 0.02, 10, 48), mats.brass);
  const glassMat = mats.glass(0xeaf4f0);
  const pane = kit.mesh(new THREE.CircleGeometry(0.22, 48), glassMat, { cast: false });
  pane.position.z = 0.03;
  const needle = new THREE.Group();
  const blade = kit.mesh(new THREE.BoxGeometry(0.012, 0.18, 0.006), new THREE.MeshStandardMaterial({ color: 0x1a0e0a, roughness: 0.4 }));
  blade.position.y = 0.08;
  const pin = kit.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), mats.brass);
  pin.rotation.x = Math.PI / 2;
  needle.add(blade, pin);
  needle.position.z = 0.012;
  dial.add(face, bezel, pane, needle);
  scene.add(dial);
  const angleAt = (u) => SWEEP / 2 - SWEEP * u; // 0 = far left, 1 = far right (rotation.z)
  needle.rotation.z = angleAt(0);

  // the glass shards, hidden until the dial shatters
  const shards = [];
  for (let i = 0; i < 14; i++) {
    const s = kit.mesh(new THREE.CircleGeometry(0.05, 3), glassMat, { cast: false });
    s.visible = false;
    s.userData.v = v3((ctx.rand() - 0.5) * 1.2, ctx.rand() * 1.2, 0.5 + ctx.rand());
    scene.add(s);
    shards.push(s);
  }

  // the two grip handles
  const handles = [-1, 1].map((side) => {
    const h = kit.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 12), mats.brass);
    h.rotation.z = Math.PI / 2;
    h.position.set(side * 0.06, 1.0, -0.38);
    scene.add(h);
    return h;
  });
  const sparks = particles(ctx);
  let level = 0;
  let shattered = false;

  return {
    camera: { pos: [0.15, 1.35, 0.85], target: [0, 1.3, -0.45], fov: 46, fovPortrait: 68, dolly: 1.2 },
    controls: [{ label: 'Squeeze!', choice: null, primary: true }],
    pickables: [...handles],
    waiting: 'You grip the handles…',
    winPoint: () => (level >= 0.34 ? dial.position.clone() : null),
    intro() { ctx.setHint('Squeeze the handles. Firm pays, a crusher pays well, and shattering the dial is the jackpot.'); },
    async play(choice, pending) {
      const r = await pending;
      const [lo, hi] = BAND[r.outcomeTier];
      const end = lo + (hi - lo) * ctx.rand();
      audio.spring();
      await tween(250, (t) => handles.forEach((h, i) => { h.position.x = (i ? 1 : -1) * (0.06 - 0.035 * t); }));
      // the needle overshoots a little and shivers back, unless it is going all the way
      const over = r.outcomeTier === 'shattered' ? 1.08 : Math.min(1, end + 0.08);
      await tween(900, (t) => { needle.rotation.z = angleAt(over * t + (ctx.reduced ? 0 : Math.sin(t * 50) * 0.006)); }, (t) => 1 - (1 - t) ** 2);
      if (r.outcomeTier === 'shattered') {
        shattered = true;
        level = 1;
        audio.knock(1.2);
        audio.bell();
        pane.visible = false;
        ctx.shake(450, 0.04);
        shards.forEach((s) => { s.visible = true; s.position.copy(dial.position).add(v3((ctx.rand() - 0.5) * 0.3, (ctx.rand() - 0.5) * 0.3, 0.04)); });
        sparks.fire(dial.position.clone().add(v3(0, 0, 0.05)), { count: 80, colors: [0xffffff, 0xffd36b], speed: 1.2, up: 0.8, seconds: 0.9 });
        await tween(700, (t) => shards.forEach((s) => { s.position.addScaledVector(s.userData.v, 0.016); s.userData.v.y -= 0.12; s.rotation.x += 0.2; s.rotation.y += 0.15; }), (t) => t);
        shards.forEach((s) => { s.visible = false; });
      } else {
        await tween(400, (t) => { needle.rotation.z = angleAt(over + (end - over) * t); });
        level = end;
        audio.knock(0.4);
        if (r.outcomeTier === 'cold-fish') audio.lose();
      }
      await tween(250, (t) => handles.forEach((h, i) => { h.position.x = (i ? 1 : -1) * (0.025 + 0.035 * t); }));
      return r;
    },
    async reset() {
      await sleep(300);
      await tween(400, (t) => { needle.rotation.z = angleAt(level * (1 - t)); });
      shards.forEach((s) => { s.userData.v.set((ctx.rand() - 0.5) * 1.2, ctx.rand() * 1.2, 0.5 + ctx.rand()); });
      pane.visible = true;
      level = 0;
      shattered = false;
    },
    update(dt) { sparks.update(dt); },
    _state: () => ({ level, shattered, needle: (SWEEP / 2 - needle.rotation.z) / SWEEP })
  };
}
