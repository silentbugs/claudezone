/**
 * Turns collision structures into merged, chunked render geometry. Each chunk has:
 *  - detail mesh (every part, textured by material layer + tint),
 *  - glass mesh (transparent),
 *  - LOD shell (one facade-textured box per structure) swapped in at distance.
 */
import * as THREE from 'three';
import { Mat, Structure, Part, RampPart } from '../world/collision';
import { releaseAfterUpload } from './release';
import { normalArrayFrom, PERTURB_GLSL } from './textures';

const CHUNK = 192;
const DETAIL_DIST = 460;

/** texture metres per repeat for each material layer */
const SCALE: Record<number, number> = { [Mat.Concrete]: 4, [Mat.Brick]: 2.4, [Mat.Plaster]: 3, [Mat.Metal]: 3, [Mat.Wood]: 2, [Mat.Glass]: 3, [Mat.Rock]: 5, [Mat.Asphalt]: 6, [Mat.Roof]: 3, [Mat.Container]: 2.5, [Mat.Trim]: 2, [Mat.Dark]: 2, [Mat.Foliage]: 2, [Mat.Tile]: 2, [Mat.Snow]: 4, [Mat.Water]: 4 };
const DEFAULT_TINT: Record<number, number> = { [Mat.Concrete]: 0xb4b0a8, [Mat.Brick]: 0xffffff, [Mat.Plaster]: 0xe0dccf, [Mat.Metal]: 0x9aa0a4, [Mat.Wood]: 0xc8b8a0, [Mat.Glass]: 0x3c4c56, [Mat.Rock]: 0xa8a298, [Mat.Asphalt]: 0x8a8a8a, [Mat.Roof]: 0xa8a6a2, [Mat.Container]: 0x8a3a2a, [Mat.Trim]: 0xdddddd, [Mat.Dark]: 0x333333, [Mat.Foliage]: 0x6a8a4a, [Mat.Tile]: 0xdddddd, [Mat.Snow]: 0xffffff, [Mat.Water]: 0x335566 };

class GeoBuf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; lay: number[] = []; idx: number[] = [];
  get count() { return this.pos.length / 3; }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    // compact vertex format: float32 position, int8 normal, half-float uv, uint8 colour + layer
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(this.nor, (v) => Math.round(v * 127)), 3, true));
    g.setAttribute('uv', new THREE.Float16BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(Uint8Array.from(this.col, (v) => Math.min(255, Math.round(Math.sqrt(Math.max(0, v)) * 255))), 3, true));
    g.setAttribute('aLayer', new THREE.BufferAttribute(Uint8Array.from(this.lay), 1, false));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    releaseAfterUpload(g);
    return g;
  }
}

const tmpC = new THREE.Color();

/** Emits quads in structure-local space, transformed to world. */
class Emitter {
  s!: Structure;
  b!: GeoBuf;
  layer = 0; r = 1; g = 1; bl = 1; scale = 3; aoBase = false; aoY = 0;
  setPart(s: Structure, b: GeoBuf, mat: Mat, color: number | undefined) {
    this.s = s; this.b = b; this.layer = mat; this.scale = SCALE[mat] ?? 3;
    tmpC.setHex(color ?? DEFAULT_TINT[mat] ?? 0xffffff); // setHex already converts sRGB -> linear
    // subtle per-structure variation
    const v = 0.92 + ((s.id * 2654435761) >>> 24) / 255 * 0.14;
    this.r = tmpC.r * v; this.g = tmpC.g * v; this.bl = tmpC.b * v;
  }
  /** quad with local corners (counter-clockwise seen from outside), local normal, uv axes */
  quad(p: number[][], n: number[], shade = 1) {
    const s = this.s, b = this.b, base = b.count;
    const wnx = n[0] * s.cos + n[2] * s.sin, wnz = -n[0] * s.sin + n[2] * s.cos;
    // choose uv projection by dominant local normal axis
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    for (const q of p) {
      const wx = s.x + q[0] * s.cos + q[2] * s.sin, wz = s.z - q[0] * s.sin + q[2] * s.cos, wy = s.y + q[1];
      b.pos.push(wx, wy, wz); b.nor.push(wnx, n[1], wnz);
      let u: number, v: number;
      if (ay >= ax && ay >= az) { u = q[0]; v = q[2]; } else if (ax >= az) { u = q[2]; v = q[1]; } else { u = q[0]; v = q[1]; }
      b.uv.push(u / this.scale, v / this.scale);
      const ao = this.aoBase && ay < 0.5 ? 0.62 + 0.38 * Math.min(1, Math.max(0, (q[1] - this.aoY) / 1.6)) : 1;
      b.col.push(this.r * shade * ao, this.g * shade * ao, this.bl * shade * ao); b.lay.push(this.layer);
    }
    if (p.length === 4) b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else b.idx.push(base, base + 1, base + 2);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bottom: boolean) {
    this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    this.quad([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], [-1, 0, 0]);
    this.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]);
    if (bottom) this.quad([[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [0, -1, 0], 0.8);
    this.quad([[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]], [0, 0, 1]);
    this.quad([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]);
  }
  gable(p: Part) {
    const { x0, y0, z0, x1, y1, z1 } = p, zm = (z0 + z1) / 2, h = y1 - y0, dz = (z1 - z0) / 2;
    const l = Math.hypot(h, dz);
    this.quad([[x0, y0, z0], [x0, y1, zm], [x1, y1, zm], [x1, y0, z0]], [0, dz / l, -h / l]);
    this.quad([[x1, y0, z1], [x1, y1, zm], [x0, y1, zm], [x0, y0, z1]], [0, dz / l, h / l]);
    this.quad([[x1, y0, z0], [x1, y1, zm], [x1, y0, z1]], [1, 0, 0]);
    this.quad([[x0, y0, z1], [x0, y1, zm], [x0, y0, z0]], [-1, 0, 0]);
  }
  cyl(p: Part) {
    const dx = p.x1 - p.x0, dy = p.y1 - p.y0, dz = p.z1 - p.z0;
    const axis = dy >= dx && dy >= dz ? 1 : dx >= dz ? 0 : 2;
    const seg = 14;
    const c = [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2];
    const ext = [dx / 2, dy / 2, dz / 2];
    const a1 = axis === 1 ? 0 : 1, a2 = axis === 2 ? 0 : axis === 1 ? 2 : 2;
    const u1 = axis === 0 ? 1 : axis === 1 ? 0 : 0, u2 = axis === 0 ? 2 : axis === 1 ? 2 : 1;
    void a1; void a2;
    const pt = (ang: number, end: number) => { const v = [0, 0, 0]; v[axis] = c[axis] + end * ext[axis]; v[u1] = c[u1] + Math.cos(ang) * ext[u1]; v[u2] = c[u2] + Math.sin(ang) * ext[u2]; return v; };
    const nrm = (ang: number) => { const v = [0, 0, 0]; v[u1] = Math.cos(ang); v[u2] = Math.sin(ang); return v; };
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2, tm = (t0 + t1) / 2;
      const q = [pt(t0, -1), pt(t0, 1), pt(t1, 1), pt(t1, -1)];
      // winding depends on axis handedness; emit both-facing safe order by checking normal
      const n = nrm(tm);
      const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) q.reverse();
      this.quad(q, n);
      // caps
      const nc = [0, 0, 0]; nc[axis] = 1;
      const top = [pt(t0, 1), pt(t1, 1), (() => { const v = [...c]; v[axis] = c[axis] + ext[axis]; return v; })()];
      const bot = [pt(t1, -1), pt(t0, -1), (() => { const v = [...c]; v[axis] = c[axis] - ext[axis]; return v; })()];
      const fix = (tri: number[][], nn: number[]) => { const a = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]], b2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]]; const cc = [a[1] * b2[2] - a[2] * b2[1], a[2] * b2[0] - a[0] * b2[2], a[0] * b2[1] - a[1] * b2[0]]; if (cc[0] * nn[0] + cc[1] * nn[1] + cc[2] * nn[2] < 0) tri.reverse(); return tri; };
      this.quad(fix(top, nc), nc);
      const nb = nc.map((x) => -x); this.quad(fix(bot, nb), nb);
    }
  }
  ramp(r: RampPart) {
    const { x0, y0, z0, x1, y1, z1 } = r;
    // corner heights
    const h = (x: number, z: number) => { const t = r.axis === 0 ? (x - x0) / (x1 - x0) : (z - z0) / (z1 - z0); const u = r.dir === 1 ? t : 1 - t; return y0 + (y1 - y0) * u; };
    const a = h(x0, z0), b = h(x1, z0), c = h(x1, z1), d = h(x0, z1);
    const nx = r.axis === 0 ? -(y1 - y0) / (x1 - x0) * r.dir : 0, nz = r.axis === 1 ? -(y1 - y0) / (z1 - z0) * r.dir : 0;
    const l = Math.hypot(nx, 1, nz);
    this.quad([[x0, a, z0], [x0, d, z1], [x1, c, z1], [x1, b, z0]], [nx / l, 1 / l, nz / l]);
    // underside
    const th = 0.25;
    this.quad([[x0, d - th, z1], [x0, a - th, z0], [x1, b - th, z0], [x1, c - th, z1]], [-nx / l, -1 / l, -nz / l], 0.7);
    // sides
    this.quad([[x1, b - th, z0], [x1, b, z0], [x1, c, z1], [x1, c - th, z1]], [1, 0, 0]);
    this.quad([[x0, d - th, z1], [x0, d, z1], [x0, a, z0], [x0, a - th, z0]], [-1, 0, 0]);
    this.quad([[x1, c - th, z1], [x1, c, z1], [x0, d, z1], [x0, d - th, z1]], [0, 0, 1]);
    this.quad([[x0, a - th, z0], [x0, a, z0], [x1, b, z0], [x1, b - th, z0]], [0, 0, -1]);
  }
}

let NORMALS: THREE.DataArrayTexture | null = null;
export function structureMaterial(tex: THREE.DataArrayTexture, transparent = false): THREE.MeshStandardMaterial {
  // per-layer bump strength: 0 concrete,1 brick,2 plaster,3 metal,4 wood,5 glass,6 rock,7 asphalt,8 roof,9 container,10 trim,11 dark,12 foliage,13 tile,14 snow,15 facade
  NORMALS ??= normalArrayFrom(tex, [0.8, 3, 0.4, 1.6, 2.2, 0.1, 2.5, 1.2, 0.9, 2, 0.25, 0.6, 2, 1.6, 0.8, 1]);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, transparent, opacity: transparent ? 0.86 : 1, depthWrite: !transparent, side: transparent ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tLayers = { value: tex };
    sh.uniforms.uAvg = { value: tex.userData.avg };
    sh.uniforms.tNormals = { value: NORMALS };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLayer;\nvarying float vLayer;\nvarying vec2 vUv2;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayer = aLayer;\nvUv2 = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray tLayers;\nuniform highp sampler2DArray tNormals;\nuniform float uAvg[16];\nvarying float vLayer;\nvarying vec2 vUv2;\n' + PERTURB_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= diffuseColor.rgb; // vertex colours are sqrt-encoded in uint8')
      .replace('#include <map_fragment>', 'int li = int(floor(vLayer + 0.5));\nvec4 texel = texture(tLayers, vec3(vUv2, float(li)));\ndiffuseColor.rgb *= clamp(texel.rgb / max(uAvg[li], 0.02), 0.0, 2.2);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  { vec3 mn = texture(tNormals, vec3(vUv2, floor(vLayer + 0.5))).xyz * 2.0 - 1.0; normal = perturbN(normal, -vViewPosition, vUv2, mn); }')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 0.85 + texel.g * 0.3;
        float L = floor(vLayer + 0.5);
        if (L == 5.0) roughnessFactor = 0.05;
        else if (L == 3.0 || L == 9.0) roughnessFactor = 0.55;
        else if (L == 7.0) roughnessFactor = 0.8;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (floor(vLayer + 0.5) == 3.0 || floor(vLayer + 0.5) == 9.0) metalnessFactor = 0.12;
        if (floor(vLayer + 0.5) == 5.0) metalnessFactor = 0.3;`);
  };
  return m;
}

interface Chunk { detail: THREE.Mesh | null; glass: THREE.Mesh | null; lod: THREE.Mesh | null; cx: number; cz: number; near: boolean | null }

export class StructureMesh {
  group = new THREE.Group();
  chunks: Chunk[] = [];
  detailDist = DETAIL_DIST;

  constructor(structures: Structure[], tex: THREE.DataArrayTexture, worldSize: number) {
    const opaque = structureMaterial(tex), glassM = structureMaterial(tex, true);
    const n = Math.ceil(worldSize / CHUNK);
    const bufs: { d: GeoBuf; g: GeoBuf; l: GeoBuf }[] = Array.from({ length: n * n }, () => ({ d: new GeoBuf(), g: new GeoBuf(), l: new GeoBuf() }));
    const em = new Emitter();
    for (const s of structures) {
      if (s.kind === 'tree') continue;
      const ci = Math.min(n - 1, Math.max(0, Math.floor(s.z / CHUNK))) * n + Math.min(n - 1, Math.max(0, Math.floor(s.x / CHUNK)));
      const B = bufs[ci];
      for (const p of s.parts) {
        const target = p.mat === Mat.Glass ? B.g : B.d;
        em.setPart(s, target, p.mat, p.color);
        em.aoBase = p.y0 < 0.3 && p.y1 > 1 && p.mat !== Mat.Glass; em.aoY = Math.max(0, p.y0);
        if (p.shape === 'gable') em.gable(p);
        else if (p.shape === 'cyl') em.cyl(p);
        else em.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, p.y0 > 0.2);
      }
      em.aoBase = false;
      for (const r of s.ramps) { em.setPart(s, B.d, r.mat ?? Mat.Concrete, r.mat === Mat.Roof ? undefined : 0x9a968e); if (r.mat === Mat.Roof) continue; em.ramp(r); }
      // LOD shell
      const big = s.by1 > 5 && (s.bx1 - s.bx0) * (s.bz1 - s.bz0) > 40;
      const lodMat = big && ['block', 'tower', 'hospital', 'terminal', 'tvstation', 'keep', 'cellblock', 'barracks', 'station', 'house', 'shop'].includes(s.kind) ? 15 : Mat.Concrete;
      em.setPart(s, B.l, lodMat as Mat, lodMat === 15 ? mixTint(s.lodColor ?? 0xcccccc) : s.lodColor ?? 0xaaaaaa);
      em.scale = lodMat === 15 ? 12.8 : 6;
      if (s.kind === 'house') {
        // body + roof
        const roof = s.parts.find((p) => p.shape === 'gable');
        const top = roof ? roof.y0 : s.by1;
        em.box(s.bx0 + 0.4, 0, s.bz0 + 0.4, s.bx1 - 0.4, top, s.bz1 - 0.4, false);
        if (roof) { em.setPart(s, B.l, Mat.Roof, roof.color); em.gable(roof); }
      } else if (s.parts.length > 6 && big) em.box(s.bx0, 0, s.bz0, s.bx1, s.by1, s.bz1, false);
      else for (const p of s.parts) { em.setPart(s, B.l, p.mat, p.color); if (p.shape === 'cyl') em.cyl(p); else if (p.shape === 'gable') em.gable(p); else em.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, false); }
    }
    for (let i = 0; i < n * n; i++) {
      const B = bufs[i];
      const mk = (b: GeoBuf, m: THREE.Material, shadow: boolean) => { const g = b.build(); if (!g) return null; const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.visible = false; this.group.add(mesh); return mesh; };
      const c: Chunk = { detail: mk(B.d, opaque, true), glass: mk(B.g, glassM, false), lod: mk(B.l, opaque, true), cx: (i % n + 0.5) * CHUNK, cz: (Math.floor(i / n) + 0.5) * CHUNK, near: null };
      if (c.glass) c.glass.renderOrder = 2;
      this.chunks.push(c);
    }
  }

  update(cam: THREE.Vector3) {
    for (const c of this.chunks) {
      const near = Math.hypot(c.cx - cam.x, c.cz - cam.z) < this.detailDist;
      if (near === c.near) continue;
      c.near = near;
      if (c.detail) c.detail.visible = near;
      if (c.glass) c.glass.visible = near;
      if (c.lod) c.lod.visible = !near;
    }
  }
}

function mixTint(c: number) { return c; }
