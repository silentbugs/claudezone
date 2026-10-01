import fs from 'fs';
import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
const RES = 0.75, M = 4320, N = M * M, img = fs.readFileSync('.harness/ref/vd2025_world.rgb');
// building mask of the real map: bright outlines + everything they enclose
const O = new Uint8Array(N); for (let i = 0; i < N; i++) { const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2]; O[i] = r > 158 && r < 240 && Math.abs(r - b) < 16 && Math.abs(r - g) < 12 ? 1 : 0; }
const Oc = new Uint8Array(N); for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) { const i = y * M + x; Oc[i] = O[i] | O[i - 1] | O[i + 1] | O[i - M] | O[i + M]; }
const out = new Uint8Array(N), st = new Int32Array(N); let sp = 0;
for (let x = 0; x < M; x++) { st[sp++] = x; st[sp++] = (M - 1) * M + x; } for (let y = 0; y < M; y++) { st[sp++] = y * M; st[sp++] = y * M + M - 1; }
while (sp) { const i = st[--sp]; if (out[i] || Oc[i]) continue; out[i] = 1; const x = i % M; if (x > 0) st[sp++] = i - 1; if (x < M - 1) st[sp++] = i + 1; if (i >= M) st[sp++] = i - M; if (i < N - M) st[sp++] = i + M; }
const B = (x: number, z: number) => { const i = Math.floor(x / RES), j = Math.floor(z / RES); return i >= 0 && j >= 0 && i < M && j < M && !out[j * M + i] ? 1 : 0; };
const world: any = generateWorld(loadMasksNode(), 1);
for (const kind of ['superstore', 'tvstation', 'hospital', 'terminal', 'station', 'stadium', 'barbican', 'dam', 'firestation', 'ctower', 'radar']) {
  const ss = world.col.structures.filter((s: any) => s.kind === kind); if (!ss.length) continue;
  // sample points of the landmark's walls / roofs (parts higher than 2 m)
  const pts: [number, number][] = [];
  for (const s of ss.slice(0, kind === 'firestation' ? 1 : 40)) for (const p of s.parts) { if (p.noCollide || p.y1 < 2) continue; for (let v = p.z0; v <= p.z1; v += 1.5) for (let u = p.x0; u <= p.x1; u += 1.5) pts.push([s.x + u * s.cos + v * s.sin, s.z - u * s.sin + v * s.cos]); }
  if (pts.length > 6000) { const k = Math.ceil(pts.length / 6000); for (let i = pts.length - 1; i >= 0; i--) if (i % k) pts.splice(i, 1); }
  let best = { f: -1, dx: 0, dz: 0 }, base = 0;
  for (let dz = -80; dz <= 80; dz += 2) for (let dx = -80; dx <= 80; dx += 2) { let n = 0; for (const [x, z] of pts) n += B(x + dx, z + dz); const f = n / pts.length; if (dx === 0 && dz === 0) base = f; if (f > best.f) best = { f, dx, dz }; }
  const b0 = best; for (let dz = b0.dz - 2; dz <= b0.dz + 2; dz += 0.5) for (let dx = b0.dx - 2; dx <= b0.dx + 2; dx += 0.5) { let n = 0; for (const [x, z] of pts) n += B(x + dx, z + dz); const f = n / pts.length; if (f > best.f) best = { f, dx, dz }; }
  console.log(kind.padEnd(12), 'overlap now', base.toFixed(2), '-> best', best.f.toFixed(2), 'at dx', best.dx, 'dz', best.dz);
}
