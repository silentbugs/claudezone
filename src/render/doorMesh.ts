/** Door leaves: one instanced mesh; only doors near the camera are drawn, re-posed when they swing. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Doors } from '../sim/doors';
import type { WorldData } from '../world/mapgen';

const RANGE = 140;

function colored(g: THREE.BufferGeometry, hex: number) {
  const out = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex), n = out.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.deleteAttribute('uv'); return out;
}

export class DoorMeshes {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private slots: number[] = []; // instance -> door
  private lastCx = 1e9; private lastCz = 1e9;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor(private doors: Doors, private world: WorldData) {
    // unit leaf (1 m wide, 1 m tall along +x from the hinge), with panels and a handle, scaled per door
    const leaf = mergeGeometries([
      colored(new THREE.BoxGeometry(1, 1, 0.045).translate(0.5, 0.5, 0), 0x6b5238),
      colored(new THREE.BoxGeometry(0.7, 0.35, 0.055).translate(0.5, 0.72, 0), 0x5a4430),
      colored(new THREE.BoxGeometry(0.7, 0.35, 0.055).translate(0.5, 0.27, 0), 0x5a4430),
      colored(new THREE.BoxGeometry(0.1, 0.025, 0.12).translate(0.88, 0.47, 0), 0xb8b0a0),
    ])!;
    this.mesh = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 1200);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  private pose(inst: number, i: number) {
    const st = this.doors.structure(i), d = this.world.doors[i];
    this.q.setFromEuler(this.e.set(0, st.angle, 0));
    this.m.compose(this.v.set(st.x, st.y, st.z), this.q, this.s.set(d.w, d.h, 1));
    this.mesh.setMatrixAt(inst, this.m);
  }

  update(cam: THREE.Vector3) {
    // rebuild the near set when the camera has moved a bit
    if (Math.hypot(cam.x - this.lastCx, cam.z - this.lastCz) > 20) {
      this.lastCx = cam.x; this.lastCz = cam.z; this.slots.length = 0;
      for (let i = 0; i < this.doors.count && this.slots.length < 1200; i++) {
        const st = this.doors.structure(i);
        if (Math.abs(st.x - cam.x) < RANGE && Math.abs(st.z - cam.z) < RANGE) this.slots.push(i);
      }
      this.slots.forEach((i, k) => this.pose(k, i));
      this.mesh.count = this.slots.length; this.mesh.instanceMatrix.needsUpdate = true;
      this.doors.dirty.clear(); this.index = new Map(this.slots.map((i, k) => [i, k]));
      return;
    }
    if (this.doors.dirty.size) {
      for (const i of this.doors.dirty) { const k = this.index.get(i); if (k !== undefined) this.pose(k, i); }
      this.doors.dirty.clear(); this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  private index = new Map<number, number>();
}
