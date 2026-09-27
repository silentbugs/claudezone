/** Renders the tactical map (monochrome Warzone-style) once from the world data. */
import type { WorldData } from '../world/mapgen';
import { Mat } from '../world/collision';

export function renderTacMap(w: WorldData, size = 1620): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  const hf = w.hf, S = hf.size / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i * S, z = j * S, h = hf.at(x, z);
    const k = Math.round(z / hf.step) * hf.res + Math.round(x / hf.step);
    const [nx, ny, nz] = hf.normal(x, z);
    const shade = Math.max(0.35, Math.min(1.25, 0.75 + (-nx * 0.6 - nz * 0.5) * 1.8 + (ny - 0.9)));
    let r: number, gg: number, b: number;
    if (h < 0 || w.extra.river[k] === 2) { const d = Math.min(1, -h / 20); r = 38 - d * 12; gg = 58 - d * 14; b = 66 - d * 10; }
    else if (w.extra.river[k] === 1) { r = 170; gg = 182; b = 188; }
    else {
      const snow = w.extra.snow[k], road = w.extra.road[k];
      r = 92 + h * 0.08; gg = 98 + h * 0.06; b = 84;
      r += (206 - r) * snow; gg += (210 - gg) * snow; b += (212 - b) * snow;
      r *= shade; gg *= shade; b *= shade;
      if (road > 0.35) { r = gg = b = 138; }
    }
    const o = (j * size + i) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // buildings: footprints of tall parts
  g.lineWidth = Math.max(1, size / 1620);
  for (const s of w.col.structures) {
    if (s.kind === 'tree' || s.kind === 'gulag' || s.kind === 'prop') continue;
    const c = s.cos, sn = s.sin;
    const k = 1 / S;
    const draw = (x0: number, z0: number, x1: number, z1: number) => {
      const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([u, v]) => [(s.x + u * c + v * sn) * k, (s.z - u * sn + v * c) * k]);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let q = 1; q < 4; q++) g.lineTo(pts[q][0], pts[q][1]); g.closePath(); g.fill(); g.stroke();
    };
    g.fillStyle = s.kind === 'runway' ? '#4c4e50' : '#b9bcbc'; g.strokeStyle = s.kind === 'runway' ? '#4c4e50' : '#e8eaea';
    if (s.kind === 'runway') { for (const p of s.parts) if (p.mat === Mat.Asphalt) draw(p.x0, p.z0, p.x1, p.z1); continue; }
    if (s.parts.length > 8 || s.kind === 'house') draw(s.bx0, s.bz0, s.bx1, s.bz1);
    else for (const p of s.parts) if (p.y1 > 1) draw(p.x0, p.z0, p.x1, p.z1);
  }
  return cv;
}
