/**
 * Coarse navigation for bots: an 8 m grid where building footprints (and other tall ground-level
 * parts) are blocked and water/steep ground cost more. A* with an octile heuristic, then the path
 * is string-pulled with grid line-of-sight so bots walk straight lines between corners.
 */
import type { CollisionWorld } from '../world/collision';

export const NAV_CELL = 8;

export class NavGrid {
  readonly n: number;
  readonly cost: Uint8Array; // 0 blocked, else step cost (1 open ground)
  private g: Float32Array; private f: Float32Array; private from: Int32Array; private stamp: Uint32Array; private closed: Uint32Array;
  private sid = 1;
  private heap: Int32Array; private hn = 0;

  constructor(col: CollisionWorld, lockedDoors?: Set<number>) {
    const size = col.size, n = Math.ceil(size / NAV_CELL);
    this.n = n;
    const cost = new Uint8Array(n * n).fill(1);
    const hf = col.terrain;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * NAV_CELL, z = (j + 0.5) * NAV_CELL;
      const h = hf.at(x, z);
      const k = j * n + i;
      if (col.waterAt(x, z) > h + 1) cost[k] = 5;
      const nrm = hf.normal(x, z)[1];
      if (nrm < 0.55) cost[k] = Math.max(cost[k], 4);
      if (h < -6) cost[k] = 0;
    }
    // structures: mark cells covered by ground-level collidable parts taller than a crouch
    for (const s of col.structures) {
      if (s.kind === 'tree' || s.kind === 'lamp' || s.kind === 'pole' || s.kind === 'gulag') continue;
      // doors get pushed open - except locked ones (sealed flats), which bots used to path straight into and stick
      if (s.kind === 'door' && (!lockedDoors?.has(s.id) || s.y - hf.at(s.x, s.z) > 1.4)) continue;
      for (const p of s.parts) {
        if (p.noCollide || p.y1 - Math.max(p.y0, 0) < 1.2 || p.y0 > 1.4) continue;
        const w = p.x1 - p.x0, d = p.z1 - p.z0;
        if (w < 0.6 && d < 0.6) continue;
        // walk the part's footprint in local space at half-cell steps
        const st = NAV_CELL * 0.45;
        for (let v = p.z0; v <= p.z1 + 1e-6; v += Math.min(st, Math.max(0.3, d))) for (let u = p.x0; u <= p.x1 + 1e-6; u += Math.min(st, Math.max(0.3, w))) {
          const wx = s.x + u * s.cos + v * s.sin, wz = s.z - u * s.sin + v * s.cos;
          const ci = Math.floor(wx / NAV_CELL), cj = Math.floor(wz / NAV_CELL);
          if (ci >= 0 && cj >= 0 && ci < n && cj < n) cost[cj * n + ci] = 0;
        }
      }
    }
    this.cost = cost;
    const N = n * n;
    this.g = new Float32Array(N); this.f = new Float32Array(N); this.from = new Int32Array(N); this.stamp = new Uint32Array(N); this.closed = new Uint32Array(N);
    this.heap = new Int32Array(N);
  }

  cellOf(x: number, z: number) { const i = Math.min(this.n - 1, Math.max(0, Math.floor(x / NAV_CELL))), j = Math.min(this.n - 1, Math.max(0, Math.floor(z / NAV_CELL))); return j * this.n + i; }
  walkable(x: number, z: number) { return this.cost[this.cellOf(x, z)] > 0; }

  /** Grid line of sight through walkable cells (supercover walk). */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / (NAV_CELL * 0.5));
    for (let s = 1; s < steps; s++) { const t = s / steps; if (this.cost[this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t)] === 0) return false; }
    return true;
  }

  private nearestOpen(k: number): number {
    if (this.cost[k] > 0) return k;
    const n = this.n, ci = k % n, cj = Math.floor(k / n);
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
      if (this.cost[j * n + i] > 0) return j * n + i;
    }
    return k;
  }

  // binary heap on f
  private push(k: number) { const h = this.heap, f = this.f; let i = this.hn++; h[i] = k; while (i > 0) { const p = (i - 1) >> 1; if (f[h[p]] <= f[k]) break; h[i] = h[p]; i = p; } h[i] = k; }
  private pop(): number { const h = this.heap, f = this.f; const top = h[0]; const last = h[--this.hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= this.hn) break; if (c + 1 < this.hn && f[h[c + 1]] < f[h[c]]) c++; if (f[h[c]] >= f[last]) break; h[i] = h[c]; i = c; } h[i] = last; return top; }

  /** World-space waypoints from a to b (excluding a), or null if unreachable within the budget. */
  find(ax: number, az: number, bx: number, bz: number, budget = 40000): [number, number][] | null {
    const n = this.n;
    const s = this.nearestOpen(this.cellOf(ax, az)), t = this.nearestOpen(this.cellOf(bx, bz));
    if (s === t) return [[bx, bz]];
    const id = ++this.sid;
    const tx = t % n, tz = Math.floor(t / n);
    const hfun = (k: number) => { const dx = Math.abs(k % n - tx), dz = Math.abs(Math.floor(k / n) - tz); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };
    this.hn = 0; this.g[s] = 0; this.f[s] = hfun(s); this.stamp[s] = id; this.from[s] = -1; this.push(s);
    let exp = 0, found = false, best = s, bestH = Infinity;
    while (this.hn > 0) {
      const k = this.pop();
      if (this.closed[k] === id) continue;
      this.closed[k] = id;
      if (k === t) { found = true; break; }
      const hk = this.f[k] - this.g[k]; if (hk < bestH) { bestH = hk; best = k; }
      if (++exp > budget) break;
      const ci = k % n, cj = Math.floor(k / n);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const q = j * n + i, c = this.cost[q]; if (!c) continue;
        if (di && dj && (!this.cost[cj * n + i] || !this.cost[j * n + ci])) continue; // no corner cutting
        const ng = this.g[k] + (di && dj ? Math.SQRT2 : 1) * c;
        if (this.stamp[q] !== id || ng < this.g[q]) { this.stamp[q] = id; this.g[q] = ng; this.f[q] = ng + hfun(q); this.from[q] = k; this.push(q); }
      }
    }
    const end = found ? t : best;
    if (!found && bestH > 30) return null;
    const cells: number[] = [];
    for (let k = end; k >= 0 && k !== s; k = this.from[k]) cells.push(k);
    cells.reverse();
    const pts: [number, number][] = cells.map((k) => [(k % n + 0.5) * NAV_CELL, (Math.floor(k / n) + 0.5) * NAV_CELL]);
    if (found) pts.push([bx, bz]);
    // string-pull
    const out: [number, number][] = [];
    let cx = ax, cz = az, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.los(cx, cz, pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); cx = pts[j][0]; cz = pts[j][1]; i = j + 1;
    }
    return out;
  }
}
