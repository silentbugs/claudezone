/** Procedural vehicle models, one object per vehicle, interpolated each frame. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vehicle, VehicleType } from '../sim/vehicles';

function col(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number, rx = 0) => col(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), c);
const wheel = (r: number, w: number, x: number, y: number, z: number) => col(new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, y, z), 0x1a1a1a);

function model(t: VehicleType): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  switch (t) {
    case 'atv': {
      const c = 0x5a6040;
      P.push(box(1.0, 0.4, 1.8, 0, 0.7, 0, c), box(0.5, 0.25, 0.7, 0, 1.0, 0.2, 0x222222), box(1.1, 0.12, 0.5, 0, 0.95, -0.7, c), box(1.1, 0.12, 0.5, 0, 0.95, 0.75, c));
      P.push(box(0.7, 0.05, 0.05, 0, 1.15, -0.55, 0x222222));
      for (const [x, z] of [[-0.55, -0.7], [0.55, -0.7], [-0.55, 0.7], [0.55, 0.7]]) P.push(wheel(0.33, 0.28, x, 0.33, z));
      break;
    }
    case 'rover': {
      const c = 0x6a6a52;
      P.push(box(1.8, 0.35, 3.4, 0, 0.75, 0, c), box(1.7, 0.5, 1.0, 0, 1.1, -1.3, c));
      for (const x of [-0.85, 0.85]) P.push(box(0.08, 1.1, 0.08, x, 1.5, 0, 0x2a2a2a), box(0.08, 1.1, 0.08, x, 1.5, 1.4, 0x2a2a2a));
      P.push(box(1.8, 0.08, 1.6, 0, 2.05, 0.7, 0x2a2a2a), box(0.9, 0.35, 0.35, -0.45, 1.05, -0.2, 0x222222), box(0.9, 0.35, 0.35, 0.45, 1.05, -0.2, 0x222222));
      for (const [x, z] of [[-0.95, -1.2], [0.95, -1.2], [-0.95, 1.2], [0.95, 1.2]]) P.push(wheel(0.42, 0.35, x, 0.42, z));
      break;
    }
    case 'suv': {
      const c = 0x2f3336;
      P.push(box(2.0, 0.8, 4.7, 0, 0.85, 0, c), box(1.85, 0.75, 2.9, 0, 1.6, 0.35, c), box(1.87, 0.5, 2.7, 0, 1.65, 0.35, 0x1a2228));
      P.push(box(1.9, 0.05, 0.1, 0, 1.3, -2.36, 0xd8d8c8));
      for (const [x, z] of [[-0.95, -1.5], [0.95, -1.5], [-0.95, 1.5], [0.95, 1.5]]) P.push(wheel(0.4, 0.3, x, 0.4, z));
      break;
    }
    case 'truck': {
      const c = 0x4a5238;
      P.push(box(2.4, 1.8, 2.2, 0, 1.8, -2.6, c), box(2.3, 0.7, 1.2, 0, 2.4, -2.9, 0x1a2228), box(2.4, 0.4, 5.2, 0, 1.1, 1.0, 0x3a3a34));
      P.push(box(0.1, 1.0, 5.0, -1.15, 1.8, 1.0, c), box(0.1, 1.0, 5.0, 1.15, 1.8, 1.0, c), box(2.4, 1.0, 0.1, 0, 1.8, 3.55, c));
      for (const [x, z] of [[-1.1, -2.6], [1.1, -2.6], [-1.1, 0.8], [1.1, 0.8], [-1.1, 2.4], [1.1, 2.4]]) P.push(wheel(0.55, 0.4, x, 0.55, z));
      break;
    }
    case 'heli': {
      const c = 0x3a4432;
      P.push(col(new THREE.SphereGeometry(1.3, 12, 8).scale(1, 0.95, 1.7).translate(0, 1.4, -0.4), c));
      P.push(col(new THREE.SphereGeometry(1.1, 10, 8).scale(0.95, 0.8, 0.6).translate(0, 1.55, -1.9), 0x1a2228));
      P.push(box(0.35, 0.35, 5.0, 0, 1.6, 3.2, c), box(0.1, 1.2, 0.8, 0, 2.1, 5.6, c), box(0.9, 0.4, 0.5, 0, 2.6, 0, 0x2a2a2a));
      for (const x of [-0.9, 0.9]) P.push(box(0.08, 0.08, 2.8, x, 0.1, -0.3, 0x2a2a2a), box(0.06, 0.6, 0.06, x, 0.4, -1.2, 0x2a2a2a), box(0.06, 0.6, 0.06, x, 0.4, 0.6, 0x2a2a2a));
      break;
    }
  }
  return mergeGeometries(P)!;
}

export class VehicleMeshes {
  group = new THREE.Group();
  private objs = new Map<number, { root: THREE.Group; rotor?: THREE.Mesh; tail?: THREE.Mesh }>();
  private geos = new Map<VehicleType, THREE.BufferGeometry>();
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  private burnt = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 });
  update(vs: Vehicle[], alpha: number, dt: number, cam: THREE.Vector3) {
    for (const v of vs) {
      let o = this.objs.get(v.id);
      if (!o) {
        if (!this.geos.has(v.type)) this.geos.set(v.type, model(v.type));
        const root = new THREE.Group(); const m = new THREE.Mesh(this.geos.get(v.type)!, this.mat); m.castShadow = true; m.receiveShadow = true; m.name = 'body'; root.add(m);
        o = { root };
        if (v.type === 'heli') {
          o.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); o.rotor.position.set(0, 2.9, 0); root.add(o.rotor);
          const r2 = o.rotor.clone(); r2.rotation.y = Math.PI / 2; o.rotor.add(r2);
          o.tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 0.2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); o.tail.position.set(0.2, 2.1, 5.6); root.add(o.tail);
        }
        this.objs.set(v.id, o); this.group.add(root);
      }
      const d = Math.hypot(v.x - cam.x, v.z - cam.z);
      o.root.visible = d < 1400;
      if (!o.root.visible) continue;
      const x = v.px + (v.x - v.px) * alpha, y = v.py + (v.y - v.py) * alpha, z = v.pz + (v.z - v.pz) * alpha;
      o.root.position.set(x, y, z);
      o.root.rotation.set(v.pitch, v.pyaw + wrap(v.yaw - v.pyaw) * alpha, v.roll, 'YXZ');
      (o.root.children[0] as THREE.Mesh).material = v.alive ? this.mat : this.burnt;
      if (o.rotor) { o.rotor.rotation.y += dt * 30 * v.rotor; o.tail!.rotation.x += dt * 40 * v.rotor; }
    }
  }
}
const wrap = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
