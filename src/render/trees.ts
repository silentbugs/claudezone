/** Instanced trees: pine (most of Verdansk), leafy birch-like, and bushes. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tree } from '../world/mapgen';

function colored(geo: THREE.BufferGeometry, hex: number, jitter = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex).convertSRGBToLinear(), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const j = 1 + (Math.random() - 0.5) * jitter; col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function pine(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.18, 0.3, 4, 6).translate(0, 2, 0), 0x4a3a2a)];
  const tiers = [[5.5, 2.6, 3.0], [8, 2.1, 3.6], [10.4, 1.5, 3.4], [12.4, 0.9, 2.8]];
  for (const [y, r, h] of tiers) parts.push(colored(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), 0x2f4a2e, 0.25));
  return mergeGeometries(parts)!;
}
function leafy(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.15, 0.25, 5, 6).translate(0, 2.5, 0), 0xcfc8bc)];
  parts.push(colored(new THREE.IcosahedronGeometry(2.4, 0).translate(0, 6, 0), 0x6a7a3a, 0.3));
  parts.push(colored(new THREE.IcosahedronGeometry(1.8, 0).translate(1.1, 7.4, 0.5), 0x7a8440, 0.3));
  parts.push(colored(new THREE.IcosahedronGeometry(1.6, 0).translate(-1, 5.2, -0.7), 0x5f7034, 0.3));
  return mergeGeometries(parts)!;
}
function bush(): THREE.BufferGeometry {
  return mergeGeometries([colored(new THREE.IcosahedronGeometry(1.1, 0).scale(1.3, 0.8, 1.2).translate(0, 0.6, 0), 0x55653a, 0.35), colored(new THREE.IcosahedronGeometry(0.8, 0).translate(0.7, 0.5, 0.3), 0x62703e, 0.3)])!;
}

export function makeTrees(trees: Tree[]): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const geos = [pine(), leafy(), bush()];
  for (let k = 0; k < 3; k++) {
    const list = trees.filter((t) => t.kind === k);
    const im = new THREE.InstancedMesh(geos[k], mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    list.forEach((t, i) => { e.set(0, (t.x * 13.1 + t.z * 7.7) % 6.28, 0); q.setFromEuler(e); s.setScalar(t.s); p.set(t.x, t.y - 0.2, t.z); m.compose(p, q, s); im.setMatrixAt(i, m); });
    im.castShadow = k !== 2; im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}
