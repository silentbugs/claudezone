/** Renders the tactical map (monochrome Warzone-style) once from the world data. */
import type { WorldData } from '../world/mapgen';
import { Mat } from '../world/collision';

export function renderTacMap(w: WorldData, size = 1620): HTMLCanvasElement { return renderTacRegion(w, 0, 0, w.hf.size, size); }

/**
 * The tac map for the square [x0, x0+span] × [z0, z0+span] at `size` px. Zoomed-in tiles (fine metres per
 * pixel) draw every wall of every building, doors as gaps, and trees, like the 2020 map's close zoom.
 */
export function renderTacRegion(w: WorldData, x0: number, z0: number, span: number, size: number): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  const hf = w.hf, S = span / size, detail = S < 1.3;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = x0 + i * S, z = z0 + j * S, h = hf.at(x, z);
    const k = Math.round(z / hf.step) * hf.res + Math.round(x / hf.step);
    const [nx, ny, nz] = hf.normal(x, z);
    // 2020 tac map: a greyscale "satellite" look - strong hillshade, fine grain, pale roads, near-black water
    const shade = Math.max(0.3, Math.min(1.35, 0.72 + (-nx * 0.6 - nz * 0.5) * 2.2 + (ny - 0.9)));
    const grain = (hash(Math.floor(x * 0.9), Math.floor(z * 0.9)) - 0.5) * 14 + (hash(Math.floor(x / 7), Math.floor(z / 7)) - 0.5) * 10;
    let r: number, gg: number, b: number;
    if (h < 0 || w.extra.river[k] === 2) { const d = Math.min(1, -h / 20); r = 44 - d * 12; gg = 48 - d * 12; b = 52 - d * 12; }
    else if (w.extra.river[k] === 1) { r = 176; gg = 178; b = 180; }
    else {
      const snow = w.extra.snow[k], road = w.extra.road[k];
      r = gg = b = 104 + h * 0.07 + grain;
      r += (214 - r) * snow; gg += (216 - gg) * snow; b += (218 - b) * snow;
      r *= shade; gg *= shade; b *= shade;
      if (road > 0.35) { r = gg = b = road > 0.6 ? 168 : 128; }
    }
    const o = (j * size + i) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // buildings: pale roofs with a dark outline and a soft south-east drop shadow (2020)
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowOffsetX = g.shadowOffsetY = Math.max(1, 1.2 / S); g.shadowBlur = Math.max(1, 1 / S);
  g.lineWidth = detail ? 1 : Math.max(1, size / 1620);
  const k = 1 / S;
  for (const s of w.col.structures) {
    if (s.kind === 'gulag' || s.kind === 'prop' || s.kind === 'door') continue;
    if (s.x + s.radius < x0 || s.x - s.radius > x0 + span || s.z + s.radius < z0 || s.z - s.radius > z0 + span) continue;
    if (s.kind === 'tree') { if (detail) { g.fillStyle = 'rgba(38,40,40,0.8)'; g.beginPath(); g.arc((s.x - x0) * k, (s.z - z0) * k, Math.max(1.5, 2.2 * k), 0, Math.PI * 2); g.fill(); } continue; }
    const c = s.cos, sn = s.sin;
    const draw = (ax: number, az: number, bx: number, bz: number) => {
      const pts = [[ax, az], [bx, az], [bx, bz], [ax, bz]].map(([u, v]) => [(s.x + u * c + v * sn - x0) * k, (s.z - u * sn + v * c - z0) * k]);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let q = 1; q < 4; q++) g.lineTo(pts[q][0], pts[q][1]); g.closePath(); g.fill(); g.stroke();
    };
    g.fillStyle = s.kind === 'runway' ? '#4a4a4a' : '#cfcfcf'; g.strokeStyle = s.kind === 'runway' ? '#4a4a4a' : '#2e2e2e';
    if (s.kind === 'runway') { for (const p of s.parts) if (p.mat === Mat.Asphalt) draw(p.x0, p.z0, p.x1, p.z1); continue; }
    if (detail && s.kind !== 'runway') {
      // close zoom: pale roof footprint, then every wall (openings show as gaps)
      g.fillStyle = '#b4b4b4'; g.strokeStyle = 'rgba(0,0,0,0)'; draw(s.bx0, s.bz0, s.bx1, s.bz1); g.shadowColor = 'rgba(0,0,0,0)';
      g.fillStyle = '#383838'; g.strokeStyle = '#383838';
      for (const p of s.parts) if (!p.noCollide && p.y0 < 2.5 && p.y1 - p.y0 > 1.5 && Math.min(p.x1 - p.x0, p.z1 - p.z0) < 1.3) draw(p.x0, p.z0, p.x1, p.z1);
      g.fillStyle = '#808080'; g.strokeStyle = '#808080';
      for (const r of s.ramps) if (r.mat !== Mat.Roof) draw(r.x0, r.z0, r.x1, r.z1);
      g.shadowColor = 'rgba(0,0,0,0.45)';
      continue;
    }
    if (s.parts.length > 8 || s.kind === 'house') draw(s.bx0, s.bz0, s.bx1, s.bz1);
    else for (const p of s.parts) if (p.y1 > 1) draw(p.x0, p.z0, p.x1, p.z1);
  }
  return cv;
}

function hash(x: number, z: number) { let h = (x * 374761393 + z * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
