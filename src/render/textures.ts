/**
 * Procedural textures (no shipped art): generated on canvases at startup and uploaded as
 * DataArrayTextures so one shader can pick a material layer per vertex.
 */
import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { fbm, clamp } from '../core/math';

type Px = (u: number, v: number) => [number, number, number];

function layer(size: number, fn: Px, out: Uint8Array, offset: number) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = fn(x / size, y / size);
    const i = offset + (y * size + x) * 4;
    out[i] = clamp(r, 0, 255); out[i + 1] = clamp(g, 0, 255); out[i + 2] = clamp(b, 0, 255); out[i + 3] = 255;
  }
}
/** tileable fbm: sample on a torus-ish wrap by blending */
function tfbm(u: number, v: number, f: number, oct: number, seed: number) {
  const a = fbm(u * f, v * f, oct, seed), b = fbm((u - 1) * f, v * f, oct, seed), c = fbm(u * f, (v - 1) * f, oct, seed), d = fbm((u - 1) * f, (v - 1) * f, oct, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
const cell = (u: number, v: number, n: number, s: number) => hash2(Math.floor(u * n), Math.floor(v * n), s);

/** Building material layers, index = Mat enum. */
export function materialArray(size = 256): THREE.DataArrayTexture {
  const L = 16, data = new Uint8Array(size * size * 4 * L);
  const g = (base: number, n: number) => base + (n - 0.5) * 60;
  const fns: Px[] = [
    // 0 concrete: board-formed panels, stains
    (u, v) => { const n = tfbm(u, v, 8, 4, 1); const seam = (v * 4) % 1 < 0.015 || (u * 2) % 1 < 0.01 ? -25 : 0; const stain = tfbm(u, v, 3, 3, 9) > 0.62 ? -18 : 0; const c = g(200, n) + seam + stain; return [c, c * 0.99, c * 0.96]; },
    // 1 brick
    (u, v) => { const row = Math.floor(v * 16), off = row % 2 ? 0.5 / 6 : 0; const bu = (u + off) * 6, mortar = (v * 16) % 1 < 0.14 || bu % 1 < 0.05; const n = tfbm(u, v, 16, 3, 2) * 40 + cell(u + off, v, 6, 3) * 30; return mortar ? [215, 210, 200] : [150 + n * 0.8, 140 + n * 0.6, 132 + n * 0.5]; },
    // 2 plaster
    (u, v) => { const n = tfbm(u, v, 10, 4, 3); const c = g(225, n); return [c, c * 0.98, c * 0.94]; },
    // 3 metal (corrugated)
    (u, v) => { const cor = Math.sin(u * Math.PI * 40) * 12; const n = tfbm(u, v, 6, 3, 4); const rust = tfbm(u, v, 4, 4, 5) > 0.66 ? 1 : 0; const c = g(190, n) + cor; return rust ? [c * 0.8 + 30, c * 0.6, c * 0.45] : [c, c, c * 1.02]; },
    // 4 wood planks
    (u, v) => { const plank = Math.floor(v * 8); const n = tfbm(u * 0.2, v, 30, 3, 6 + plank) * 50; const gap = (v * 8) % 1 < 0.05 ? -40 : 0; return [150 + n + gap, 110 + n * 0.8 + gap, 75 + n * 0.5 + gap]; },
    // 5 glass
    (u, v) => { const n = tfbm(u, v, 3, 2, 7); const c = 70 + n * 50; return [c * 0.8, c * 0.95, c * 1.1]; },
    // 6 rock
    (u, v) => { const n = tfbm(u, v, 5, 5, 8); const c = g(165, n); return [c, c * 0.97, c * 0.92]; },
    // 7 asphalt
    (u, v) => { const n = tfbm(u, v, 20, 3, 9) * 0.6 + hash2(Math.floor(u * 256), Math.floor(v * 256), 1) * 0.4; const c = 95 + n * 40; return [c, c, c * 1.02]; },
    // 8 roof (tar / shingles)
    (u, v) => { const row = Math.floor(v * 20), sh = (v * 20) % 1 < 0.1 ? -30 : 0; const n = tfbm(u, v, 10, 3, 10) * 22 + cell(u + (row % 2) * 0.05, v, 10, row) * 10; const c = 190 + n + sh * 0.5; return [c, c * 0.98, c * 0.95]; },
    // 9 container (vertical corrugation)
    (u, v) => { const cor = ((u * 24) % 1 < 0.5 ? 15 : -10); const n = tfbm(u, v, 6, 3, 11); const c = g(210, n) + cor; const rust = tfbm(u, v, 5, 4, 12) > 0.68; return rust ? [c * 0.75 + 20, c * 0.55, c * 0.4] : [c, c, c]; },
    // 10 trim (flat paint)
    (u, v) => { const n = tfbm(u, v, 8, 2, 13); const c = g(235, n * 0.4); return [c, c, c]; },
    // 11 dark
    (u, v) => { const n = tfbm(u, v, 8, 2, 14); const c = 40 + n * 20; return [c, c, c]; },
    // 12 foliage
    (u, v) => { const n = tfbm(u, v, 12, 4, 15); return [70 + n * 40, 95 + n * 50, 50 + n * 20]; },
    // 13 tile
    (u, v) => { const t = (u * 8) % 1 < 0.04 || (v * 8) % 1 < 0.04; const n = tfbm(u, v, 8, 2, 16); return t ? [120, 120, 118] : [205 + n * 30, 200 + n * 30, 190 + n * 30]; },
    // 14 snow
    (u, v) => { const n = tfbm(u, v, 8, 4, 17); const c = 235 + n * 20; return [c * 0.97, c * 0.98, c]; },
    // 15 window facade (for LOD shells): grid of dark windows on light wall
    (u, v) => { const wx = (u * 4) % 1, wy = (v * 4) % 1; const win = wx > 0.2 && wx < 0.8 && wy > 0.3 && wy < 0.75; const n = tfbm(u, v, 8, 2, 18); return win ? [55 + n * 30, 62 + n * 30, 70 + n * 30] : [220 + n * 20, 218 + n * 20, 210 + n * 20]; },
  ];
  fns.forEach((fn, i) => layer(size, fn, data, i * size * size * 4));
  // per-layer mean (linear) so the shader can use textures as detail around 1.0 and let tints set albedo
  const avg: number[] = [];
  for (let l = 0; l < L; l++) {
    let s = 0; const o = l * size * size * 4;
    for (let i = 0; i < size * size; i += 7) { const k = o + i * 4; s += srgbToLin(data[k]) * 0.3 + srgbToLin(data[k + 1]) * 0.59 + srgbToLin(data[k + 2]) * 0.11; }
    avg.push(s / Math.ceil(size * size / 7));
  }
  const tex = new THREE.DataArrayTexture(data, size, size, L);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData.avg = avg;
  return tex;
}
const srgbToLin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

/** Terrain layers: 0 grass, 1 dry grass, 2 dirt, 3 rock, 4 snow, 5 asphalt, 6 sand, 7 ice, 8 pavement. */
export function terrainArray(size = 256): THREE.DataArrayTexture {
  const L = 9, data = new Uint8Array(size * size * 4 * L);
  const fns: Px[] = [
    (u, v) => { const n = tfbm(u, v, 16, 5, 21), m = tfbm(u, v, 4, 3, 22); const blade = hash2(Math.floor(u * 512), Math.floor(v * 512), 3) * 22; return [84 + n * 40 + m * 18 + blade, 88 + n * 38 + m * 12 + blade, 62 + n * 22 + blade * 0.5]; },
    (u, v) => { const n = tfbm(u, v, 16, 5, 23); const blade = hash2(Math.floor(u * 512), Math.floor(v * 512), 4) * 25; return [120 + n * 40 + blade, 110 + n * 34 + blade, 82 + n * 24 + blade * 0.6]; },
    (u, v) => { const n = tfbm(u, v, 12, 5, 24); const peb = hash2(Math.floor(u * 180), Math.floor(v * 180), 5) > 0.93 ? 30 : 0; return [118 + n * 50 + peb, 100 + n * 42 + peb, 78 + n * 32 + peb]; },
    (u, v) => { const n = tfbm(u, v, 6, 6, 25), cr = Math.abs(tfbm(u, v, 10, 3, 26) - 0.5) < 0.02 ? -35 : 0; const c = 128 + n * 70 + cr; return [c, c * 0.97, c * 0.92]; },
    (u, v) => { const n = tfbm(u, v, 10, 4, 27); const sp = hash2(Math.floor(u * 512), Math.floor(v * 512), 6) > 0.98 ? 12 : 0; const c = 228 + n * 22 + sp; return [c * 0.96, c * 0.975, c]; },
    (u, v) => { const n = tfbm(u, v, 24, 3, 28) * 0.5 + hash2(Math.floor(u * 512), Math.floor(v * 512), 7) * 0.5; const crack = Math.abs(tfbm(u, v, 5, 3, 29) - 0.5) < 0.012 ? -25 : 0; const c = 78 + n * 38 + crack; return [c, c, c * 1.03]; },
    (u, v) => { const n = tfbm(u, v, 14, 4, 30); return [178 + n * 40, 164 + n * 36, 132 + n * 30]; },
    (u, v) => { const n = tfbm(u, v, 5, 4, 31), cr = Math.abs(tfbm(u, v, 7, 3, 32) - 0.5) < 0.01 ? 30 : 0; return [180 + n * 30 + cr, 205 + n * 25 + cr, 222 + n * 20]; },
    (u, v) => { const seam = (u * 4) % 1 < 0.03 || (v * 4) % 1 < 0.03 ? -28 : 0; const n = tfbm(u, v, 12, 3, 33) * 30 + cell(u, v, 4, 34) * 14; const st = tfbm(u, v, 3, 3, 35) > 0.64 ? -16 : 0; const c = 150 + n + seam + st; return [c, c * 0.98, c * 0.95]; },
  ];
  fns.forEach((fn, i) => layer(size, fn, data, i * size * size * 4));
  const tex = new THREE.DataArrayTexture(data, size, size, L);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Tangent-space normal maps derived from each layer's luminance (Sobel), same layout as the source array. */
export function normalArrayFrom(src: THREE.DataArrayTexture, strength: number[] | number): THREE.DataArrayTexture {
  const { width: W, height: H, depth: L } = src.image as { width: number; height: number; depth: number };
  const data = src.image.data as Uint8Array, out = new Uint8Array(W * H * 4 * L);
  const lum = new Float32Array(W * H);
  for (let l = 0; l < L; l++) {
    const o = l * W * H * 4, k = Array.isArray(strength) ? strength[l] ?? 1 : strength;
    for (let i = 0; i < W * H; i++) lum[i] = (data[o + i * 4] * 0.3 + data[o + i * 4 + 1] * 0.59 + data[o + i * 4 + 2] * 0.11) / 255;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const at = (xx: number, yy: number) => lum[((yy + H) % H) * W + ((xx + W) % W)];
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * k, ny = -dy * k, nz = 1; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const i = o + (y * W + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
  const t = new THREE.DataArrayTexture(out, W, H, L);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** GLSL: perturb a view-space normal with a tangent-space sample using screen derivatives (no tangents needed). */
export const PERTURB_GLSL = /* glsl */ `
vec3 perturbN(vec3 N, vec3 viewPos, vec2 uv, vec3 mapN) {
  vec3 q0 = dFdx(viewPos), q1 = dFdy(viewPos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x, B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + N * mapN.z);
}`;
