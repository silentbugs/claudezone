/**
 * Chunked terrain with distance LODs and a splat shader. Chunks are 64 cells (192 m); each keeps
 * four index-strided versions plus skirts so LOD seams never open.
 */
import * as THREE from 'three';
import type { Heightfield } from '../world/collision';
import type { TerrainExtras } from '../world/terrain';

const CH = 64;
const LODS = [1, 2, 4, 8];
const LOD_DIST = [320, 700, 1400];

export const SHADER_NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm3(vec2 p){ return vn(p)*0.5 + vn(p*2.03)*0.3 + vn(p*4.1)*0.2; }
`;

export class TerrainMesh {
  group = new THREE.Group();
  private chunks: { lods: THREE.Mesh[]; cx: number; cz: number; cur: number }[] = [];
  material: THREE.MeshStandardMaterial;

  constructor(hf: Heightfield, extra: TerrainExtras, tex: THREE.DataArrayTexture) {
    const n = hf.res, sp = hf.step;
    // per-vertex normals (shared by all LODs, sampled at the vertex)
    const normals = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const hl = hf.h[j * n + Math.max(0, i - 1)], hr = hf.h[j * n + Math.min(n - 1, i + 1)];
      const hd = hf.h[Math.max(0, j - 1) * n + i], hu = hf.h[Math.min(n - 1, j + 1) * n + i];
      let nx = hl - hr, ny = 2 * sp, nz = hd - hu; const l = Math.hypot(nx, ny, nz);
      normals[(j * n + i) * 3] = nx / l; normals[(j * n + i) * 3 + 1] = ny / l; normals[(j * n + i) * 3 + 2] = nz / l;
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tLayers = { value: tex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = aSplat;\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNormal = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray tLayers;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n' + SHADER_NOISE)
        .replace('#include <map_fragment>', /* glsl */ `
          vec2 uv = vWPos.xz / 7.0;
          float macro = fbm3(vWPos.xz / 90.0);
          float macro2 = fbm3(vWPos.xz / 23.0 + 7.0);
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          vec3 grass = texture(tLayers, vec3(uv, 0.0)).rgb;
          vec3 dry = texture(tLayers, vec3(uv * 1.1, 1.0)).rgb;
          vec3 dirt = texture(tLayers, vec3(uv, 2.0)).rgb;
          vec3 rock = texture(tLayers, vec3(uv * 0.5, 3.0)).rgb;
          vec3 snow = texture(tLayers, vec3(uv * 0.7, 4.0)).rgb;
          vec3 asph = texture(tLayers, vec3(uv * 0.8, 5.0)).rgb;
          vec3 sand = texture(tLayers, vec3(uv, 6.0)).rgb;
          vec3 ice = texture(tLayers, vec3(uv * 0.3, 7.0)).rgb;
          vec3 pave = texture(tLayers, vec3(vWPos.xz / 6.0, 8.0)).rgb;
          vec3 col = mix(grass, dry, smoothstep(0.45, 0.8, macro) * 0.8);
          col = mix(col, dirt, smoothstep(0.62, 0.8, macro2) * 0.8);
          col = mix(col, rock, smoothstep(0.28, 0.5, slope + (macro2 - 0.5) * 0.25));
          col = mix(col, sand, smoothstep(3.0, 0.8, vWPos.y) * (1.0 - vSplat.x));
          col = mix(col, snow, clamp(vSplat.y * (1.0 - smoothstep(0.45, 0.7, slope) * 0.6), 0.0, 1.0));
          col = mix(col, pave, smoothstep(0.2, 0.6, vSplat.w + (vn(vWPos.xz * 0.2) - 0.5) * 0.3));
          // tyre-worn road edges
          float road = smoothstep(0.25, 0.75, vSplat.x + (vn(vWPos.xz * 0.35) - 0.5) * 0.25);
          col = mix(col, asph, road);
          col = mix(col, ice, step(0.5, vSplat.z) * (1.0 - step(1.5, vSplat.z)));
          col = mix(col, dirt * 0.55, step(1.5, vSplat.z));
          diffuseColor.rgb *= col;
        `)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.75, step(0.5, vSplat.x)) * mix(1.0, 0.25, step(0.5, vSplat.z) * (1.0 - step(1.5, vSplat.z)));');
    };
    this.material = mat;

    const nch = Math.ceil((n - 1) / CH);
    for (let cz = 0; cz < nch; cz++) for (let cx = 0; cx < nch; cx++) {
      const i0 = cx * CH, j0 = cz * CH, i1 = Math.min(n - 1, i0 + CH), j1 = Math.min(n - 1, j0 + CH);
      const lods: THREE.Mesh[] = [];
      for (let li = 0; li < LODS.length; li++) {
        const st = LODS[li];
        const xs: number[] = []; for (let i = i0; i < i1; i += st) xs.push(i); xs.push(i1);
        const zs: number[] = []; for (let j = j0; j < j1; j += st) zs.push(j); zs.push(j1);
        const nx = xs.length, nz = zs.length;
        const vcount = nx * nz + 2 * (nx + nz) * 1;
        const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), spl = new Float32Array(vcount * 4);
        let v = 0;
        const put = (i: number, j: number, drop: number) => {
          const k = j * n + i;
          pos[v * 3] = i * sp; pos[v * 3 + 1] = hf.h[k] - drop; pos[v * 3 + 2] = j * sp;
          nor[v * 3] = normals[k * 3]; nor[v * 3 + 1] = normals[k * 3 + 1]; nor[v * 3 + 2] = normals[k * 3 + 2];
          spl[v * 4] = extra.road[k]; spl[v * 4 + 1] = extra.snow[k]; spl[v * 4 + 2] = extra.river[k]; spl[v * 4 + 3] = extra.paved[k];
          return v++;
        };
        for (const j of zs) for (const i of xs) put(i, j, 0);
        const idx: number[] = [];
        for (let b = 0; b < nz - 1; b++) for (let a = 0; a < nx - 1; a++) {
          const p0 = b * nx + a, p1 = p0 + 1, p2 = p0 + nx, p3 = p2 + 1;
          idx.push(p0, p2, p3, p0, p3, p1);
        }
        // skirts
        const skirt = (edge: number[]) => {
          const base = v;
          for (const e of edge) { const i = xsOf(e), j = zsOf(e); put(i, j, 6 * st); }
          for (let q = 0; q < edge.length - 1; q++) { const a = edge[q], b = edge[q + 1], c = base + q, d = base + q + 1; idx.push(a, c, b, b, c, d, a, b, c, b, d, c); }
        };
        const gridI = (e: number) => e % nx, gridJ = (e: number) => Math.floor(e / nx);
        const xsOf = (e: number) => xs[gridI(e)], zsOf = (e: number) => zs[gridJ(e)];
        skirt(Array.from({ length: nx }, (_, a) => a));
        skirt(Array.from({ length: nx }, (_, a) => (nz - 1) * nx + a));
        skirt(Array.from({ length: nz }, (_, b) => b * nx));
        skirt(Array.from({ length: nz }, (_, b) => b * nx + nx - 1));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
        geo.setAttribute('aSplat', new THREE.BufferAttribute(spl.subarray(0, v * 4), 4));
        geo.setIndex(idx);
        geo.computeBoundingSphere(); geo.computeBoundingBox();
        const m = new THREE.Mesh(geo, mat);
        m.receiveShadow = true; m.castShadow = li === 0 ? false : false;
        m.visible = false; m.matrixAutoUpdate = false;
        this.group.add(m); lods.push(m);
      }
      this.chunks.push({ lods, cx: (i0 + i1) / 2 * sp, cz: (j0 + j1) / 2 * sp, cur: -1 });
    }
  }

  update(cam: THREE.Vector3) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z) - 96;
      let l = 0; while (l < LOD_DIST.length && d > LOD_DIST[l]) l++;
      if (l !== c.cur) { if (c.cur >= 0) c.lods[c.cur].visible = false; c.lods[l].visible = true; c.cur = l; }
    }
  }
}
