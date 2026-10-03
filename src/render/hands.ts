/**
 * First-person hands built in code: gloved palm with knuckle padding, three-segment fingers curled round the grip /
 * handguard, thumb, glove cuff, a camo sleeve with a cuff band and folds, and a watch on the support wrist.
 * Gun-local space: forward -z, up +y, right +x. Vertex-coloured, uv-less (merged into one mesh per arm).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type G = THREE.BufferGeometry;
const GLOVE = 0x2b2a27, KNUCKLE = 0x1b1b19, CUFF = 0x3a3832, WATCH = 0x18191a;
function tint(g: G, hex: number, jitter = 0, seed = 1): G {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
  const p = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    // camo-ish blotches: a cheap 3D hash field over position
    const v = jitter ? (Math.sin(p.getX(i) * 61 + seed) * Math.sin(p.getY(i) * 47 + seed * 2) * Math.sin(p.getZ(i) * 53 + seed * 3)) : 0;
    const k = 1 + v * jitter;
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k * (1 - v * jitter * 0.3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
/** capsule from a to b */
function seg(a: THREE.Vector3, b: THREE.Vector3, r: number, hex: number, r2 = r): G {
  const d = b.clone().sub(a), len = d.length();
  const g = r2 === r ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8) : new THREE.CylinderGeometry(r2, r, len, 9);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tint(g, hex);
}
/** a finger: three segments curling round an axis (centre c, axis dir ax) starting at angle a0, sweeping `sweep` */
function finger(P: G[], c: THREE.Vector3, ax: THREE.Vector3, ref: THREE.Vector3, R: number, a0: number, sweep: number, r: number) {
  const side = new THREE.Vector3().crossVectors(ax, ref).normalize(), up = ref.clone().normalize();
  const at = (a: number) => c.clone().add(up.clone().multiplyScalar(Math.cos(a) * R)).add(side.clone().multiplyScalar(Math.sin(a) * R));
  const lens = [0.42, 0.33, 0.25]; let a = a0;
  for (let i = 0; i < 3; i++) { const b = a + sweep * lens[i]; P.push(seg(at(a), at(b), r * (1 - i * 0.12), i === 0 ? KNUCKLE : GLOVE)); a = b; }
}
/** forearm sleeve from the wrist w back to the elbow e (camo, a cuff band and two fold rings) */
function sleeve(P: G[], w: THREE.Vector3, e: THREE.Vector3, color: number) {
  P.push(tint(seg(w, e, 0.036, color, 0.046), color, 0.22, 3));
  const d = e.clone().sub(w);
  for (const [t, r, hx] of [[0.04, 0.041, CUFF], [0.35, 0.047, color], [0.62, 0.05, color]] as const) {
    const ring = new THREE.TorusGeometry(r, 0.006, 5, 14);
    ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize()));
    const pos = w.clone().add(d.clone().multiplyScalar(t)); ring.translate(pos.x, pos.y, pos.z);
    P.push(tint(ring, hx, hx === CUFF ? 0 : 0.2, 5));
  }
}

/**
 * Trigger hand on a pistol grip at (0, gy, gz): the grip runs down and slightly back; fingers wrap from the right
 * side round the front, thumb over the left; the forearm runs back and down-right out of frame.
 */
export function gripHand(gy: number, gz: number, sleeveColor: number, pistol = false): G {
  const P: G[] = [];
  const c = new THREE.Vector3(0, gy, gz), ax = new THREE.Vector3(0, -1, 0.25).normalize(), R = pistol ? 0.022 : 0.026;
  // palm on the back / right of the grip
  P.push(tint(new RoundedBoxGeometry(0.03, 0.085, 0.07, 2, 0.012).translate(0.03, gy - 0.005, gz + 0.03), GLOVE));
  // index finger along the trigger guard, the other three wrapped
  finger(P, c.clone().add(new THREE.Vector3(0, 0.025, -0.012)), ax, new THREE.Vector3(1, 0, 0), R + 0.012, 0.2, 2.2, 0.0105);
  for (let i = 0; i < 3; i++) finger(P, c.clone().add(new THREE.Vector3(0, -0.006 - i * 0.022, 0.004 * i)), ax, new THREE.Vector3(1, 0, 0), R + 0.011, 0.25, 2.9, 0.011 - i * 0.0008);
  // thumb: up the left side, tip resting by the selector
  P.push(seg(new THREE.Vector3(0.02, gy + 0.02, gz + 0.03), new THREE.Vector3(-0.024, gy + 0.045, gz - 0.005), 0.011, GLOVE));
  P.push(seg(new THREE.Vector3(-0.024, gy + 0.045, gz - 0.005), new THREE.Vector3(-0.03, gy + 0.05, gz - 0.035), 0.0095, KNUCKLE));
  // glove cuff, wrist and sleeve
  const wr = new THREE.Vector3(0.05, gy - 0.03, gz + 0.075);
  P.push(seg(new THREE.Vector3(0.035, gy - 0.02, gz + 0.055), wr, 0.031, CUFF));
  sleeve(P, wr, new THREE.Vector3(0.12, gy - 0.25, gz + 0.36), sleeveColor);
  return mergeGeometries(P)!;
}

/**
 * Support hand with the fist centre at the origin, gripping a handguard that runs along z: palm under / left,
 * fingers wrapping up the right side, thumb over the top; the forearm runs back and down-left. With `watch`.
 */
export function supportHand(sleeveColor: number, pistol = false): G {
  const P: G[] = [];
  const c = new THREE.Vector3(0, 0.012, 0), ax = new THREE.Vector3(0, 0, -1), R = pistol ? 0.02 : 0.024;
  P.push(tint(new RoundedBoxGeometry(0.075, 0.03, 0.08, 2, 0.012).translate(-0.012, -0.022, 0.004), GLOVE)); // palm
  for (let i = 0; i < 4; i++) finger(P, c.clone().add(new THREE.Vector3(0, 0, -0.026 + i * 0.019)), ax, new THREE.Vector3(0, -1, 0), R + 0.011, -0.6, 2.5, 0.0108 - i * 0.0008);
  P.push(seg(new THREE.Vector3(-0.03, -0.005, 0.02), new THREE.Vector3(-0.02, 0.03, -0.015), 0.011, GLOVE)); // thumb over the top
  P.push(seg(new THREE.Vector3(-0.02, 0.03, -0.015), new THREE.Vector3(0.0, 0.04, -0.04), 0.0095, KNUCKLE));
  const wr = new THREE.Vector3(-0.03, -0.03, 0.055);
  P.push(seg(new THREE.Vector3(-0.02, -0.02, 0.035), wr, 0.03, CUFF));
  // watch on the wrist
  const wb = new THREE.TorusGeometry(0.033, 0.007, 5, 14); wb.translate(wr.x - 0.005, wr.y - 0.006, wr.z + 0.012); P.push(tint(wb, WATCH));
  P.push(tint(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 12).rotateZ(Math.PI / 2).translate(wr.x - 0.038, wr.y - 0.004, wr.z + 0.012), WATCH));
  sleeve(P, wr, new THREE.Vector3(pistol ? -0.08 : -0.17, -0.27, 0.27), sleeveColor);
  return mergeGeometries(P)!;
}
