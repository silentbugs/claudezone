/** The freight line (sleepers + rails along the loop) and the moving train's cars. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Train } from '../sim/train';
import { models, bake } from './models';

function colored(g: THREE.BufferGeometry, hex: number) {
  const out = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex), n = out.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.deleteAttribute('uv'); return out;
}

export class TrainMeshes {
  group = new THREE.Group();
  private cars: THREE.Group[] = [];

  constructor(private train: Train, path: Float32Array) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.25 });
    // --- track: instanced sleepers + merged rail strips
    const n = path.length / 3;
    const sleeper = new THREE.BoxGeometry(2.6, 0.16, 0.26);
    const ties: THREE.Matrix4[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = path[i * 3], ay = path[i * 3 + 1], az = path[i * 3 + 2], bx = path[j * 3], by = path[j * 3 + 1], bz = path[j * 3 + 2];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
      const yaw = Math.atan2(bx - ax, bz - az); q.setFromAxisAngle(up, yaw);
      for (let t = acc; t < L; t += 0.7) { const f = t / L; m.compose(new THREE.Vector3(ax + (bx - ax) * f, ay + (by - ay) * f - 0.26, az + (bz - az) * f), q, new THREE.Vector3(1, 1, 1)); ties.push(m.clone()); }
      acc = (acc - L) % 0.7; if (acc < 0) acc += 0.7;
      for (const side of [-0.72, 0.72]) {
        const g = new THREE.BoxGeometry(0.08, 0.14, L + 0.05);
        g.translate(side, -0.1, L / 2); g.applyQuaternion(q); g.translate(ax, ay, az);
        // follow the grade
        const pos = g.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < pos.count; k++) { const along = ((pos.getX(k) - ax) * (bx - ax) + (pos.getZ(k) - az) * (bz - az)) / (L * L); pos.setY(k, pos.getY(k) + (by - ay) * Math.min(1, Math.max(0, along))); }
        railGeos.push(g);
      }
    }
    const tieMesh = new THREE.InstancedMesh(colored(sleeper, 0x4a3a2c), mat, ties.length);
    ties.forEach((t, i) => tieMesh.setMatrixAt(i, t)); tieMesh.receiveShadow = true; tieMesh.computeBoundingSphere();
    const rails = new THREE.Mesh(colored(mergeGeometries(railGeos)!, 0x6d6a66), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.8 }));
    rails.receiveShadow = true;
    this.group.add(tieMesh, rails);
    // --- cars
    const container = models.gltf.get('container_red') || models.gltf.get('container_green');
    for (const c of train.cars) {
      const g = new THREE.Group();
      const geos: THREE.BufferGeometry[] = [];
      for (const p of c.st.parts) {
        if (c.kind === 'container' && p.mat === 9 && container) continue; // drawn with the model below
        geos.push(colored(new THREE.BoxGeometry(p.x1 - p.x0, p.y1 - p.y0, p.z1 - p.z0).translate((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2), p.color ?? 0x555555));
      }
      // bogies with wheels
      for (const bz of [-c.len * 0.35, c.len * 0.35]) {
        geos.push(colored(new THREE.BoxGeometry(2.2, 0.35, 2.6).translate(0, 0.45, bz), 0x1c1c1c));
        for (const wz of [-0.8, 0.8]) for (const wx of [-0.72, 0.72]) geos.push(colored(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 12).rotateZ(Math.PI / 2).translate(wx, 0.42, bz + wz), 0x2a2a2a));
      }
      if (c.kind === 'loco') { // headlight, windows, stripes
        geos.push(colored(new THREE.BoxGeometry(0.5, 0.3, 0.1).translate(0, 3.2, -c.len / 2 + 0.45), 0xfff2c0));
        geos.push(colored(new THREE.BoxGeometry(3.05, 0.7, 1.4).translate(0, 3.6, c.len / 2 - 3.2), 0x1b2226));
        geos.push(colored(new THREE.BoxGeometry(3.02, 0.25, c.len - 1).translate(0, 1.9, 0), 0xc8a53a));
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      if (c.kind === 'container' && container) {
        for (const p of c.st.parts) if (p.mat === 9) {
          const o = container.scene.clone(true);
          const sx = (p.x1 - p.x0) / 2.56, sy = (p.y1 - p.y0) / 2.6, sz = (p.z1 - p.z0) / 5.71;
          o.rotation.y = Math.PI / 2; o.scale.set(sz, sy, sx); o.position.set((p.x0 + p.x1) / 2, p.y0, (p.z0 + p.z1) / 2);
          o.traverse((k) => { const mm = k as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
          g.add(o);
        }
      }
      if (c.kind === 'loco') { const l = new THREE.SpotLight(0xfff0c0, 40, 120, 0.35, 0.5, 1.5); l.position.set(0, 3.2, -c.len / 2); l.target.position.set(0, 0, -c.len / 2 - 30); g.add(l, l.target); }
      this.cars.push(g); this.group.add(g);
    }
    void bake;
  }

  update(alpha: number) {
    this.train.cars.forEach((c, i) => {
      const g = this.cars[i], st = c.st;
      // interpolate between the previous and current tick
      let da = st.angle - c.pa; da = ((da + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      g.position.set(c.px + (st.x - c.px) * alpha, c.py + (st.y - c.py) * alpha, c.pz + (st.z - c.pz) * alpha);
      g.rotation.set(0, c.pa + da * alpha, 0);
    });
  }
}
