// Pieces every 3D booth reuses: the room (floor, curtain, bulb strings, a warm wash), Meshy props with a
// procedural fallback, thrown objects on an arc, and one small particle system for sparks, confetti and splashes.
import { THREE } from '../kit.js';
import { arcPoint } from '../choreo.js';

export function room(ctx, { curtainZ = -1.6, curtainY = 2, floorY = 0, wash = [0, 1.9, -0.6] } = {}) {
  const { scene, mats, kit } = ctx;
  const floor = kit.mesh(new THREE.PlaneGeometry(14, 14), mats.charcoal, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  const curtain = kit.mesh(new THREE.PlaneGeometry(10, 5), mats.velvet, { cast: false });
  curtain.position.set(0, curtainY, curtainZ);
  scene.add(floor, curtain);
  if (wash) {
    const light = new THREE.PointLight(0xffb46b, 3, 4.5, 1.8);
    light.position.set(...wash);
    scene.add(light);
  }
  return { floor, curtain };
}

// A sagging string of warm bulbs between two x positions.
export function bulbs(ctx, { y = 1.95, z = -1.0, x0 = -1.1, x1 = 1.1, n = 11, sag = 0.1 } = {}) {
  const geo = new THREE.SphereGeometry(0.03, 10, 8);
  const group = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const b = ctx.kit.mesh(geo, ctx.mats.bulb, { cast: false });
    b.position.set(x0 + (x1 - x0) * t, y - Math.sin(t * Math.PI) * sag, z);
    group.add(b);
  }
  ctx.scene.add(group);
  return group;
}

// Loads a Meshy prop; when it arrives, hides the procedural stand-ins and hands the model to `place`.
// Resolves to the model (or null when it is missing, so the stand-ins stay).
export function meshy(ctx, path, opts, standIns, place) {
  if (!ctx.prop) return Promise.resolve(null);
  return ctx.prop(path, opts).then((m) => {
    if (!m) return null;
    for (const s of [].concat(standIns || [])) if (s) s.visible = false;
    place(m);
    return m;
  });
}

// Swaps every material on a model (used for glass props, which Meshy textures as opaque).
export function setMaterial(obj, material) {
  obj.traverse((o) => { if (o.isMesh) o.material = material; });
  return obj;
}

// Tints every material on a model (clones them first, so other copies keep their colour).
export function tint(obj, color, emissive = 0x000000) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.color?.set(color);
    o.material.emissive?.set(emissive);
  });
  return obj;
}

// Moves an object from `a` to `b` on an arc, spinning it as it goes.
export function fly(ctx, obj, a, b, { height = 0.3, ms = 600, spin = [0, 0, 0], ease = (t) => t } = {}) {
  const start = obj.rotation.clone();
  return ctx.tween(ms, (t) => {
    obj.position.set(...arcPoint(a, b, height, t));
    obj.rotation.set(start.x + spin[0] * t, start.y + spin[1] * t, start.z + spin[2] * t);
  }, ease);
}

// Particles: fire(at, { count, color, speed, up, gravity, life, size }) and update(dt) from the booth's update.
export function particles(ctx, max = 160) {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  ctx.scene.add(points);
  let life = 0;
  let total = 1;
  let gravity = 4.5;
  const c = new THREE.Color();
  return {
    fire(at, { count = 40, colors = [0xffd36b], speed = 1.6, up = 1.2, spread = 1, g = 4.5, seconds = 1, size = 0.03 } = {}) {
      if (ctx.reduced) return;
      const n = Math.min(max, count);
      for (let i = 0; i < n; i++) {
        pos.set([at.x, at.y, at.z], i * 3);
        const a = ctx.rand() * Math.PI * 2;
        const s = speed * (0.4 + ctx.rand() * 0.8);
        vel.set([Math.cos(a) * s * spread, up * (0.4 + ctx.rand()), Math.sin(a) * s * 0.6], i * 3);
        c.set(colors[i % colors.length]);
        col.set([c.r, c.g, c.b], i * 3);
      }
      geo.setDrawRange(0, n);
      geo.attributes.color.needsUpdate = true;
      mat.size = size;
      gravity = g;
      life = total = seconds;
    },
    update(dt) {
      if (life <= 0) return;
      life = Math.max(0, life - dt);
      const n = geo.drawRange.count;
      for (let i = 0; i < n; i++) {
        vel[i * 3 + 1] -= gravity * dt;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = life / total;
    },
    get active() { return life > 0; }
  };
}

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
