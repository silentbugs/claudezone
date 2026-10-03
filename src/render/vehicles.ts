/** Procedural vehicle models, one object per vehicle, interpolated each frame. */
import * as THREE from 'three';
import { vehicleModel, VARIANTS } from './vehicleModels';
import type { Vehicle, VehicleType } from '../sim/vehicles';

export class VehicleMeshes {
  group = new THREE.Group();
  private objs = new Map<number, { root: THREE.Group; rotor?: THREE.Mesh; tail?: THREE.Mesh }>();
  private geos = new Map<string, { body: THREE.BufferGeometry; glass: THREE.BufferGeometry | null }>();
  private glassMat = new THREE.MeshStandardMaterial({ color: 0x5a6a72, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  private burnt = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 });
  update(vs: Vehicle[], alpha: number, dt: number, cam: THREE.Vector3) {
    for (const v of vs) {
      let o = this.objs.get(v.id);
      if (!o) {
        const vs2 = VARIANTS[v.type], paint = vs2[v.id % vs2.length], key = v.type + paint;
        if (!this.geos.has(key)) this.geos.set(key, vehicleModel(v.type, paint));
        const root = new THREE.Group(), gg = this.geos.get(key)!; const m = new THREE.Mesh(gg.body, this.mat); m.castShadow = true; m.receiveShadow = true; m.name = 'body'; root.add(m);
        if (gg.glass) { const gm = new THREE.Mesh(gg.glass, this.glassMat); gm.name = 'glass'; gm.renderOrder = 2; root.add(gm); }
        o = { root };
        if (v.type === 'heli') {
          o.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); o.rotor.position.set(0, 2.9, 0); root.add(o.rotor);
          const r2 = o.rotor.clone(); r2.position.set(0, 0, 0); r2.rotation.y = Math.PI / 2; o.rotor.add(r2); // child of the first blade: no second offset
          o.tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 0.2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); o.tail.position.set(0.18, 2.3, 5.85); root.add(o.tail);
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
