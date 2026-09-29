/**
 * Static collision world: terrain heightfield + oriented structures. A structure has a world
 * position/rotation and a list of axis-aligned parts in its own local frame (so a rotated building is
 * still just boxes). Everything the player stands on, bumps into or shoots through lives here.
 * Pure data + math: shared by the headless sim and the renderer.
 */
export const enum Mat { Concrete = 0, Brick = 1, Plaster = 2, Metal = 3, Wood = 4, Glass = 5, Rock = 6, Asphalt = 7, Roof = 8, Container = 9, Trim = 10, Dark = 11, Foliage = 12, Tile = 13, Snow = 14, Water = 15 }

/** Damage multiplier for bullets passing through a material (absent = stops bullets). */
export const PENETRATION: Partial<Record<Mat, number>> = { [Mat.Wood]: 0.65, [Mat.Glass]: 0.95, [Mat.Plaster]: 0.55, [Mat.Foliage]: 1.0 };

/** Local-space part. y is relative to the structure base. */
export interface Part { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; mat: Mat; color?: number; noCollide?: boolean; shape?: 'box' | 'cyl' | 'gable' | 'wedge'; }
/** Stair ramp in local space rising along axis (0 = x, 1 = z) in direction dir. */
export interface RampPart { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; axis: 0 | 1; dir: 1 | -1; mat?: Mat }

export interface Structure {
  id: number;
  kind: string;
  x: number; y: number; z: number; angle: number;
  cos: number; sin: number;
  parts: Part[];
  ramps: RampPart[];
  /** local bounds */
  bx0: number; bz0: number; bx1: number; bz1: number; by1: number;
  radius: number;
  /** local-space loot spawn points */
  loot: [number, number, number][];
  poi?: string;
  /** render hints */
  style?: number;
  lodColor?: number;
}

export interface RayHit { t: number; nx: number; ny: number; nz: number; structure: number; part: number; mat: Mat; terrain: boolean; water: boolean; }

export const CELL = 24;

export class Heightfield {
  readonly res: number;
  readonly size: number;
  readonly step: number;
  readonly h: Float32Array;
  constructor(size: number, res: number, h?: Float32Array) {
    this.size = size; this.res = res; this.step = size / (res - 1);
    this.h = h ?? new Float32Array(res * res);
  }
  at(x: number, z: number): number {
    const r = this.res, s = this.step;
    let fx = x / s, fz = z / s;
    if (fx < 0) fx = 0; else if (fx > r - 1.001) fx = r - 1.001;
    if (fz < 0) fz = 0; else if (fz > r - 1.001) fz = r - 1.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * r + ix, h = this.h;
    // triangle interpolation matching the render mesh (diagonal from (0,0) to (1,1))
    if (tx >= tz) return h[i] + (h[i + 1] - h[i]) * tx + (h[i + r + 1] - h[i + 1]) * tz;
    return h[i] + (h[i + r] - h[i]) * tz + (h[i + r + 1] - h[i + r]) * tx;
  }
  normal(x: number, z: number): [number, number, number] {
    const e = this.step;
    const dx = this.at(x + e, z) - this.at(x - e, z), dz = this.at(x, z + e) - this.at(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz, l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }
}

export function makeStructure(id: number, kind: string, x: number, y: number, z: number, angle: number, parts: Part[], ramps: RampPart[] = [], loot: [number, number, number][] = []): Structure {
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity, by1 = 0;
  for (const p of parts) { bx0 = Math.min(bx0, p.x0); bz0 = Math.min(bz0, p.z0); bx1 = Math.max(bx1, p.x1); bz1 = Math.max(bz1, p.z1); by1 = Math.max(by1, p.y1); }
  for (const p of ramps) { bx0 = Math.min(bx0, p.x0); bz0 = Math.min(bz0, p.z0); bx1 = Math.max(bx1, p.x1); bz1 = Math.max(bz1, p.z1); by1 = Math.max(by1, p.y1); }
  if (!isFinite(bx0)) { bx0 = bz0 = -0.5; bx1 = bz1 = 0.5; }
  const radius = Math.hypot(Math.max(-bx0, bx1), Math.max(-bz0, bz1));
  return { id, kind, x, y, z, angle, cos: Math.cos(angle), sin: Math.sin(angle), parts, ramps, bx0, bz0, bx1, bz1, by1, radius, loot };
}

/** local -> world helpers (rotation about +y by angle: world = R * local) */
export function toWorld(s: Structure, lx: number, lz: number): [number, number] {
  return [s.x + lx * s.cos + lz * s.sin, s.z - lx * s.sin + lz * s.cos];
}
export function toLocal(s: Structure, x: number, z: number): [number, number] {
  const dx = x - s.x, dz = z - s.z;
  return [dx * s.cos - dz * s.sin, dx * s.sin + dz * s.cos];
}

export class CollisionWorld {
  readonly size: number;
  readonly terrain: Heightfield;
  structures: Structure[] = [];
  /** Deployables (shield turrets, boxes) added at runtime; checked by brute force. */
  dyn: Structure[] = [];
  private gw: number;
  private cells: Int32Array[] = [];
  private stamp: Uint32Array = new Uint32Array(0);
  private stampId = 1;
  /** Optional hook for water surfaces (sea + rivers). */
  waterAt: (x: number, z: number) => number = (x, z) => (this.terrain.at(x, z) < 0 ? 0 : -Infinity);

  constructor(terrain: Heightfield) {
    this.terrain = terrain; this.size = terrain.size;
    this.gw = Math.ceil(this.size / CELL);
  }

  add(s: Structure) { s.id = this.structures.length; this.structures.push(s); return s; }

  finalize() {
    const n = this.gw * this.gw, tmp: number[][] = Array.from({ length: n }, () => []);
    for (const s of this.structures) {
      const r = s.radius;
      const x0 = this.ci(s.x - r), x1 = this.ci(s.x + r), z0 = this.ci(s.z - r), z1 = this.ci(s.z + r);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tmp[z * this.gw + x].push(s.id);
    }
    this.cells = tmp.map((a) => Int32Array.from(a));
    this.stamp = new Uint32Array(this.structures.length);
  }
  private ci(v: number) { const c = Math.floor(v / CELL); return c < 0 ? 0 : c >= this.gw ? this.gw - 1 : c; }

  /** Structures whose bounding circle may touch the xz disc. */
  near(x: number, z: number, r: number, out: Structure[]): Structure[] {
    out.length = 0;
    const s = ++this.stampId;
    const x0 = this.ci(x - r), x1 = this.ci(x + r), z0 = this.ci(z - r), z1 = this.ci(z + r);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.cells[cz * this.gw + cx];
      for (let k = 0; k < cell.length; k++) {
        const id = cell[k];
        if (this.stamp[id] === s) continue; this.stamp[id] = s;
        const st = this.structures[id];
        const dx = st.x - x, dz = st.z - z, rr = st.radius + r;
        if (dx * dx + dz * dz <= rr * rr) out.push(st);
      }
    }
    for (const st of this.dyn) { const dx = st.x - x, dz = st.z - z, rr = st.radius + r; if (dx * dx + dz * dz <= rr * rr) out.push(st); }
    return out;
  }

  rampHeight(r: RampPart, lx: number, lz: number): number {
    const t = r.axis === 0 ? (lx - r.x0) / (r.x1 - r.x0) : (lz - r.z0) / (r.z1 - r.z0);
    const u = r.dir === 1 ? t : 1 - t;
    return r.y0 + (r.y1 - r.y0) * (u < 0 ? 0 : u > 1 ? 1 : u);
  }

  /** Highest walkable surface under (x,z) no higher than maxY (terrain if nothing else). */
  groundAt(x: number, z: number, maxY: number, rad = 0.3): number {
    let g = this.terrain.at(x, z);
    const list = this.near(x, z, rad, tmpS);
    for (const s of list) {
      const [lx, lz] = toLocal(s, x, z);
      if (lx < s.bx0 - rad || lx > s.bx1 + rad || lz < s.bz0 - rad || lz > s.bz1 + rad) continue;
      for (const p of s.parts) {
        if (p.noCollide) continue;
        if (lx < p.x0 - rad || lx > p.x1 + rad || lz < p.z0 - rad || lz > p.z1 + rad) continue;
        const top = s.y + p.y1;
        if (top <= maxY && top > g) g = top;
      }
      for (const r of s.ramps) {
        if (lx < r.x0 - rad * 0.5 || lx > r.x1 + rad * 0.5 || lz < r.z0 - rad * 0.5 || lz > r.z1 + rad * 0.5) continue;
        const cx = lx < r.x0 ? r.x0 : lx > r.x1 ? r.x1 : lx, cz = lz < r.z0 ? r.z0 : lz > r.z1 ? r.z1 : lz;
        const hh = s.y + this.rampHeight(r, cx, cz);
        if (hh <= maxY && hh > g) g = hh;
      }
    }
    return g;
  }

  /** Lowest ceiling (bottom of a part) at or above y. */
  ceilingAt(x: number, z: number, y: number, rad = 0.3): number {
    let c = Infinity;
    const list = this.near(x, z, rad, tmpS);
    for (const s of list) {
      const [lx, lz] = toLocal(s, x, z);
      for (const p of s.parts) {
        if (p.noCollide) continue;
        if (lx < p.x0 - rad || lx > p.x1 + rad || lz < p.z0 - rad || lz > p.z1 + rad) continue;
        const b = s.y + p.y0;
        if (b >= y && b < c) c = b;
      }
      // sloped roofs are ceilings from inside (lofts); stair flights are not
      for (const r of s.ramps) {
        if (r.mat !== Mat.Roof || lx < r.x0 || lx > r.x1 || lz < r.z0 || lz > r.z1) continue;
        const b = s.y + this.rampHeight(r, lx, lz) - 0.25;
        if (b >= y && b < c) c = b;
      }
    }
    return c;
  }

  /**
   * Push a vertical cylinder (feet y, height h, radius r) out of parts. Parts whose top is within
   * `step` of the feet are ignored (stepped onto instead). Returns corrected x/z in `out`.
   */
  pushOut(x: number, y: number, z: number, h: number, r: number, step: number, out: { x: number; z: number; hit: boolean; nx: number; nz: number }) {
    out.hit = false; out.nx = 0; out.nz = 0;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const list = this.near(x, z, r, tmpS);
      for (const s of list) {
        if (s.y + s.by1 <= y + step) continue;
        let [lx, lz] = toLocal(s, x, z);
        if (lx < s.bx0 - r || lx > s.bx1 + r || lz < s.bz0 - r || lz > s.bz1 + r) continue;
        let lmoved = false;
        for (const p of s.parts) {
          if (p.noCollide) continue;
          if (s.y + p.y1 <= y + step || s.y + p.y0 >= y + h) continue;
          const cx = lx < p.x0 ? p.x0 : lx > p.x1 ? p.x1 : lx;
          const cz = lz < p.z0 ? p.z0 : lz > p.z1 ? p.z1 : lz;
          const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let px: number, pz: number;
          if (d2 > 1e-10) { const d = Math.sqrt(d2), pen = r - d; px = (dx / d) * pen; pz = (dz / d) * pen; }
          else {
            const pl = lx - p.x0 + r, pr = p.x1 - lx + r, pb = lz - p.z0 + r, pf = p.z1 - lz + r;
            const m = Math.min(pl, pr, pb, pf);
            px = m === pl ? -pl : m === pr ? pr : 0; pz = m === pb ? -pb : m === pf ? pf : 0;
            if (px !== 0 && pz !== 0) pz = 0;
          }
          lx += px; lz += pz; lmoved = true;
        }
        if (lmoved) {
          const [wx, wz] = toWorld(s, lx, lz);
          out.nx += wx - x; out.nz += wz - z;
          x = wx; z = wz; moved = true; out.hit = true;
        }
      }
      if (!moved) break;
    }
    out.x = x; out.z = z;
    const l = Math.hypot(out.nx, out.nz); if (l > 0) { out.nx /= l; out.nz /= l; }
  }

  fits(x: number, y: number, z: number, h: number, r: number): boolean {
    const list = this.near(x, z, r, tmpS);
    for (const s of list) {
      const [lx, lz] = toLocal(s, x, z);
      for (const p of s.parts) {
        if (p.noCollide) continue;
        if (s.y + p.y1 <= y + 0.05 || s.y + p.y0 >= y + h) continue;
        const cx = lx < p.x0 ? p.x0 : lx > p.x1 ? p.x1 : lx;
        const cz = lz < p.z0 ? p.z0 : lz > p.z1 ? p.z1 : lz;
        if ((lx - cx) ** 2 + (lz - cz) ** 2 < r * r) return false;
      }
    }
    return true;
  }

  /**
   * Ray cast (unit direction) against structures, terrain and water.
   * `skip` returns true for materials to pass through.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: RayHit, skip?: (m: Mat) => boolean, water = true): boolean {
    out.t = maxT; out.structure = -1; out.part = -1; out.terrain = false; out.water = false; out.mat = Mat.Rock; out.nx = 0; out.ny = 1; out.nz = 0;
    let best = maxT;
    const s0 = ++this.stampId;
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL : cx * CELL) - ox) / dx : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL : cz * CELL) - oz) / dz : Infinity;
    let tcell = 0;
    while (tcell <= best) {
      if (cx >= 0 && cz >= 0 && cx < this.gw && cz < this.gw) {
        const cell = this.cells[cz * this.gw + cx];
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          if (this.stamp[id] === s0) continue; this.stamp[id] = s0;
          const s = this.structures[id];
          // local ray
          const rx = ox - s.x, rz = oz - s.z;
          const lox = rx * s.cos - rz * s.sin, loz = rx * s.sin + rz * s.cos, loy = oy - s.y;
          const ldx = dx * s.cos - dz * s.sin, ldz = dx * s.sin + dz * s.cos;
          if (!slab(lox, loy, loz, ldx, dy, ldz, s.bx0, -50, s.bz0, s.bx1, s.by1, s.bz1, best)) continue;
          for (let pi = 0; pi < s.parts.length; pi++) {
            const p = s.parts[pi];
            if (skip && skip(p.mat)) continue;
            const t = slabT(lox, loy, loz, ldx, dy, ldz, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, best);
            if (t < best) {
              best = t; out.structure = id; out.part = pi; out.mat = p.mat;
              // local normal -> world
              const lnx = slabN[0], lnz = slabN[2];
              out.nx = lnx * s.cos + lnz * s.sin; out.ny = slabN[1]; out.nz = -lnx * s.sin + lnz * s.cos;
            }
          }
        }
      }
      if (tmx < tmz) { tcell = tmx; tmx += tdx; cx += stepX; } else { tcell = tmz; tmz += tdz; cz += stepZ; }
      if (tcell > maxT) break;
      if (cx < -1 || cz < -1 || cx > this.gw || cz > this.gw) break;
    }
    for (const s of this.dyn) {
      const rx = ox - s.x, rz = oz - s.z;
      const lox = rx * s.cos - rz * s.sin, loz = rx * s.sin + rz * s.cos, loy = oy - s.y;
      const ldx = dx * s.cos - dz * s.sin, ldz = dx * s.sin + dz * s.cos;
      for (let pi = 0; pi < s.parts.length; pi++) { const p = s.parts[pi]; if (skip && skip(p.mat)) continue; const t = slabT(lox, loy, loz, ldx, dy, ldz, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, best); if (t < best) { best = t; out.structure = s.id; out.part = pi; out.mat = p.mat; out.nx = slabN[0] * s.cos + slabN[2] * s.sin; out.ny = slabN[1]; out.nz = -slabN[0] * s.sin + slabN[2] * s.cos; } }
    }
    // terrain + water by marching
    const T = this.terrain;
    const stepLen = Math.max(1, Math.min(3, best / 40));
    let prevT = 0;
    for (let t = stepLen; t < best + stepLen; t += stepLen) {
      const tt = Math.min(t, best);
      const px = ox + dx * tt, py = oy + dy * tt, pz = oz + dz * tt;
      const g = T.at(px, pz);
      const w = water && py < g + 6 ? this.waterAt(px, pz) : -Infinity;
      const surf = w > g ? w : g;
      if (py < surf) {
        let lo = prevT, hi = tt;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) * 0.5, mx = ox + dx * m, mz = oz + dz * m, my = oy + dy * m;
          const gg = T.at(mx, mz), ww = water ? this.waterAt(mx, mz) : -Infinity;
          if (my < Math.max(gg, ww)) hi = m; else lo = m;
        }
        if (hi < best) {
          best = hi; out.structure = -1; out.part = -1;
          const hx = ox + dx * hi, hz = oz + dz * hi;
          const isWater = water && this.waterAt(hx, hz) >= T.at(hx, hz);
          out.terrain = !isWater; out.water = isWater; out.mat = isWater ? Mat.Water : Mat.Rock;
          if (isWater) { out.nx = 0; out.ny = 1; out.nz = 0; } else { const n = T.normal(hx, hz); out.nx = n[0]; out.ny = n[1]; out.nz = n[2]; }
        }
        break;
      }
      if (tt >= best) break;
      prevT = tt;
    }
    out.t = best;
    return best < maxT;
  }

  /** Line of sight between two points (glass and foliage see-through). */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, losHit, seeThrough, false);
  }
}
const seeThrough = (m: Mat) => m === Mat.Glass || m === Mat.Foliage;
const losHit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0, structure: -1, part: -1, mat: Mat.Rock, terrain: false, water: false };
const tmpS: Structure[] = [];
const slabN = [0, 0, 0];

function slab(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number): boolean {
  let t0 = 0, t1 = maxT, a: number, b: number, inv: number;
  if (dx !== 0) { inv = 1 / dx; a = (x0 - ox) * inv; b = (x1 - ox) * inv; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; } else if (ox < x0 || ox > x1) return false;
  if (dy !== 0) { inv = 1 / dy; a = (y0 - oy) * inv; b = (y1 - oy) * inv; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; } else if (oy < y0 || oy > y1) return false;
  if (dz !== 0) { inv = 1 / dz; a = (z0 - oz) * inv; b = (z1 - oz) * inv; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; } else if (oz < z0 || oz > z1) return false;
  return true;
}
/** Entry distance into a box (or Infinity), writing the entry face normal into slabN. */
function slabT(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number): number {
  let t0 = 0, t1 = maxT, a: number, b: number, inv: number, ax = -1;
  if (dx !== 0) { inv = 1 / dx; a = (x0 - ox) * inv; b = (x1 - ox) * inv; if (a > b) { const q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 0; } if (b < t1) t1 = b; if (t0 > t1) return Infinity; } else if (ox < x0 || ox > x1) return Infinity;
  if (dy !== 0) { inv = 1 / dy; a = (y0 - oy) * inv; b = (y1 - oy) * inv; if (a > b) { const q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 1; } if (b < t1) t1 = b; if (t0 > t1) return Infinity; } else if (oy < y0 || oy > y1) return Infinity;
  if (dz !== 0) { inv = 1 / dz; a = (z0 - oz) * inv; b = (z1 - oz) * inv; if (a > b) { const q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 2; } if (b < t1) t1 = b; if (t0 > t1) return Infinity; } else if (oz < z0 || oz > z1) return Infinity;
  if (ax < 0) return Infinity; // origin inside the box: ignore (lets shots leave cover they clip)
  slabN[0] = ax === 0 ? -Math.sign(dx) : 0; slabN[1] = ax === 1 ? -Math.sign(dy) : 0; slabN[2] = ax === 2 ? -Math.sign(dz) : 0;
  return t0;
}
