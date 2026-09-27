/**
 * Ambient life so Verdansk doesn't feel empty at range: smoke columns from fires dotted around the
 * map (visible for kilometres, leaning with the wind) and flocks of birds wheeling over fields and
 * woods. Purely cosmetic and deterministic per match seed.
 */
import * as THREE from 'three';
import type { WorldData } from '../world/mapgen';
import { POIS } from '../world/mapdata';

interface Emitter { spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, alpha?: number, drag?: number, grav?: number): void }

const WIND = new THREE.Vector2(0.9, 0.35);

export class Ambient {
  group = new THREE.Group();
  private fires: { x: number; y: number; z: number; acc: number; big: boolean }[] = [];
  private flocks: { cx: number; cz: number; y: number; r: number; w: number; ph: number; n: number }[] = [];
  private birds: THREE.InstancedMesh;
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor(world: WorldData, seed: number, private smoke: Emitter, private add: Emitter) {
    let h = seed * 9301 + 49297;
    const rnd = () => ((h = (h * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // fires: near a handful of POIs, on open ground or a structure top
    const pois = POIS.filter((p) => p.r > 60);
    for (let i = 0; i < 11 && pois.length; i++) {
      const p = pois[Math.floor(rnd() * pois.length)];
      const a = rnd() * Math.PI * 2, d = rnd() * p.r * 0.7;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const y = world.col.groundAt(x, z, 400, 0.5);
      if (y < 0.5) continue; // not in the sea
      this.fires.push({ x, y, z, acc: rnd(), big: rnd() < 0.35 });
    }
    // bird flocks over countryside
    for (let i = 0; i < 7; i++) {
      const x = 300 + rnd() * 2600, z = 300 + rnd() * 2600;
      this.flocks.push({ cx: x, cz: z, y: world.hf.at(x, z) + 45 + rnd() * 50, r: 40 + rnd() * 60, w: (0.12 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6.28, n: 9 + Math.floor(rnd() * 8) });
    }
    // a bird: two flat wings, flapped by the vertex shader
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.25, -0.9, 0, 0.1, 0, 0, 0.2, 0, 0, -0.25, 0, 0, 0.2, 0.9, 0, 0.1], 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x1b1d1f, side: THREE.DoubleSide, fog: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = { value: 0 }; (mat as any).userData.sh = sh;
      sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float fl = sin(uT * 11.0 + float(gl_InstanceID) * 1.7); transformed.y += abs(position.x) * fl * 0.6;');
    };
    const total = this.flocks.reduce((a, f) => a + f.n, 0);
    this.birds = new THREE.InstancedMesh(g, mat, total);
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const R = Math.random;
    for (const f of this.fires) {
      const d = Math.hypot(f.x - cam.x, f.z - cam.z);
      if (d > 3200) continue;
      f.acc += dt;
      const every = f.big ? 0.28 : 0.45;
      while (f.acc > every) {
        f.acc -= every;
        const sh = 0.13 + R() * 0.08;
        this.smoke.spawn(f.x + (R() - 0.5) * 3, f.y + 1, f.z + (R() - 0.5) * 3, WIND.x * 2 + (R() - 0.5), (f.big ? 5 : 3.5) + R() * 1.5, WIND.y * 2 + (R() - 0.5), f.big ? 28 : 20, f.big ? 6 : 4, f.big ? 38 : 24, sh, sh, sh * 1.02, 0.55, 0.02, -0.02);
        if (d < 260) this.add.spawn(f.x + (R() - 0.5) * 2, f.y + 0.6, f.z + (R() - 0.5) * 2, 0, 2 + R() * 2, 0, 0.5, 1.6, 0.4, 1, 0.55 + R() * 0.2, 0.2, 0.9, 1, 0);
      }
    }
    let i = 0;
    for (const fl of this.flocks) {
      for (let k = 0; k < fl.n; k++) {
        const a = fl.ph + this.t * fl.w + (k / fl.n) * 0.9 + Math.sin(this.t * 0.3 + k) * 0.08;
        const rr = fl.r + Math.sin(k * 2.3 + this.t * 0.4) * 8;
        this.v.set(fl.cx + Math.cos(a) * rr, fl.y + Math.sin(k * 1.3 + this.t * 0.7) * 3, fl.cz + Math.sin(a) * rr);
        const yaw = Math.atan2(Math.sin(a) * Math.sign(fl.w), -Math.cos(a) * Math.sign(fl.w)); // facing along the circle
        this.q.setFromEuler(new THREE.Euler(0, yaw, Math.sin(this.t + k) * 0.2));
        this.m.compose(this.v, this.q, this.s.setScalar(0.9));
        this.birds.setMatrixAt(i++, this.m);
      }
    }
    this.birds.instanceMatrix.needsUpdate = true;
    const sh = (this.birds.material as any).userData.sh; if (sh) sh.uniforms.uT.value = this.t;
  }
}
