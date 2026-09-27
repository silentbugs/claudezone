import test from 'node:test';
import fs from 'node:fs';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { POIS } from '../src/world/mapdata';

test('hillshade preview (writes .build/hillshade.rgba)', { skip: !process.env.PREVIEW }, () => {
  const w = generateWorld(loadMasksNode(), 1); const { hf, extra } = w;
  const N = 1080, out = new Uint8Array(N * N * 4), s = hf.size / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * s, z = j * s, h = hf.at(x, z), [nx, ny, nz] = hf.normal(x, z);
    const sh = Math.max(0, nx * -0.5 + ny * 0.7 + nz * -0.5) ;
    let r = 90 + h * 0.6, g = 110 + h * 0.4, b = 60;
    const k = Math.round(z / hf.step) * hf.res + Math.round(x / hf.step);
    if (extra.road[k] > 0.3) { r = 200; g = 190; b = 170; }
    if (extra.snow[k] > 0.5) { r = 235; g = 238; b = 245; }
    if (extra.river[k] === 1) { r = 190; g = 220; b = 240; }
    if (h < 0 || extra.river[k] === 2) { r = 30; g = 70; b = 110; }
    const o = (j * N + i) * 4; out[o] = Math.min(255, r * sh * 1.3); out[o + 1] = Math.min(255, g * sh * 1.3); out[o + 2] = Math.min(255, b * sh * 1.3); out[o + 3] = 255;
  }
  for (const st of w.col.structures) { if (st.kind === 'tree') continue; for (const p of st.parts) { if (p.y1 < 0.2) continue; for (let v = p.z0; v <= p.z1; v += 1.5) for (let u = p.x0; u <= p.x1; u += 1.5) { const x = st.x + u * st.cos + v * st.sin, z = st.z - u * st.sin + v * st.cos; const o = (Math.round(z / s) * N + Math.round(x / s)) * 4; if (o < 0 || o >= out.length) continue; out[o] = st.kind === 'prop' ? 255 : 240; out[o + 1] = st.kind === 'prop' ? 60 : 240; out[o + 2] = st.kind === 'prop' ? 60 : 255; } } }
  for (const tr of w.trees) { const o = (Math.round(tr.z / s) * N + Math.round(tr.x / s)) * 4; out[o] = 20; out[o + 1] = 90; out[o + 2] = 30; }
  for (const p of POIS) for (let a = 0; a < 6.28; a += 0.02) { const i = Math.round((p.x + Math.cos(a) * 12) / s), j = Math.round((p.z + Math.sin(a) * 12) / s); const o = (j * N + i) * 4; out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; }
  fs.writeFileSync('.build/hillshade.rgba', out);
});
