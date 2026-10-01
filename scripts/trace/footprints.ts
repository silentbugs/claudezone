import fs from 'fs';
const RES = 0.75, M = 4320, img = fs.readFileSync('/workspace/.harness/ref/vd2025_world.rgb');
const N = M * M;
// 1) outline pixels: bright, neutral grey
const O = new Uint8Array(N);
for (let i = 0; i < N; i++) { const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2]; O[i] = r > 158 && r < 240 && Math.abs(r - b) < 16 && Math.abs(r - g) < 12 ? 1 : 0; }
// 2) close 1-px gaps
const Oc = new Uint8Array(N);
for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) { const i = y * M + x; Oc[i] = O[i] | O[i - 1] | O[i + 1] | O[i - M] | O[i + M]; }
// 3) flood fill the outside over non-outline pixels
const out = new Uint8Array(N), st = new Int32Array(N); let sp = 0;
for (let x = 0; x < M; x++) { st[sp++] = x; st[sp++] = (M - 1) * M + x; } for (let y = 0; y < M; y++) { st[sp++] = y * M; st[sp++] = y * M + M - 1; }
while (sp) { const i = st[--sp]; if (out[i] || Oc[i]) continue; out[i] = 1; const x = i % M; if (x > 0) st[sp++] = i - 1; if (x < M - 1) st[sp++] = i + 1; if (i >= M) st[sp++] = i - M; if (i < N - M) st[sp++] = i + M; }
// 4) components of the not-outside region (outline + enclosed interior)
const lab = new Int32Array(N); let nl = 0; const comps: { px: number[]; ol: number }[] = [];
for (let s = 0; s < N; s++) {
  if (out[s] || lab[s]) continue;
  nl++; const px: number[] = []; let ol = 0; sp = 0; st[sp++] = s; lab[s] = nl;
  while (sp) { const i = st[--sp]; px.push(i); if (O[i]) ol++; const x = i % M; for (const j of [x > 0 ? i - 1 : -1, x < M - 1 ? i + 1 : -1, i - M, i + M]) { if (j < 0 || j >= N || out[j] || lab[j]) continue; lab[j] = nl; st[sp++] = j; } }
  comps.push({ px, ol });
}
// 5) min-area rectangle per component
type FP = { x: number; z: number; ang: number; w: number; d: number; area: number; rect: number; fill: number; round?: boolean; parts?: [number, number, number, number][] };
const fps: FP[] = [];
for (const c of comps) {
  const n = c.px.length, area = n * RES * RES;
  if (area < 14 || area > 40000) continue;
  const fill = 1 - c.ol / n; // interior share (snow / rock highlights are solid outline-coloured blobs)
  let mx = 0, mz = 0; for (const i of c.px) { mx += i % M; mz += (i / M) | 0; } mx /= n; mz /= n;
  let best = { a: 0, ar: Infinity, u0: 0, u1: 0, v0: 0, v1: 0 };
  for (let deg = 0; deg < 90; deg += 1) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const i of c.px) { const x = i % M - mx, z = ((i / M) | 0) - mz, u = x * ca + z * sa, v = -x * sa + z * ca; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const ar = (u1 - u0 + 1) * (v1 - v0 + 1); if (ar < best.ar) best = { a, ar, u0, u1, v0, v1 };
  }
  const rect = n / best.ar;
  const cu = (best.u0 + best.u1) / 2, cv = (best.v0 + best.v1) / 2, ca = Math.cos(best.a), sa = Math.sin(best.a);
  const cx = mx + cu * ca - cv * sa, cz = mz + cu * sa + cv * ca;
  // irregular shapes (L, U, T, merged neighbours): cover with the biggest rectangles in the footprint's own frame
  let parts: [number, number, number, number][] | undefined;
  const W0 = Math.round(best.u1 - best.u0 + 1), H0 = Math.round(best.v1 - best.v0 + 1);
  const round = rect > 0.72 && rect < 0.83 && Math.abs(W0 - H0) / Math.max(W0, H0) < 0.12 && area < 1500;
  if (rect < 0.85 && !round) {
    const g = new Uint8Array(W0 * H0);
    for (const i of c.px) { const x = i % M - mx, z = ((i / M) | 0) - mz, u = Math.round(x * ca + z * sa - best.u0), v = Math.round(-x * sa + z * ca - best.v0); if (u >= 0 && v >= 0 && u < W0 && v < H0) g[v * W0 + u] = 1; }
    // fill single-pixel holes so the rectangle search is not broken by rasterisation gaps
    for (let v = 1; v < H0 - 1; v++) for (let u = 1; u < W0 - 1; u++) if (!g[v * W0 + u] && g[v * W0 + u - 1] + g[v * W0 + u + 1] + g[(v - 1) * W0 + u] + g[(v + 1) * W0 + u] >= 3) g[v * W0 + u] = 2;
    const cov = new Uint8Array(W0 * H0); let total = 0; for (const q of g) if (q) total++;
    parts = []; let covered = 0;
    const minS = Math.round(3.5 / RES);
    for (let it = 0; it < 6 && covered < total * 0.93; it++) {
      // largest all-filled rectangle that adds the most uncovered pixels (histogram method per row)
      let bestR = { gain: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
      const hgt = new Int32Array(W0);
      for (let v = 0; v < H0; v++) {
        for (let u = 0; u < W0; u++) hgt[u] = g[v * W0 + u] ? hgt[u] + 1 : 0;
        for (let u = 0; u < W0; u++) { let h = Infinity; for (let u2 = u; u2 < W0 && hgt[u2] > 0; u2++) { h = Math.min(h, hgt[u2]); const w = u2 - u + 1; if (w < minS || h < minS) continue; const ar = w * h; if (ar <= bestR.gain) continue; let clash = false; for (let vv = v - h + 1; vv <= v && !clash; vv++) for (let uu = u; uu <= u2; uu++) if (cov[vv * W0 + uu]) { clash = true; break; } if (clash) continue; const gain = ar; if (gain > bestR.gain) bestR = { gain, u0: u, v0: v - h + 1, u1: u2, v1: v }; } }
      }
      if (bestR.gain < minS * minS) break;
      for (let vv = bestR.v0; vv <= bestR.v1; vv++) for (let uu = bestR.u0; uu <= bestR.u1; uu++) { if (!cov[vv * W0 + uu]) covered++; cov[vv * W0 + uu] = 1; }
      // part centre relative to the footprint centre, in its frame (metres)
      const pu = ((bestR.u0 + bestR.u1 + 1) / 2 - W0 / 2) * RES, pv = ((bestR.v0 + bestR.v1 + 1) / 2 - H0 / 2) * RES;
      parts.push([+pu.toFixed(2), +pv.toFixed(2), +((bestR.u1 - bestR.u0 + 1) * RES).toFixed(2), +((bestR.v1 - bestR.v0 + 1) * RES).toFixed(2)]);
    }
    if (!parts.length) parts = undefined;
  }
  fps.push({ round: round || undefined, parts, x: +((cx + 0.5) * RES).toFixed(2), z: +((cz + 0.5) * RES).toFixed(2), ang: +best.a.toFixed(4), w: +((best.u1 - best.u0 + 1) * RES).toFixed(2), d: +((best.v1 - best.v0 + 1) * RES).toFixed(2), area: +area.toFixed(1), rect: +rect.toFixed(3), fill: +fill.toFixed(3) });
}
fs.writeFileSync(process.env.S + '/fp_raw.json', JSON.stringify(fps));
console.log('components', comps.length, 'kept', fps.length);
const hist = (f: (p: FP) => number, edges: number[]) => edges.map((e, k) => `${e}+:${fps.filter((p) => f(p) >= e && (k === edges.length - 1 || f(p) < edges[k + 1])).length}`).join(' ');
console.log('area', hist((p) => p.area, [14, 40, 80, 150, 300, 600, 1200, 3000]));
console.log('rect', hist((p) => p.rect, [0, 0.5, 0.7, 0.8, 0.9, 0.95]));
console.log('fill', hist((p) => p.fill, [0, 0.2, 0.4, 0.6, 0.8]));
