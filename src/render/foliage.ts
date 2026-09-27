/**
 * Ground foliage streamed around the camera: alpha-tested grass clumps with wind, placed from the
 * terrain splat (grass/dry ground only) in 16 m cells that are generated once and cached.
 */
import * as THREE from 'three';
import type { WorldData } from '../world/mapgen';
import { hash2 } from '../core/rng';
import { SHADER_NOISE } from './terrainMesh';

const CELL = 16;
const RADIUS = 72;

function bladeTexture(): THREE.Texture {
  const W = 128, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 48; i++) {
    const x = 6 + Math.random() * (W - 12), h = H * (0.35 + Math.random() * 0.6), lean = (Math.random() - 0.5) * 26, w = 2.5 + Math.random() * 3.5;
    const grd = g.createLinearGradient(0, H, 0, H - h);
    const c = 0.75 + Math.random() * 0.3;
    grd.addColorStop(0, `rgba(${105 * c},${108 * c},${66 * c},1)`); grd.addColorStop(1, `rgba(${178 * c},${172 * c},${118 * c},1)`);
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(x - w, H); g.quadraticCurveTo(x + lean * 0.3, H - h * 0.6, x + lean, H - h); g.quadraticCurveTo(x + lean * 0.3 + w * 0.3, H - h * 0.6, x + w, H); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function clumpGeometry(): THREE.BufferGeometry {
  // three crossed quads, pivot at the base
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) { const q = new THREE.PlaneGeometry(1.2, 0.7).translate(0, 0.35, 0).rotateY((i * Math.PI) / 3); geos.push(q); }
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(u.getX(i), u.getY(i)); nor.push(0, 1, 0); }
    const ix = g.index!; for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx);
  return out;
}

export class Foliage {
  mesh: THREE.InstancedMesh;
  private cells = new Map<number, Float32Array>(); // packed x,y,z,rot,scale,tint per instance
  private lastCx = 1e9; private lastCz = 1e9;
  density = 1;
  private uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRadius: { value: RADIUS } };
  private max = 90000;

  constructor(private world: WorldData) {
    const mat = new THREE.MeshStandardMaterial({ map: bladeTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uCam; uniform float uRadius;\nvarying float vShade;\n' + SHADER_NOISE)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float d = distance(ip.xz, uCam.xz);
          float fade = 1.0 - smoothstep(uRadius * 0.7, uRadius, d);
          transformed *= fade;
          float h = clamp(position.y / 0.7, 0.0, 1.0);
          float w = fbm3(ip.xz * 0.05 + uTime * 0.25) - 0.5;
          transformed.x += (w * 0.35 + sin(uTime * 2.1 + ip.x * 0.7) * 0.04) * h * h;
          transformed.z += (w * 0.2 + cos(uTime * 1.7 + ip.z * 0.6) * 0.04) * h * h;
          vShade = 0.8 + 0.28 * h;`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = vec3(0.0, 1.0, 0.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vShade;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= vShade;');
    };
    this.mesh = new THREE.InstancedMesh(clumpGeometry(), mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.castShadow = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
  }

  private cell(ci: number, cj: number): Float32Array {
    const key = cj * 4096 + ci;
    let c = this.cells.get(key);
    if (c) return c;
    const { hf, extra, col } = this.world, out: number[] = [];
    const N = 150;
    for (let k = 0; k < N; k++) {
      const x = (ci + hash2(ci * 131 + k, cj, 11)) * CELL, z = (cj + hash2(ci, cj * 97 + k, 13)) * CELL;
      const kk = Math.round(z / hf.step) * hf.res + Math.round(x / hf.step);
      if (kk < 0 || kk >= extra.road.length) continue;
      const cover = (1 - extra.road[kk]) * (1 - extra.snow[kk]) * (1 - extra.paved[kk]) * (extra.river[kk] ? 0 : 1);
      const clump = hash2(Math.floor(x / 9), Math.floor(z / 9), 17);
      if (hash2(ci * 7 + k, cj * 3 - k, 19) > cover * (0.25 + clump * 0.85)) continue;
      const y = hf.at(x, z);
      if (y < 0.6) continue;
      const nrm = hf.normal(x, z); if (nrm[1] < 0.8) continue;
      if (col.groundAt(x, z, y + 30, 0.5) > y + 0.3) continue; // under a structure
      const s = 0.45 + hash2(ci + k, cj - k, 23) * 0.55;
      out.push(x, y - 0.05, z, hash2(k, ci + cj, 29) * 6.28, s, 0.8 + hash2(ci - k, cj + k, 31) * 0.35);
    }
    c = Float32Array.from(out);
    this.cells.set(key, c);
    if (this.cells.size > 1200) { const first = this.cells.keys().next().value!; this.cells.delete(first); }
    return c;
  }

  update(cam: THREE.Vector3, time: number) {
    this.uniforms.uTime.value = time; this.uniforms.uCam.value.copy(cam);
    this.mesh.visible = this.density > 0.01 && cam.y - this.world.hf.at(cam.x, cam.z) < 120;
    const cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL);
    if (cx === this.lastCx && cz === this.lastCz) return;
    this.lastCx = cx; this.lastCz = cz;
    const R = Math.ceil(RADIUS / CELL), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), colr = this.mesh.instanceColor!.array as Float32Array;
    let n = 0;
    const tint = new THREE.Color();
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      if ((di * di + dj * dj) * CELL * CELL > (RADIUS + CELL) ** 2) continue;
      const c = this.cell(cx + di, cz + dj);
      const stride = this.density >= 1 ? 1 : 1 / Math.max(0.05, this.density);
      for (let f = 0; f < c.length / 6 && n < this.max; f += stride) {
        const o = Math.floor(f) * 6;
        e.set(0, c[o + 3], 0); q.setFromEuler(e); s.setScalar(c[o + 4] * (this.density > 1 ? 1 + (this.density - 1) * 0.3 : 1)); p.set(c[o], c[o + 1], c[o + 2]);
        m.compose(p, q, s); this.mesh.setMatrixAt(n, m);
        tint.setRGB(c[o + 5], c[o + 5] * 1.02, c[o + 5] * 0.9);
        colr[n * 3] = tint.r; colr[n * 3 + 1] = tint.g; colr[n * 3 + 2] = tint.b;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true;
  }
}
