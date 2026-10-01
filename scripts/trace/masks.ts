/**
 * Road layer from the warped 2025 tac map (.harness/ref/vd2025_world.rgb, 0.75 m/px): smooth uniform grey ribbons,
 * minus building footprints, downsampled to the 3 m mask grid and despeckled; replaces the road bit of
 * public/map/masks.bin inside the area the image covers. Run: npx esbuild ... && node (see scripts/trace/README).
 */
import fs from 'fs';
import zlib from 'zlib';
import { FOOTPRINTS } from '../../src/data/footprints';
const RES = 0.75, M = 4320, N = M * M, img = fs.readFileSync('.harness/ref/vd2025_world.rgb');
const L = new Float32Array(N); for (let i = 0; i < N; i++) L[i] = (img[i * 3] + img[i * 3 + 1] + img[i * 3 + 2]) / 3;
const sat = (f: (i: number) => number) => { const S = new Float64Array((M + 1) * (M + 1)); for (let y = 0; y < M; y++) { let row = 0; for (let x = 0; x < M; x++) { row += f(y * M + x); S[(y + 1) * (M + 1) + x + 1] = S[y * (M + 1) + x + 1] + row; } } return S; };
const S1 = sat((i) => L[i]), S2 = sat((i) => L[i] * L[i]);
const box = (S: Float64Array, x: number, y: number, r: number) => { const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(M, x + r + 1), y1 = Math.min(M, y + r + 1); return [S[y1 * (M + 1) + x1] - S[y0 * (M + 1) + x1] - S[y1 * (M + 1) + x0] + S[y0 * (M + 1) + x0], (x1 - x0) * (y1 - y0)] as const; };
// building footprints, padded 1 m: never road
const B = new Uint8Array(N);
for (const [x, z, a, w, d, , parts] of FOOTPRINTS) {
  const c = Math.cos(a), s = Math.sin(a), rects = parts || [[0, 0, w, d]];
  for (const [u, v, pw, pd] of rects) {
    const cx = x + u * c + v * s, cz = z - u * s + v * c, R = Math.hypot(pw, pd) / 2 + 1;
    for (let zz = cz - R; zz <= cz + R; zz += RES / 2) for (let xx = cx - R; xx <= cx + R; xx += RES / 2) {
      const dx = xx - cx, dz = zz - cz, lu = dx * c - dz * s, lv = dx * s + dz * c;
      if (Math.abs(lu) > pw / 2 + 1 || Math.abs(lv) > pd / 2 + 1) continue;
      const i = Math.floor(xx / RES), j = Math.floor(zz / RES); if (i >= 0 && j >= 0 && i < M && j < M) B[j * M + i] = 1;
    }
  }
}
const R = new Uint8Array(N); let any = new Uint8Array(N);
for (let y = 3; y < M - 3; y++) for (let x = 3; x < M - 3; x++) {
  const i = y * M + x; if (img[i * 3] + img[i * 3 + 1] + img[i * 3 + 2] > 0) any[i] = 1;
  if (B[i]) continue;
  const r = img[i * 3], b = img[i * 3 + 2];
  const [s1, n] = box(S1, x, y, 3), [s2] = box(S2, x, y, 3), mean = s1 / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  // smooth, neutral, and lighter than the ground ~15 m around (the map's shading varies, so no absolute grey range)
  const [sb, nb] = box(S1, x, y, 20), bg = sb / nb;
  if (mean > 85 && mean < 165 && sd < 7 && Math.abs(r - b) < 10 && mean - bg > 4) R[i] = 1;
}
{ let nb = 0, nr = 0; for (let i = 0; i < N; i++) { nb += B[i]; nr += R[i]; } console.log("building px", nb, "road px", nr, "of", N); }
// widen the detected centre strip to the road's width (~2 m each side), but never into a building
{ const R2 = new Uint8Array(N); for (let y = 3; y < M - 3; y++) for (let x = 3; x < M - 3; x++) { const i = y * M + x; if (!R[i]) continue; for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) { const k = i + b * M + c; if (!B[k]) R2[k] = 1; } } R.set(R2); }
// to the 3 m mask grid
const MASK = 1080, F = 4, raw = new Uint8Array(zlib.inflateSync(fs.readFileSync('public/map/masks.bin')));
const road = new Uint8Array(MASK * MASK), covered = new Uint8Array(MASK * MASK);
for (let j = 0; j < MASK; j++) for (let i = 0; i < MASK; i++) { let n = 0, a = 0; for (let b = 0; b < F; b++) for (let c = 0; c < F; c++) { const k = (j * F + b) * M + i * F + c; n += R[k]; a += any[k]; } road[j * MASK + i] = n >= 6 ? 1 : 0; covered[j * MASK + i] = a > 8 ? 1 : 0; }
// only near the 2020 trace: within 40 m of an old road or in built-up ground (the north's rock and snow highlights
// read as smooth light patches)
{ const oldRoad = new Uint8Array(MASK * MASK); for (let k = 0; k < raw.length; k++) oldRoad[k] = raw[k] & 1;
  const near = new Uint8Array(MASK * MASK), Rr = 13;
  for (let j = 0; j < MASK; j++) for (let i = 0; i < MASK; i++) { if (!oldRoad[j * MASK + i]) continue; for (let b = -Rr; b <= Rr; b++) for (let c = -Rr; c <= Rr; c++) { const jj = j + b, ii = i + c; if (jj >= 0 && ii >= 0 && jj < MASK && ii < MASK && b * b + c * c <= Rr * Rr) near[jj * MASK + ii] = 1; } }
  for (let k = 0; k < road.length; k++) if (road[k] && !near[k] && (!(raw[k] & 2) || k < 450 * MASK)) road[k] = 0; } // the north's built mask is rock noise
// despeckle: drop road components under 12 cells (roof patches, plazas' noise)
const lab = new Int32Array(MASK * MASK); let nl = 0;
for (let s0 = 0; s0 < road.length; s0++) {
  if (!road[s0] || lab[s0]) continue;
  const st = [s0], comp: number[] = []; lab[s0] = ++nl;
  while (st.length) { const k = st.pop()!; comp.push(k); const x = k % MASK; for (const q of [x > 0 ? k - 1 : -1, x < MASK - 1 ? k + 1 : -1, k - MASK, k + MASK]) if (q >= 0 && q < road.length && road[q] && !lab[q]) { lab[q] = nl; st.push(q); } }
  // small fat blobs are smooth rock / plaza patches, not roads (roads are long and ~3 cells wide)
  let i0 = MASK, i1 = 0, j0 = MASK, j1 = 0; for (const k of comp) { const x = k % MASK, y = (k / MASK) | 0; i0 = Math.min(i0, x); i1 = Math.max(i1, x); j0 = Math.min(j0, y); j1 = Math.max(j1, y); }
  const thick = comp.length / Math.max(1, Math.hypot(i1 - i0 + 1, j1 - j0 + 1));
  if (comp.length < 12 || (comp.length < 400 && thick > 4.2)) for (const k of comp) road[k] = 0;
}
let before = 0, after = 0;
// built-up ground (paved yards, no trees): within 5 m of a real footprint; the north keeps its 2020 trace
const built = new Uint8Array(MASK * MASK);
for (const [x, z, a2, w, d, , parts] of FOOTPRINTS) {
  const c = Math.cos(a2), sn = Math.sin(a2), rects = parts || [[0, 0, w, d]];
  for (const [u, v, pw, pd] of rects) {
    const cx = x + u * c + v * sn, cz = z - u * sn + v * c, Rr = Math.hypot(pw, pd) / 2 + 6;
    for (let zz = cz - Rr; zz <= cz + Rr; zz += 1.5) for (let xx = cx - Rr; xx <= cx + Rr; xx += 1.5) {
      const dx = xx - cx, dz = zz - cz, lu = dx * c - dz * sn, lv = dx * sn + dz * c;
      if (Math.abs(lu) > pw / 2 + 5 || Math.abs(lv) > pd / 2 + 5) continue;
      const i = Math.floor(xx / 3), j = Math.floor(zz / 3); if (i >= 0 && j >= 0 && i < MASK && j < MASK) built[j * MASK + i] = 1;
    }
  }
}
for (let k = 450 * MASK; k < raw.length; k++) if (covered[k]) raw[k] = (raw[k] & ~2) | (built[k] ? 2 : 0);
// the snowy north (z < 1350 m): its roads don't read on the tac map, keep the 2020 trace there and add to it
for (let k = 0; k < raw.length; k++) { if (raw[k] & 1) before++; if (!covered[k]) continue; raw[k] = (raw[k] & ~1) | road[k] | (k < 450 * MASK ? raw[k] & 1 : 0); }
for (let k = 0; k < raw.length; k++) if (raw[k] & 1) after++;
fs.writeFileSync('public/map/masks.bin', zlib.deflateSync(raw, { level: 9 }));
console.log('road cells', before, '->', after);
