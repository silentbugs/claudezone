import fs from 'fs';
import { loadMasksNode } from '/workspace/test/util';
const masks = loadMasksNode();
const W = 5574, raw = fs.readFileSync(process.env.S + '/vd2025.rgb');
const B = new Uint8Array(W * W); for (let i = 0; i < W * W; i++) { const r = raw[i * 3], b = raw[i * 3 + 2]; B[i] = r > 160 && Math.abs(r - b) < 14 && r < 235 ? 1 : 0; }
const SAT = new Float64Array((W + 1) * (W + 1)); for (let y = 0; y < W; y++) { let row = 0; for (let x = 0; x < W; x++) { row += B[y * W + x]; SAT[(y + 1) * (W + 1) + x + 1] = SAT[y * (W + 1) + x + 1] + row; } }
const dens = (x: number, y: number, r: number) => { const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r), y1 = Math.min(W, y + r); if (x1 <= x0 || y1 <= y0) return 0; return (SAT[y1 * (W + 1) + x1] - SAT[y0 * (W + 1) + x1] - SAT[y1 * (W + 1) + x0] + SAT[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
const C = [1.5008, 0.04629], MW = [1606.71, 1887], MI = [2694.57, 3031.43];
const toImg = (x: number, z: number) => { const wx = x - MW[0], wy = z - MW[1]; return [C[0] * wx - C[1] * wy + MI[0], C[1] * wx + C[0] * wy + MI[1]]; };
function ncc(cx: number, cz: number, half: number, dx: number, dy: number, st: number) {
  let sab = 0, sa = 0, sb = 0, saa = 0, sbb = 0, n = 0;
  for (let z = cz - half; z < cz + half; z += st) for (let x = cx - half; x < cx + half; x += st) {
    const a = masks.has(x, z, 2) ? 1 : 0; const [ix, iy] = toImg(x, z); const b = dens(Math.round(ix + dx), Math.round(iy + dy), 6);
    sab += a * b; sa += a; sb += b; saa += a * a; sbb += b * b; n++;
  }
  const cov = sab / n - sa / n * sb / n, va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2; return va > 1e-4 && vb > 1e-8 ? cov / Math.sqrt(va * vb) : 0;
}
const G = 200, N = Math.floor(3240 / G) + 1, nodes: { x: number; z: number; dx: number; dy: number; r: number; ok: boolean }[] = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = i * G, z = j * G;
  let built = 0, tot = 0; for (let zz = z - 220; zz < z + 220; zz += 12) for (let xx = x - 220; xx < x + 220; xx += 12) { tot++; if (masks.has(xx, zz, 2)) built++; }
  if (built / tot < 0.04) { nodes.push({ x, z, dx: 0, dy: 0, r: 0, ok: false }); continue; }
  let best = { r: -9, dx: 0, dy: 0 };
  for (let dy = -160; dy <= 160; dy += 10) for (let dx = -160; dx <= 160; dx += 10) { const r = ncc(x, z, 220, dx, dy, 5); if (r > best.r) best = { r, dx, dy }; }
  const b0 = best; for (let dy = b0.dy - 10; dy <= b0.dy + 10; dy += 2) for (let dx = b0.dx - 10; dx <= b0.dx + 10; dx += 2) { const r = ncc(x, z, 220, dx, dy, 4); if (r > best.r || best === b0) best = { r, dx, dy }; }
  nodes.push({ x, z, dx: best.dx, dy: best.dy, r: best.r, ok: best.r > 0.2 });
}
// fill and smooth: weak nodes take the inverse-distance mean of good ones; then a 3x3 median-ish smoothing
const good = nodes.filter((n) => n.ok);
for (const n of nodes) if (!n.ok) { let sw = 0, sx = 0, sy = 0; for (const g of good) { const w = 1 / (1 + ((g.x - n.x) ** 2 + (g.z - n.z) ** 2) / 1e5); sw += w; sx += g.dx * w; sy += g.dy * w; } n.dx = sx / sw; n.dy = sy / sw; }
const sm = nodes.map((n, k) => { const i = k % N, j = Math.floor(k / N); const xs: number[] = [], ys: number[] = []; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const m = nodes[jj * N + ii]; xs.push(m.dx); ys.push(m.dy); } xs.sort((p, q) => p - q); ys.sort((p, q) => p - q); return { ...n, dx: (n.dx + xs[xs.length >> 1]) / 2, dy: (n.dy + ys[ys.length >> 1]) / 2 }; });
fs.writeFileSync(process.env.S + '/field.json', JSON.stringify({ G, N, C, MW, MI, nodes: sm }));
console.log('good nodes', good.length, '/', nodes.length);
for (let j = 0; j < N; j += 2) console.log(sm.filter((_, k) => Math.floor(k / N) === j && (k % N) % 2 === 0).map((n) => `${n.ok ? '*' : ' '}${n.dx.toFixed(0).padStart(4)},${n.dy.toFixed(0).padStart(4)}`).join(' '));
