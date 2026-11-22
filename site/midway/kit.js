// Shared look for every 3D booth: procedural PBR materials in the Midway palette (charcoal and burgundy,
// tarnished brass #b8944f, warm tungsten bulbs, velvet, weathered hardwood, coloured glass), a small
// generated reflection environment (no HDRI download), dust motes and a few geometry helpers.
// These are the "procedural fallbacks" from the spec: every booth is playable before any .glb exists.
import * as THREE from '../vendor/three-0.170.0/three.module.min.js';

export { THREE };

export const PALETTE = {
  char: 0x160c0e,
  velvet: 0x241115,
  burgundy: 0x3a0a14,
  brass: 0xb8944f,
  tungsten: 0xffb46b,
  walnut: 0x4a2c1c,
  oak: 0x7a5534,
  iron: 0x2b2a2c
};

// A canvas, in the browser only (tests build scenes in Node, where textures are simply skipped).
function canvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  if (typeof document === 'object') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  return null;
}

// Wood grain: long wavy streaks over a base colour, tileable along its length.
function woodTexture(base, seed = 1) {
  const c = canvas(256, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  const col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, 256, 256);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const y = rnd() * 256;
    const dark = rnd() < 0.6;
    g.strokeStyle = dark ? `rgba(0,0,0,${0.08 + rnd() * 0.18})` : `rgba(255,220,180,${0.03 + rnd() * 0.06})`;
    g.lineWidth = 0.5 + rnd() * 2.2;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin((x / 256) * Math.PI * 2 * (1 + rnd() * 0.2) + i) * (2 + rnd() * 3));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Patina for brass: soft dark blotches so it reads as tarnished, not new.
function patinaTexture() {
  const c = canvas(128, 128);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#bcbcbc';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const r = 4 + Math.random() * 16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${0.15 + Math.random() * 0.25})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// One set of materials per stage, so disposing the stage frees them all.
export function materials({ low = false } = {}) {
  const patina = patinaTexture();
  const made = {
    brass: new THREE.MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.92, roughness: 0.38, roughnessMap: patina }),
    brightBrass: new THREE.MeshStandardMaterial({ color: 0xd9b46a, metalness: 1, roughness: 0.22 }),
    iron: new THREE.MeshStandardMaterial({ color: PALETTE.iron, metalness: 0.85, roughness: 0.55 }),
    walnut: new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTexture(PALETTE.walnut, 7), roughness: 0.62, metalness: 0 }),
    oak: new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTexture(PALETTE.oak, 3), roughness: 0.7, metalness: 0 }),
    velvet: new THREE.MeshPhysicalMaterial({ color: PALETTE.burgundy, roughness: 0.95, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x8a2a40) }),
    charcoal: new THREE.MeshStandardMaterial({ color: PALETTE.char, roughness: 0.92 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: PALETTE.tungsten, emissiveIntensity: 2.2 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 1, roughness: 0.18, emissive: 0x6b4a10, emissiveIntensity: 0.6 }),
    hemp: new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 0.95 })
  };
  made.glass = (color) => (low
    ? new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.72, roughness: 0.08, metalness: 0.1 })
    : new THREE.MeshPhysicalMaterial({ color, transmission: 0.92, thickness: 0.06, roughness: 0.06, ior: 1.5, attenuationColor: new THREE.Color(color), attenuationDistance: 0.25 }));
  if (made.walnut.map) made.walnut.map.repeat.set(2, 1);
  return made;
}

// A dim carnival room with warm bulb strips, rendered once into a PMREM environment for reflections.
export function environment(renderer) {
  const room = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicMaterial({ color: 0x0c0607, side: THREE.BackSide }));
  room.add(box);
  const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.tungsten).multiplyScalar(3) });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), bulb);
    m.position.set(-4 + i, 2.6, -5.5);
    room.add(m);
    const m2 = m.clone();
    m2.position.z = 5.5;
    room.add(m2);
  }
  const soft = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ color: 0x3a1a18 }));
  soft.position.set(0, 2.9, 0);
  soft.rotation.x = Math.PI / 2;
  room.add(soft);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  return tex;
}

// Dust drifting through the spotlight. Returns the Points and an update(dt) function.
export function dustMotes(count, area = [3, 2.4, 2.4], center = [0, 1.4, 0]) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = center[k] + (Math.random() - 0.5) * area[k];
      vel[i * 3 + k] = (Math.random() - 0.5) * 0.02;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  function update(dt) {
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        pos[j] += vel[j] * dt + (k === 1 ? -0.004 * dt : 0);
        const half = area[k] / 2;
        if (pos[j] < center[k] - half) pos[j] += area[k];
        if (pos[j] > center[k] + half) pos[j] -= area[k];
      }
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { points, update };
}

// Lathe from a 2D profile [[radius, height], …].
export const lathe = (profile, segments = 32) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);

export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Frees every geometry, material and texture under an object.
export function disposeTree(root) {
  const seen = new Set();
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}

// Fits a loaded prop: scales it uniformly so its largest side (or the named axis) is `size`, then moves it so
// its bounding box sits where asked ('center' = centred on the origin, 'base' = centred on X/Z, bottom at 0).
export function fitProp(obj, { size = 1, axis = null, anchor = 'center' } = {}) {
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const dims = box.getSize(new THREE.Vector3());
  const span = axis ? dims[axis] : Math.max(dims.x, dims.y, dims.z);
  obj.scale.multiplyScalar(size / (span || 1));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= anchor === 'base' ? box.min.y : c.y;
  return obj;
}

// Wraps a prop so later rotations and fits happen around its own centre.
export function wrap(obj) {
  const g = new THREE.Group();
  g.add(obj);
  return g;
}
