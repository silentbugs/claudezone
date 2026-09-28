/**
 * Verdansk terrain: control-point elevations from the traced map, a mountain rim outside the play
 * boundary, the Kastovian Sea to the south, river ravines/canals, a frozen reservoir behind the dam,
 * and roads smoothed flat. Deterministic; runs identically in node (tests) and the browser.
 */
import { VERDANSK } from '../data/verdansk';
import { Heightfield } from './collision';
import { MapMasks, MAP_SIZE, MASK_RES, MASK_PX, M_ROAD, M_SEA, M_SNOW, M_BUILT } from './mapdata';
import { clamp, fbm, pointInPoly, smoothstep, lerp } from '../core/math';

export const TERRAIN_RES = 1081; // 3 m spacing
export const RIVER_DEPTH = 2.6;

export interface RiverDef { name: string; pts: [number, number][]; surf: number[]; halfW: number; frozenUntil: number; cum: number[]; len: number }

/** Surface (ice or water) height profile per polyline vertex, chosen to fall monotonically to the sea. */
const RIVER_PROFILES: Record<string, { surf: number[]; halfW: number; frozenUntil: number }> = {
  'Gora River': { surf: [74, 68, 62, 56, 50, 45, 40, 34, 26, 16, 8, 1.5, 0, 0, 0], halfW: 16, frozenUntil: 0.62 },
  'Karst River': { surf: [58, 52, 46, 40, 34, 26, 20, 12, 6, 2, 0.5, 0, 0, 0], halfW: 14, frozenUntil: 0 },
};

export function riverDefs(): RiverDef[] {
  return VERDANSK.rivers.map((r) => {
    const prof = RIVER_PROFILES[r.name];
    const pts = r.pts.map((p) => [p[0], p[1]] as [number, number]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { name: r.name, pts, surf: prof.surf, halfW: prof.halfW, frozenUntil: prof.frozenUntil, cum, len: cum[cum.length - 1] };
  });
}

/** Nearest point on a river: distance, arc position (0..1) and interpolated surface height. */
export function riverQuery(rv: RiverDef, x: number, z: number): { d: number; s: number; surf: number } {
  let best = Infinity, bs = 0, bsurf = 0;
  const p = rv.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    let t = l2 > 0 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0; t = clamp(t, 0, 1);
    const dx = x - (ax + vx * t), dz = z - (az + vz * t), d = dx * dx + dz * dz;
    if (d < best) { best = d; bs = (rv.cum[i] + t * (rv.cum[i + 1] - rv.cum[i])) / rv.len; bsurf = lerp(rv.surf[i] ?? 0, rv.surf[i + 1] ?? 0, t); }
  }
  return { d: Math.sqrt(best), s: bs, surf: bsurf };
}

export const RESERVOIR_H = 86;

/** Chamfer distance transform (metres) from pixels where src[i] != 0, on an n x n grid of spacing `sp`. */
function distanceField(src: Uint8Array, n: number, sp: number): Float32Array {
  const INF = 1e9, d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = src[i] ? 0 : INF;
  const a = sp, b = sp * Math.SQRT2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - n] + a); if (x > 0) v = Math.min(v, d[i - n - 1] + b); if (x < n - 1) v = Math.min(v, d[i - n + 1] + b); }
    d[i] = v;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let v = d[i];
    if (x < n - 1) v = Math.min(v, d[i + 1] + a);
    if (y < n - 1) { v = Math.min(v, d[i + n] + a); if (x < n - 1) v = Math.min(v, d[i + n + 1] + b); if (x > 0) v = Math.min(v, d[i + n - 1] + b); }
    d[i] = v;
  }
  return d;
}

function blur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), w = 2 * r + 1;
  for (let y = 0; y < n; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * n + clamp(x, 0, n - 1)];
    for (let x = 0; x < n; x++) { tmp[y * n + x] = s / w; s += src[y * n + clamp(x + r + 1, 0, n - 1)] - src[y * n + clamp(x - r, 0, n - 1)]; } }
  for (let x = 0; x < n; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, n - 1) * n + x];
    for (let y = 0; y < n; y++) { out[y * n + x] = s / w; s += tmp[clamp(y + r + 1, 0, n - 1) * n + x] - tmp[clamp(y - r, 0, n - 1) * n + x]; } }
  return out;
}

export interface TerrainExtras {
  /** 0..1 per terrain sample: road coverage (for texturing). */
  road: Float32Array;
  /** 0..1 snow coverage. */
  snow: Float32Array;
  /** 0..1 paved ground (plazas, lots, sidewalks) from the tac map's built-up areas. */
  paved: Float32Array;
  /** Freight loop centreline: x, y (rail top), z every ~2 m, closed. */
  railPath: Float32Array;
  /** Marks samples that are river ice / river bed. 1 = ice, 2 = water bed */
  river: Uint8Array;
  rivers: RiverDef[];
  /** Road/river crossings: centre, road direction (radians), span length, width, deck height. */
  bridges: { x: number; z: number; a: number; len: number; w: number; y: number }[];
}

export function buildTerrain(masks: MapMasks): { hf: Heightfield; extra: TerrainExtras } {
  const n = TERRAIN_RES, sp = MAP_SIZE / (n - 1);
  const hf = new Heightfield(MAP_SIZE, n);
  const h = hf.h;
  // --- rasters sampled from masks onto the terrain grid
  const builtR = new Float32Array(n * n);
  const sea = new Uint8Array(n * n), inPlay = new Uint8Array(n * n), roadR = new Uint8Array(n * n), snowR = new Float32Array(n * n);
  const playable = VERDANSK.playable as unknown as [number, number][];
  const land = VERDANSK.land as unknown as [number, number][];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * sp, z = j * sp, k = j * n + i;
    const m = masks.at(x, z);
    const isSea = !pointInPoly(x, z, land);
    sea[k] = isSea ? 1 : 0;
    inPlay[k] = pointInPoly(x, z, playable) ? 1 : 0;
    roadR[k] = m & M_ROAD ? 1 : 0;
    snowR[k] = m & M_SNOW ? 1 : 0;
    builtR[k] = m & M_BUILT ? 1 : 0;
  }
  { // tac-map roads are drawn wide: erode once so carriageways are ~9-12 m
    const er = new Uint8Array(n * n);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i; er[k] = roadR[k] && roadR[k - 1] && roadR[k + 1] && roadR[k - n] && roadR[k + n] ? 1 : 0; }
    // keep polyline highways (already exact width) by or-ing thin results with original where isolated
    for (let k = 0; k < n * n; k++) if (er[k]) roadR[k] = 2;
    for (let k = 0; k < n * n; k++) roadR[k] = roadR[k] === 2 ? 1 : 0;
  }
  // major road polylines (the north has no raster roads)
  for (const r of VERDANSK.roads) {
    for (let s = 0; s < r.pts.length - 1; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
      const L = Math.hypot(bx - ax, bz - az), steps = Math.ceil(L / (sp * 0.5));
      const half = r.type === 'highway' ? 7 : 4.5;
      for (let t = 0; t <= steps; t++) {
        const x = ax + (bx - ax) * (t / steps), z = az + (bz - az) * (t / steps);
        const ri = Math.ceil(half / sp);
        for (let dj = -ri; dj <= ri; dj++) for (let di = -ri; di <= ri; di++) {
          const i = Math.round(x / sp) + di, j = Math.round(z / sp) + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
          if (Math.hypot(i * sp - x, j * sp - z) <= half) roadR[j * n + i] = 1;
        }
      }
    }
  }
  const dSea = distanceField(sea, n, sp);
  const landMask = new Uint8Array(n * n); for (let k = 0; k < n * n; k++) landMask[k] = sea[k] ? 0 : 1;
  const dLand = distanceField(landMask, n, sp);
  const dPlay = distanceField(inPlay, n, sp); // distance outside the playable boundary
  const snowB = blur(snowR, n, 8);
  // --- base elevation from control points (gaussian-weighted)
  const cps = VERDANSK.heights as unknown as [number, number, number][];
  const majors = VERDANSK.pois.filter((p) => p.tier === 'major');
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * sp, z = j * sp, k = j * n + i;
    let ws = 0, hs = 0;
    for (const [cx, cz, ch] of cps) {
      const d2 = (x - cx) ** 2 + (z - cz) ** 2;
      const w = Math.exp(-d2 / (2 * 330 * 330)) + 1e-4 / (1 + d2 / 1e6);
      ws += w; hs += w * ch;
    }
    let base = hs / ws;
    // urban flatness vs rugged north
    let urban = 0;
    for (const p of majors) { const d = Math.hypot(x - p.x, z - p.z); urban = Math.max(urban, smoothstep(p.r * 1.25, p.r * 0.5, d)); }
    const north = smoothstep(1700, 700, z);
    const rugged = clamp(north * 0.8 + snowB[k] * 0.6, 0, 1) * (1 - urban * 0.85);
    const lo = (fbm(x / 420, z / 420, 4, 11) - 0.5) * 22;
    const mid = (fbm(x / 120, z / 120, 4, 23) - 0.5) * 10;
    const ridge = (1 - Math.abs(fbm(x / 260, z / 260, 5, 37) * 2 - 1)) ** 2 * 60;
    base += lo * (1 - urban * 0.8) + mid * (0.25 + rugged * 0.9) * (1 - urban * 0.7) + ridge * rugged;
    // mountain rim outside the play area (not over the sea)
    const out = dPlay[k];
    if (out > 0 && !sea[k]) {
      const rim = smoothstep(0, 750, out) * 300 + (fbm(x / 180, z / 180, 5, 51) - 0.5) * 90 * smoothstep(60, 450, out);
      base += rim * smoothstep(0, 180, dSea[k]);
    }
    // coast: beaches/cliffs down to the sea
    if (sea[k]) base = -1.5 - Math.min(dLand[k] * 0.12, 28);
    else base = Math.min(base, 0.8 + dSea[k] * 0.28);
    h[k] = base;
  }
  // --- frozen reservoir behind the dam
  const lake = VERDANSK.lakes[0].poly as unknown as [number, number][];
  const port = VERDANSK.lakes[1].poly as unknown as [number, number][];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * sp, z = j * sp, k = j * n + i;
    if (pointInPoly(x, z, lake)) h[k] = RESERVOIR_H;
    if (pointInPoly(x, z, port)) h[k] = -4;
  }
  // --- roads: replace height with a smoothed version along roads
  const hb = blur(blur(h, n, 5), n, 5);
  const roadSoft = blur(Float32Array.from(roadR), n, 1);
  for (let k = 0; k < n * n; k++) {
    const w = clamp(roadSoft[k] * 2.2, 0, 1);
    if (w > 0 && !sea[k]) h[k] = lerp(h[k], hb[k], w);
  }
  // --- rivers: carve channels after roads so bridges are needed over them
  const preCarve = Float32Array.from(h);
  const rivers = riverDefs();
  const riverR = new Uint8Array(n * n);
  for (const rv of rivers) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [px, pz] of rv.pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
    const pad = rv.halfW + 60;
    for (let j = Math.max(0, Math.floor((z0 - pad) / sp)); j <= Math.min(n - 1, Math.ceil((z1 + pad) / sp)); j++)
      for (let i = Math.max(0, Math.floor((x0 - pad) / sp)); i <= Math.min(n - 1, Math.ceil((x1 + pad) / sp)); i++) {
        const x = i * sp, z = j * sp, k = j * n + i;
        const q = riverQuery(rv, x, z);
        if (q.d > pad) continue;
        const frozen = q.s < rv.frozenUntil;
        const bed = frozen ? q.surf : q.surf - RIVER_DEPTH;
        if (q.d < rv.halfW) { h[k] = bed; riverR[k] = frozen ? 1 : 2; }
        else {
          // banks: steep concrete-ish canal walls in town (south), rough ravine slopes up north
          const t = (q.d - rv.halfW) / 60;
          const bankTop = Math.max(bed + 3, h[k]);
          const slope = frozen ? smoothstep(0, 1, t) : smoothstep(0, 0.12, t);
          h[k] = Math.min(h[k], lerp(bed + (frozen ? 0 : 1.5), bankTop, slope));
        }
      }
  }
  const road = new Float32Array(n * n); for (let k = 0; k < n * n; k++) road[k] = clamp(roadSoft[k] * 1.6, 0, 1) * (riverR[k] ? 0 : 1);
  const snow = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; snow[k] = clamp((snowB[k] * 2.0 - 0.25) * smoothstep(1250, 900, j * sp) + smoothstep(150, 230, h[k]), 0, 1); }
  // --- bridges: cluster road cells that fell into a river channel
  const bridges: TerrainExtras['bridges'] = [];
  {
    const seen = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) {
      if (seen[k] || !riverR[k] || !roadR[k]) continue;
      const cells: number[] = [], st = [k]; seen[k] = 1;
      while (st.length) { const q = st.pop()!; cells.push(q); const qi = q % n, qj = (q / n) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const i = qi + di, j = qj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const r = j * n + i; if (!seen[r] && riverR[r] && roadR[r]) { seen[r] = 1; st.push(r); } } }
      if (cells.length < 4) continue;
      let mx = 0, mz = 0, yy = 0; for (const q of cells) { mx += (q % n) * sp; mz += ((q / n) | 0) * sp; } mx /= cells.length; mz /= cells.length;
      // road direction: perpendicular to the river at this point
      let rv = rivers[0], best = Infinity; for (const r of rivers) { const q = riverQuery(r, mx, mz); if (q.d < best) { best = q.d; rv = r; } }
      const e = 6, qa = riverQuery(rv, mx, mz);
      let ra = 0; { let bi = 0, bd = Infinity; for (let i = 0; i < rv.pts.length - 1; i++) { const ax = rv.pts[i][0], az = rv.pts[i][1], bx = rv.pts[i + 1][0], bz = rv.pts[i + 1][1]; const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz; let tt = ((mx - ax) * vx + (mz - az) * vz) / l2; tt = clamp(tt, 0, 1); const d = Math.hypot(mx - ax - vx * tt, mz - az - vz * tt); if (d < bd) { bd = d; bi = i; } } ra = Math.atan2(rv.pts[bi + 1][1] - rv.pts[bi][1], rv.pts[bi + 1][0] - rv.pts[bi][0]); }
      void e; void qa;
      // deck height: the road height on the banks before carving
      const cx = Math.cos(ra + Math.PI / 2), cz = Math.sin(ra + Math.PI / 2), span = rv.halfW * 2 + 26;
      const bankA = preCarve[Math.round((mz + cz * span / 2) / sp) * n + Math.round((mx + cx * span / 2) / sp)] ?? 0, bankB = preCarve[Math.round((mz - cz * span / 2) / sp) * n + Math.round((mx - cx * span / 2) / sp)] ?? 0;
      yy = Math.max(bankA, bankB, 1.5);
      if (bridges.some((b) => Math.hypot(b.x - mx, b.z - mz) < 30)) continue;
      bridges.push({ x: mx, z: mz, a: -(ra + Math.PI / 2), len: span, w: 12, y: yy }); // local x runs across the river
    }
  }
  // --- the south-west freight loop (Season 4 2020): a smooth, graded bed flattened into the terrain.
  // The sampled path (x, y, z every 2 m, closed loop) is what the train runs on.
  const railPath: number[] = [];
  {
    const src = VERDANSK.rail[0].pts as unknown as [number, number][];
    // Catmull-Rom through the traced points so the curves are smooth
    const P = src.slice(0, -1); // last point repeats the first
    const pts: [number, number][] = [];
    for (let i = 0; i < P.length; i++) {
      const p0 = P[(i - 1 + P.length) % P.length], p1 = P[i], p2 = P[(i + 1) % P.length], p3 = P[(i + 2) % P.length];
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), steps = Math.max(2, Math.ceil(L / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    // height: ground under the line, smoothed along the loop (~120 m window) and kept above the sea
    const g = pts.map(([x, z]) => h[clamp(Math.round(z / sp), 0, n - 1) * n + clamp(Math.round(x / sp), 0, n - 1)]);
    const W = 30, m = pts.length, ys = new Array(m).fill(0);
    for (let i = 0; i < m; i++) { let s = 0, c = 0; for (let d = -W; d <= W; d++) { const w = W + 1 - Math.abs(d); s += g[(i + d + m) % m] * w; c += w; } ys[i] = Math.max(2.2, s / c); }
    for (let i = 0; i < m; i++) railPath.push(pts[i][0], ys[i], pts[i][1]);
    // flatten: bed within 3.5 m of the centreline, blend back to the terrain by 10 m.
    // Two passes: each cell takes the height of its nearest track sample (no accumulation on grades).
    const bestD = new Float32Array(n * n).fill(1e9), bestY = new Float32Array(n * n);
    const R = Math.ceil(10 / sp);
    for (let i = 0; i < m; i++) {
      const [x, z] = pts[i];
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const ii = Math.round(x / sp) + di, jj = Math.round(z / sp) + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const d = Math.hypot(ii * sp - x, jj * sp - z), k = jj * n + ii;
        if (d < bestD[k]) { bestD[k] = d; bestY[k] = ys[i] - 0.35; } // ballast top sits just under the rails
      }
    }
    for (let k = 0; k < n * n; k++) {
      const d = bestD[k]; if (d > 10) continue;
      const w = d <= 3.5 ? 1 : 1 - smoothstep(3.5, 10, d);
      h[k] = lerp(h[k], bestY[k], w);
      if (w > 0.6) { roadR[k] = 0; riverR[k] = 0; }
    }
  }
  const pb = blur(blur(builtR, n, 2), n, 2);
  const paved = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) paved[k] = riverR[k] || h[k] < 0.5 ? 0 : clamp((pb[k] - 0.18) * 2.2, 0, 1) * (1 - snow[k]);
  return { hf, extra: { road, snow, paved, river: riverR, rivers, bridges, railPath: Float32Array.from(railPath) } };
}

/** Water surface height at a point (sea = 0, rivers use their profile), or -Infinity where dry. */
export function waterSurfaceAt(rivers: RiverDef[], hf: Heightfield, x: number, z: number): number {
  const g = hf.at(x, z);
  let w = g < 0 ? 0 : -Infinity;
  for (const rv of rivers) {
    const q = riverQuery(rv, x, z);
    if (q.d < rv.halfW + 2 && q.s >= rv.frozenUntil) w = Math.max(w, q.surf);
  }
  return w;
}
export { MASK_RES, MASK_PX };
