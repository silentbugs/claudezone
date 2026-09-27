export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export function wrapAngle(a: number): number { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function lerpAngle(a: number, b: number, t: number): number { return a + wrapAngle(b - a) * t; }
export function dist2(ax: number, az: number, bx: number, bz: number) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function dist3(ax: number, ay: number, az: number, bx: number, by: number, bz: number) { const dx = ax - bx, dy = ay - by, dz = az - bz; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
/** Distance from point p to segment ab in 2D. */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az; const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0; t = clamp(t, 0, 1);
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t); return Math.sqrt(dx * dx + dz * dz);
}
export function pointInPoly(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Value noise with smooth interpolation, used for terrain detail. */
import { hash2 } from './rng';
export function vnoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, y: number, oct: number, seed = 0): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
