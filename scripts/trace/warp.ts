import fs from 'fs';
const S = process.env.S!, F = JSON.parse(fs.readFileSync(S + '/field.json', 'utf8'));
const W = 5574, raw = fs.readFileSync(S + '/vd2025.rgb');
const { G, N, C, MW, MI, nodes } = F;
const toImg = (x: number, z: number) => {
  const wx = x - MW[0], wy = z - MW[1]; let ix = C[0] * wx - C[1] * wy + MI[0], iy = C[1] * wx + C[0] * wy + MI[1];
  const fi = Math.max(0, Math.min(N - 1.001, x / G)), fj = Math.max(0, Math.min(N - 1.001, z / G)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const n = (a: number, b: number) => nodes[b * N + a];
  const dx = (1 - u) * (1 - v) * n(i, j).dx + u * (1 - v) * n(i + 1, j).dx + (1 - u) * v * n(i, j + 1).dx + u * v * n(i + 1, j + 1).dx;
  const dy = (1 - u) * (1 - v) * n(i, j).dy + u * (1 - v) * n(i + 1, j).dy + (1 - u) * v * n(i, j + 1).dy + u * v * n(i + 1, j + 1).dy;
  return [ix + dx, iy + dy];
};
const RES = 0.75, M = Math.round(3240 / RES), out = Buffer.alloc(M * M * 3);
for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
  const [ix, iy] = toImg((i + 0.5) * RES, (j + 0.5) * RES);
  const x0 = Math.floor(ix), y0 = Math.floor(iy), fx = ix - x0, fy = iy - y0, o = (j * M + i) * 3;
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= W - 1) continue;
  for (let c = 0; c < 3; c++) { const p = (yy: number, xx: number) => raw[(yy * W + xx) * 3 + c]; out[o + c] = Math.round((1 - fx) * (1 - fy) * p(y0, x0) + fx * (1 - fy) * p(y0, x0 + 1) + (1 - fx) * fy * p(y0 + 1, x0) + fx * fy * p(y0 + 1, x0 + 1)); }
}
fs.writeFileSync('/workspace/.harness/ref/vd2025_world.rgb', out);
fs.writeFileSync('/workspace/.harness/ref/vd2025_world.json', JSON.stringify({ res: RES, size: M, note: 'Verdansk 2025 (BO6 S3 Reloaded) tac map from callofduty.fandom.com, warped into world metres (x right, z down) by a displacement field fitted to the 2020 built-up mask. Reference only; not shipped.' }));
console.log('warped', M);
