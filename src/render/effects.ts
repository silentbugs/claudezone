/** Particles, tracers, gas wall, world props for loot/chests/stations, the C-130. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Sim } from '../sim/sim';
import { ItemKind, Phase, SimEvent } from '../sim/types';
import { RARITY_COLORS, WEAPON } from '../data/weapons';
import { Mat } from '../world/collision';
import { SHADER_NOISE } from './terrainMesh';
import { eyeHeight } from '../sim/movement';

// ------------------------------------------------------------------ particles
const MAXP = 6000;
class Particles {
  pos = new Float32Array(MAXP * 3); vel = new Float32Array(MAXP * 3); col = new Float32Array(MAXP * 3);
  life = new Float32Array(MAXP); max = new Float32Array(MAXP); size = new Float32Array(MAXP); grow = new Float32Array(MAXP); drag = new Float32Array(MAXP); grav = new Float32Array(MAXP); alpha = new Float32Array(MAXP);
  aSize = new Float32Array(MAXP); aAlpha = new Float32Array(MAXP);
  n = 0; head = 0;
  points: THREE.Points;
  constructor(additive: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 256.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d)*4.0; if (r > 1.0) discard; float a = vA * (1.0 - r) * (1.0 - r); gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, alpha = 1, drag = 1, grav = 0) {
    const i = this.head; this.head = (this.head + 1) % MAXP; if (this.n < MAXP) this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.alpha[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.aAlpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.aSize[i] = this.size[i] + this.grow[i] * (1 - k);
      this.aAlpha[i] = this.alpha[i] * Math.min(1, k * 3) ;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
}

// ------------------------------------------------------------------ helpers
function colored(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
}

function planeModel(): THREE.Group {
  const g = new THREE.Group();
  const grey = 0x6a6e66;
  const parts = [
    colored(new THREE.CylinderGeometry(2.3, 2.3, 30, 14).rotateX(Math.PI / 2), grey),
    colored(new THREE.ConeGeometry(2.3, 5, 14).rotateX(-Math.PI / 2).translate(0, 0, -17.5), grey),
    colored(new THREE.CylinderGeometry(2.3, 0.8, 10, 14).rotateX(-Math.PI / 2).translate(0, 1, 19.5), grey),
    colored(new THREE.BoxGeometry(40, 0.5, 4.5).translate(0, 2.2, -2), grey),
    colored(new THREE.BoxGeometry(0.5, 8, 5).translate(0, 5.5, 22), grey),
    colored(new THREE.BoxGeometry(15, 0.4, 3.5).translate(0, 2.5, 22.5), grey),
  ];
  for (const x of [-14, -7, 7, 14]) parts.push(colored(new THREE.CylinderGeometry(0.8, 0.9, 5, 10).rotateX(Math.PI / 2).translate(x, 1.4, -3), 0x55584f));
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 }));
  g.add(mesh);
  for (const x of [-14, -7, 7, 14]) { const prop = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.5 })); prop.position.set(x, 1.4, -5.6); prop.name = 'prop'; g.add(prop); }
  return g;
}

function gasMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW; ${SHADER_NOISE}
      void main(){ float n = fbm3(vec2(atan(vW.z - 1600.0, vW.x - 1600.0) * 40.0, vW.y * 0.02) + uTime * 0.05);
        float fade = smoothstep(700.0, 0.0, vW.y) * 0.55 + 0.1;
        vec3 c = mix(vec3(0.95, 0.55, 0.12), vec3(0.95, 0.8, 0.35), n);
        gl_FragColor = vec4(c, fade * (0.45 + n * 0.4)); }`,
  });
}

// ------------------------------------------------------------------ main
export class Effects {
  group = new THREE.Group();
  add = new Particles(true);
  smoke = new Particles(false);
  private tracers: THREE.LineSegments;
  private tracerPos = new Float32Array(1024 * 6);
  private gas: THREE.Mesh;
  private plane: THREE.Group;
  private lights: THREE.PointLight[] = [];
  private lightT: number[] = [];
  private itemTimer = 0;
  private stations = new THREE.Group();
  private tablets = new Map<number, THREE.Object3D>();
  private crates = new Map<number, THREE.Object3D>();
  flashes: { x: number; y: number; z: number; t: number }[] = [];

  constructor(private sim: Sim, scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.add.points, this.smoke.points);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false; this.group.add(this.tracers);
    this.gas = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 900, 96, 1, true), gasMaterial());
    this.gas.frustumCulled = false; this.gas.renderOrder = 3; this.group.add(this.gas);
    this.plane = planeModel(); this.group.add(this.plane);
    for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffb060, 0, 30, 2); this.lights.push(l); this.lightT.push(0); this.group.add(l); }
    this.buildStatic();
  }

  private buildStatic() {
    const kiosk = mergeGeometries([colored(new THREE.BoxGeometry(1.4, 2.2, 0.8).translate(0, 1.1, 0), 0x2a2e30), colored(new THREE.BoxGeometry(1.1, 0.8, 0.05).translate(0, 1.5, -0.42), 0x30d060), colored(new THREE.BoxGeometry(1.5, 0.15, 0.9).translate(0, 2.25, 0), 0x3aa050)])!;
    const km = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x0a3a14 });
    for (const b of this.sim.buyStations) { const m = new THREE.Mesh(kiosk, km); m.position.set(b.x, b.y, b.z); m.castShadow = true; this.stations.add(m); }
    this.group.add(this.stations);
    const tab = mergeGeometries([colored(new THREE.BoxGeometry(0.6, 0.12, 0.45).translate(0, 0.06, 0), 0x2a2a2a), colored(new THREE.BoxGeometry(0.5, 0.02, 0.35).translate(0, 0.13, 0), 0xe0b040)])!;
    const tm = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x3a2a00 });
    const bm = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 });
    const bgeo = mergeGeometries([new THREE.SphereGeometry(5, 16, 12).scale(1, 1.25, 1).translate(0, 42, 0), new THREE.CylinderGeometry(0.03, 0.03, 36, 4).translate(0, 18, 0), new THREE.CylinderGeometry(1.2, 1.4, 1.2, 10).translate(0, 0.6, 0), new THREE.CylinderGeometry(0.8, 0.2, 1.6, 10).translate(0, 36.8, 0)])!;
    for (const b of this.sim.world.balloons) { const m = new THREE.Mesh(bgeo, bm); m.position.set(b.x, b.y, b.z); m.castShadow = true; this.stations.add(m); }
    for (const c of this.sim.contracts) { const m = new THREE.Mesh(tab, tm); m.position.set(c.x, c.y + 0.02, c.z); this.tablets.set(c.id, m); this.group.add(m); }
  }

  /** React to sim events with visuals. */
  onEvent(e: SimEvent, localId: number) {
    const R = Math.random;
    switch (e.t) {
      case 'shot': {
        if (e.p === localId) break;
        const p = this.sim.players[e.p];
        const x = e.x + e.dx * 0.9, y = e.y - 0.1 + e.dy * 0.9, z = e.z + e.dz * 0.9;
        this.add.spawn(x, y, z, 0, 0, 0, 0.05, 0.6, 0.2, 1, 0.75, 0.35, 1);
        if (WEAPON[e.w]?.cls !== 'sniper' || true) this.flashes.push({ x, y, z, t: 0.05 });
        void p;
        break;
      }
      case 'impact': {
        if (e.water) { for (let i = 0; i < 6; i++) this.smoke.spawn(e.x, e.y, e.z, (R() - 0.5), 2 + R() * 3, (R() - 0.5), 0.6, 0.15, 0.5, 0.8, 0.85, 0.9, 0.6, 1, 6); break; }
        const metal = e.mat === Mat.Metal || e.mat === Mat.Container;
        const col = e.mat === Mat.Glass ? [0.8, 0.9, 1] : e.mat === Mat.Wood ? [0.55, 0.42, 0.3] : [0.62, 0.58, 0.52];
        // small dust puff + a few short sparks on metal: readable, but it mustn't swallow the target you're shooting at
        for (let i = 0; i < 3; i++) this.smoke.spawn(e.x + e.nx * 0.05, e.y + e.ny * 0.05, e.z + e.nz * 0.05, e.nx * (1 + R()) + (R() - 0.5), e.ny * (1 + R()) + R() * 0.8, e.nz * (1 + R()) + (R() - 0.5), 0.35, 0.08, 0.3, col[0], col[1], col[2], 0.45, 2, 1);
        if (metal) for (let i = 0; i < 3; i++) this.add.spawn(e.x, e.y, e.z, e.nx * 4 + (R() - 0.5) * 5, e.ny * 4 + R() * 3, e.nz * 4 + (R() - 0.5) * 5, 0.15, 0.03, 0, 1, 0.8, 0.4, 0.7, 1, 9);
        break;
      }
      case 'glass': {
        // a burst of shards falling out along the direction of travel, and a little glitter dust
        for (let i = 0; i < 26; i++) this.smoke.spawn(e.x + (R() - 0.5) * 0.9, e.y + (R() - 0.5) * 0.9, e.z + (R() - 0.5) * 0.9, e.nx * (1.5 + R() * 3) + (R() - 0.5) * 2, R() * 2, e.nz * (1.5 + R() * 3) + (R() - 0.5) * 2, 0.7 + R() * 0.5, 0.05, 0.04, 0.78, 0.88, 0.95, 0.9, 0.5, 9.8);
        for (let i = 0; i < 6; i++) this.smoke.spawn(e.x, e.y, e.z, (R() - 0.5), R() * 0.5, (R() - 0.5), 0.6, 0.2, 0.6, 0.85, 0.9, 0.95, 0.3, 2, 0);
        break;
      }
      case 'hit': {
        if (e.victim === localId) break;
        const col = e.armorHit ? [0.7, 0.75, 0.8] : [0.5, 0.05, 0.03];
        for (let i = 0; i < 5; i++) this.smoke.spawn(e.x, e.y, e.z, (R() - 0.5) * 2, R() * 1.5, (R() - 0.5) * 2, 0.35, 0.12, 0.3, col[0], col[1], col[2], 0.9, 3, 4);
        break;
      }
      case 'explosion': {
        const big = e.kind === 'airstrike' ? 2.2 : e.kind === 'rocket' || e.kind === 'cluster' || e.kind === 'c4' ? 1.3 : e.kind === 'frag' ? 1 : 0;
        if (e.kind === 'smoke') break;
        if (e.kind === 'flash' || e.kind === 'stun') { this.add.spawn(e.x, e.y, e.z, 0, 0, 0, 0.15, 4, 3, 1, 1, 1, 1); this.light(e.x, e.y + 0.5, e.z, 0xffffff, 40); break; }
        if (e.kind === 'molotov') { for (let i = 0; i < 20; i++) this.add.spawn(e.x + (R() - 0.5) * 4, e.y + 0.2, e.z + (R() - 0.5) * 4, 0, 1 + R() * 2, 0, 1 + R(), 0.8, 0.5, 1, 0.5, 0.15, 0.9); break; }
        for (let i = 0; i < 30 * big; i++) this.add.spawn(e.x, e.y + 0.5, e.z, (R() - 0.5) * 16 * big, R() * 12 * big, (R() - 0.5) * 16 * big, 0.25 + R() * 0.35, 1.5 * big, 3 * big, 1, 0.55 + R() * 0.3, 0.2, 1, 5);
        for (let i = 0; i < 26 * big; i++) this.smoke.spawn(e.x + (R() - 0.5) * 2, e.y + 0.5, e.z + (R() - 0.5) * 2, (R() - 0.5) * 7 * big, 2 + R() * 7 * big, (R() - 0.5) * 7 * big, 2.5 + R() * 2.5, 2 * big, 6 * big, 0.28, 0.26, 0.24, 0.85, 1.4, -0.4);
        for (let i = 0; i < 18 * big; i++) this.add.spawn(e.x, e.y + 0.3, e.z, (R() - 0.5) * 25, R() * 20, (R() - 0.5) * 25, 0.8 + R() * 0.8, 0.12, 0, 1, 0.7, 0.3, 1, 0.3, 12);
        this.light(e.x, e.y + 2, e.z, 0xffa050, 60 * big);
        break;
      }
    }
  }
  private light(x: number, y: number, z: number, color: number, intensity: number) {
    let i = this.lightT.indexOf(Math.min(...this.lightT));
    const l = this.lights[i]; l.position.set(x, y, z); l.color.setHex(color); l.intensity = intensity; this.lightT[i] = 0.25;
  }

  /** player whose eyes we're looking through: their own tracers aren't drawn (they'd streak straight across the crosshair) */
  viewId = -1;

  update(dt: number, alpha: number, cam: THREE.Vector3, time: number, fovDeg = 80) {
    const sim = this.sim;
    const sc = innerHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    (this.add.points.material as THREE.ShaderMaterial).uniforms.uScale.value = sc; (this.smoke.points.material as THREE.ShaderMaterial).uniforms.uScale.value = sc;
    // tracers
    let n = 0;
    for (const b of sim.bullets) {
      if (!b.tracer || n >= 1024 || b.owner === this.viewId) continue;
      const sp = Math.hypot(b.vx, b.vy, b.vz), l = Math.min(b.dist + 1, 12);
      if (b.dist < 4) continue;
      const i = n * 6;
      this.tracerPos[i] = b.x; this.tracerPos[i + 1] = b.y; this.tracerPos[i + 2] = b.z;
      this.tracerPos[i + 3] = b.x - (b.vx / sp) * l; this.tracerPos[i + 4] = b.y - (b.vy / sp) * l; this.tracerPos[i + 5] = b.z - (b.vz / sp) * l;
      n++;
      if (b.rocket) this.smoke.spawn(b.x, b.y, b.z, 0, 0.3, 0, 1.5, 0.4, 1.5, 0.7, 0.7, 0.68, 0.6, 1);
    }
    this.tracers.geometry.setDrawRange(0, n * 2);
    (this.tracers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // smokes & fires
    for (const s of sim.smokes) if (Math.random() < dt * 25) this.smoke.spawn(s.x + (Math.random() - 0.5) * 6, s.y + Math.random() * 2, s.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2, 5, 5, 7, 0.82, 0.83, 0.84, 0.85, 0.2);
    for (const f of sim.fires) if (Math.random() < dt * 30) { this.add.spawn(f.x + (Math.random() - 0.5) * f.r * 1.4, f.y + 0.1, f.z + (Math.random() - 0.5) * f.r * 1.4, 0, 1.5 + Math.random(), 0, 0.6, 0.6, 0.4, 1, 0.45, 0.1, 0.9); }
    // loadout crates: red smoke while falling/landed
    for (const c of sim.crates) {
      if (Math.random() < dt * 12) this.smoke.spawn(c.x + (Math.random() - 0.5), c.y + 0.5, c.z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.5, 3 + Math.random() * 2, (Math.random() - 0.5) * 0.5, 4, 1.2, 4, 0.8, 0.12, 0.08, 0.8, 0.3);
      let m = this.crates.get(c.id);
      if (!m) { m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6), new THREE.MeshStandardMaterial({ color: 0x3e4a30, roughness: 0.7 })); this.crates.set(c.id, m); this.group.add(m); }
      const k = Math.max(0, (c.land - sim.time) / 12);
      m.position.set(c.x, c.y + 0.55 + k * 350, c.z);
    }
    for (const [id, m] of this.crates) if (!sim.crates.some((c) => c.id === id)) { this.group.remove(m); this.crates.delete(id); }
    for (const c of sim.contracts) { const m = this.tablets.get(c.id); if (m) m.visible = !c.taken; }
    // muzzle flash lights (a few)
    for (const f of this.flashes) { this.light(f.x, f.y, f.z, 0xffc070, 6); }
    this.flashes.length = 0;
    for (let i = 0; i < this.lights.length; i++) { this.lightT[i] -= dt; if (this.lightT[i] <= 0) this.lights[i].intensity = 0; else this.lights[i].intensity *= 0.8; }
    this.add.update(dt); this.smoke.update(dt);
    // gas wall
    const c = sim.circle;
    this.gas.visible = c.r > 1 && c.r < 3000;
    this.gas.position.set(c.cx, 300, c.cz); this.gas.scale.set(Math.max(1, c.r), 1, Math.max(1, c.r));
    (this.gas.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    // plane
    const pl = sim.plane;
    this.plane.visible = pl.active;
    if (pl.active) {
      this.plane.position.set(pl.x, pl.y, pl.z);
      this.plane.rotation.set(0, Math.atan2(-pl.dx, -pl.dz), 0);
      this.plane.children.forEach((ch) => { if (ch.name === 'prop') ch.rotation.z += dt * 40; });
    }
    void alpha;
  }

}
