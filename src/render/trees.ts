/**
 * Trees: pines built from drooping needle-branch cards in whorls, leafy trees and bushes from
 * leaf-card clusters. Alpha-tested with wind sway and alpha-correct shadows. Instanced per 540 m
 * chunk with a cheap cone/blob LOD for distant chunks.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tree } from '../world/mapgen';

function canvasTex(draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, W = 256, H = 256): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!; draw(g, W, H);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** Needle branch: a dense, tapered mass of needles around a twig running along +x. */
function needleTexture() {
  return canvasTex((g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgb(66,52,38)'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W * 0.92, H / 2); g.stroke();
    for (let i = 0; i < 2600; i++) {
      const t = Math.random(), env = (1 - t * 0.75) * H * 0.46 * (0.55 + 0.45 * Math.sin(Math.min(1, t * 6) * Math.PI / 2));
      const x = t * W * 0.95, y = H / 2 + (Math.random() * 2 - 1) * env * Math.sqrt(Math.random());
      const a = (y < H / 2 ? -1 : 1) * (0.5 + Math.random() * 0.7) + (Math.random() - 0.5) * 0.4, l = 7 + Math.random() * 9;
      const c = 0.62 + Math.random() * 0.5, tip = Math.random() < 0.15;
      g.strokeStyle = tip ? `rgb(${84 * c},${110 * c},${80 * c})` : `rgb(${46 * c},${70 * c},${56 * c})`; // blue-green spruce (2020) g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });
}
function leafTexture() {
  return canvasTex((g, W, H) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = W / 2 + (Math.random() - 0.5) * W * 0.85, y = H / 2 + (Math.random() - 0.5) * H * 0.85;
      if (Math.hypot(x - W / 2, y - H / 2) > W * 0.44) continue;
      const c = 0.7 + Math.random() * 0.45, a = Math.random() * 6.28;
      g.fillStyle = `rgb(${120 * c},${124 * c},${70 * c})`; // tinted per tree (autumn yellows / greens / oranges)
      g.beginPath(); g.ellipse(x, y, 9, 5, a, 0, Math.PI * 2); g.fill();
    }
  });
}

function vcolor(geo: THREE.BufferGeometry, hex: number, jitter: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  const j = 1 + (Math.random() - 0.5) * jitter;
  for (let i = 0; i < n; i++) { col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
/** A card from the trunk outwards, drooping, with u along its length. */
function branchCard(len: number, width: number, droop: number, yaw: number, y: number, out0 = 0.15) {
  const g = new THREE.PlaneGeometry(len, width, 2, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + len / 2; const t = x / len; p.setXYZ(i, x + out0, -droop * t * t, p.getY(i)); }
  g.rotateY(yaw); g.translate(0, y, 0);
  return g;
}

function pineGeometry(): { branches: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const levels = 9;
  for (let l = 0; l < levels; l++) {
    const t = l / (levels - 1), y = 2.2 + t * 10.5, len = 3.2 * (1 - t) + 0.7, n = 9 - Math.floor(t * 4);
    for (let k = 0; k < n; k++) parts.push(vcolor(branchCard(len, len * 1.05, 0.7 + len * 0.3, (k / n) * Math.PI * 2 + l * 0.9 + Math.random() * 0.4, y), 0xffffff, 0.2));
  }
  // needle-textured core so the crown reads solid from any angle
  for (let k = 0; k < 3; k++) { const cone = new THREE.ConeGeometry(2.2 - k * 0.2, 11.5, 9, 1, true).translate(0, 8.2, 0).rotateY(k * 1.1); parts.push(vcolor(cone, 0xd8e0d0, 0.1)); }
  const trunk = vcolor(new THREE.CylinderGeometry(0.1, 0.32, 13, 7).translate(0, 6.5, 0), 0x5a4533, 0.2);
  return { branches: mergeGeometries(parts)!, trunk };
}
function leafyGeometry(): { branches: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  for (const [cx, cy, cz, r] of [[0, 6.2, 0, 2.6], [1.2, 7.6, 0.6, 2], [-1.1, 5.4, -0.6, 1.9], [0.2, 8.6, -0.5, 1.5]]) {
    for (let k = 0; k < 11; k++) {
      const q = new THREE.PlaneGeometry(r * 1.3, r * 1.3);
      q.rotateX(Math.random() * 3); q.rotateY(Math.random() * 6.28);
      q.translate(cx + (Math.random() - 0.5) * r, cy + (Math.random() - 0.5) * r * 0.8, cz + (Math.random() - 0.5) * r);
      parts.push(vcolor(q, 0xffffff, 0.25));
    }
  }
  const trunk = vcolor(mergeGeometries([new THREE.CylinderGeometry(0.12, 0.25, 6, 6).translate(0, 3, 0), new THREE.CylinderGeometry(0.05, 0.1, 2.4, 5).rotateZ(0.7).translate(0.7, 5.6, 0)])!, 0xc8c2b4, 0.1);
  return { branches: mergeGeometries(parts)!, trunk };
}
function bushGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 12; k++) {
    const q = new THREE.PlaneGeometry(1.3, 1.1); q.rotateX(Math.random() * 1.2 - 0.6); q.rotateY(Math.random() * 6.28);
    q.translate((Math.random() - 0.5) * 1.2, 0.55 + Math.random() * 0.5, (Math.random() - 0.5) * 1.2);
    parts.push(vcolor(q, 0xe8f0d0, 0.3));
  }
  return mergeGeometries(parts)!;
}

function foliageMaterial(map: THREE.Texture, uTime: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.95 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.5 + sin(uTime * 2.9 + ip.x * 0.3) * 0.2;
        float hh = max(0.0, position.y - 1.5) / 12.0;
        transformed.x += sway * hh * hh * 0.9; transformed.z += sway * hh * hh * 0.5;
        transformed.y += sin(uTime * 4.0 + position.x * 3.0 + ip.z) * 0.03 * hh;`);
  };
  return m;
}

export class Trees {
  group = new THREE.Group();
  private chunks: { near: THREE.Object3D[]; far: THREE.Object3D; cx: number; cz: number; state: number }[] = [];
  private uTime = { value: 0 };
  constructor(trees: Tree[]) {
    const nt = needleTexture(), lt = leafTexture();
    const pineMat = foliageMaterial(nt, this.uTime), leafMat = foliageMaterial(lt, this.uTime);
    const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const pineDepth = new THREE.MeshDepthMaterial({ map: nt, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
    const leafDepth = new THREE.MeshDepthMaterial({ map: lt, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
    const pine = pineGeometry(), leafy = leafyGeometry(), bush = bushGeometry();
    const lodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const lodPine = vcolor(new THREE.ConeGeometry(2.9, 12.5, 5, 1, true).translate(0, 7.2, 0), 0x4c6650, 0.1); // 10 triangles: the haze does the rest
    const lodLeafy = vcolor(new THREE.OctahedronGeometry(2.8, 0).scale(1, 1.2, 1).translate(0, 6.2, 0), 0xffffff, 0.1);
    const CH = 540, buckets = new Map<string, Tree[]>();
    for (const t of trees) { const key = `${Math.floor(t.x / CH)}:${Math.floor(t.z / CH)}`; let b = buckets.get(key); if (!b) buckets.set(key, (b = [])); b.push(t); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    // 2020 Verdansk autumn: leafy trees in yellow, orange and green; pines vary a little in shade
    const AUTUMN = [0xd8c058, 0xc89a40, 0x9aa450, 0x8c9a48, 0xb07838, 0xa8b058].map((h) => new THREE.Color(h));
    const hash = (t: Tree) => { const v = Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453; return v - Math.floor(v); };
    const leafTint = (t: Tree) => AUTUMN[Math.floor(hash(t) * AUTUMN.length)];
    const pineTint = (t: Tree) => new THREE.Color().setScalar(0.85 + hash(t) * 0.3);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Tree[], shadow: boolean, depth?: THREE.Material, tint?: (t: Tree) => THREE.Color) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((t, i) => {
        e.set(0, (t.x * 13.1 + t.z * 7.7) % 6.28, 0); q.setFromEuler(e); s.setScalar(t.s); p.set(t.x, t.y - 0.2, t.z); m.compose(p, q, s); im.setMatrixAt(i, m);
        if (tint) im.setColorAt(i, tint(t));
      });
      im.count = list.length; im.castShadow = shadow; im.receiveShadow = true; if (depth) im.customDepthMaterial = depth;
      im.computeBoundingSphere(); this.group.add(im); return im;
    };
    for (const [key, list] of buckets) {
      const [ci, cj] = key.split(':').map(Number);
      const pines = list.filter((t) => t.kind === 0), leafs = list.filter((t) => t.kind === 1), bushes = list.filter((t) => t.kind === 2);
      const near = [inst(pine.branches, pineMat, pines, true, pineDepth, pineTint), inst(pine.trunk, barkMat, pines, true), inst(leafy.branches, leafMat, leafs, true, leafDepth, leafTint), inst(leafy.trunk, barkMat, leafs, true), inst(bush, leafMat, bushes, false, undefined, leafTint)];
      const farG = new THREE.Group();
      farG.add(inst(lodPine, lodMat, pines, false, undefined, pineTint), inst(lodLeafy, lodMat, leafs, false, undefined, leafTint));
      this.group.add(farG);
      this.chunks.push({ near, far: farG, cx: (ci + 0.5) * CH, cz: (cj + 0.5) * CH, state: -1 });
    }
  }
  nearDist = 440;
  /** beyond this the haze hides the forest anyway */
  farDist = 1600;
  /** tree chunks cast shadows only when the camera is within this distance of their square */
  shadowDist = 160;
  update(cam: THREE.Vector3, time: number) {
    this.uTime.value = time;
    for (const c of this.chunks) {
      const near = Math.hypot(c.cx - cam.x, c.cz - cam.z) < this.nearDist ? 1 : 0;
      const dx = Math.max(0, Math.abs(cam.x - c.cx) - 270), dz = Math.max(0, Math.abs(cam.z - c.cz) - 270);
      const shadow = near && Math.hypot(dx, dz) < this.shadowDist ? 2 : 0;
      const st = near + shadow + (Math.hypot(c.cx - cam.x, c.cz - cam.z) < this.farDist ? 4 : 0);
      if (st === c.state) continue;
      c.state = st;
      for (const o of c.near) { o.visible = !!near; if ((o as any).__cast === undefined) (o as any).__cast = o.castShadow; o.castShadow = (o as any).__cast && !!shadow; }
      c.far.visible = !near && Math.hypot(c.cx - cam.x, c.cz - cam.z) < this.farDist;
    }
  }
}
