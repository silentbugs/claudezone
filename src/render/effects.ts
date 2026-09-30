/** Particles, tracers, gas wall, world props for loot/chests/stations, the C-130. */
import * as THREE from 'three';
import { contractBadge, CONTRACT_COLOR } from '../ui/icons';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Sim } from '../sim/sim';
import { ItemKind, Phase, SimEvent } from '../sim/types';
import { RARITY_COLORS, WEAPON } from '../data/weapons';
import { Mat } from '../world/collision';
import { SHADER_NOISE } from './terrainMesh';
import { eyeHeight } from '../sim/movement';
import { VEHICLES, VEHICLE_FIRE } from '../sim/vehicles';

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
  /** aiming down sights: floating contract badges step out of the way */
  adsHide = false;
  private lights: THREE.PointLight[] = [];
  private lightT: number[] = [];
  private itemTimer = 0;
  private stations = new THREE.Group();
  private badgeTex = new Map<string, THREE.Texture>();
  private badges = new Map<number, { sp: THREE.Sprite; beam: THREE.Mesh; y: number; ph: number }>();
  private badgeT = 0;
  /** recon flares: shoot up, burn red and drift down (visible map-wide) */
  private flares: { x: number; y: number; z: number; t: number; y0: number }[] = [];
  /** thrown equipment, drawn in flight / where it lands */
  private thrown = new Map<number, THREE.Object3D>();
  private thrownGeo = new Map<string, THREE.BufferGeometry>();
  private thrownMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  private blinkMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  /** strike jets: fly over the target line just before the bombs land */
  private jets: { m: THREE.Object3D; x: number; z: number; dx: number; dz: number; y: number; t: number }[] = [];
  private jetGeo: THREE.BufferGeometry | null = null;
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
    for (const c of this.sim.contracts) {
      const m = new THREE.Mesh(tab, tm); m.position.set(c.x, c.y + 0.02, c.z); this.tablets.set(c.id, m); this.group.add(m);
      // floating holo badge above the tablet (bobs, pulses, faces you) + a faint beam of its colour
      let tex = this.badgeTex.get(c.kind);
      if (!tex) { tex = new THREE.CanvasTexture(contractBadge(c.kind)); tex.colorSpace = THREE.SRGBColorSpace; this.badgeTex.set(c.kind, tex); }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      sp.scale.setScalar(0.9); sp.position.set(c.x, c.y + 1.5, c.z); sp.renderOrder = 3;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 3, 8, 1, true).translate(0, 1.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(CONTRACT_COLOR[c.kind] ?? '#fff'), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(c.x, c.y, c.z);
      this.badges.set(c.id, { sp, beam, y: c.y, ph: (c.id * 1.7) % 6.28 }); this.group.add(sp, beam);
    }
  }

  private thrownGeometry(type: string): THREE.BufferGeometry {
    let g = this.thrownGeo.get(type); if (g) return g;
    const parts: THREE.BufferGeometry[] = [];
    if (type === 'frag') parts.push(colored(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.2, 1), 0x3d4a2e), colored(new THREE.BoxGeometry(0.02, 0.05, 0.03).translate(0.02, 0.06, 0), 0x8a8a80));
    else if (type === 'semtex') parts.push(colored(new THREE.BoxGeometry(0.09, 0.04, 0.06), 0xc8b89a), colored(new THREE.BoxGeometry(0.03, 0.02, 0.03).translate(0, 0.03, 0), 0x2a2a2a));
    else if (type === 'molotov') parts.push(colored(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 8), 0x3a6a3a), colored(new THREE.CylinderGeometry(0.012, 0.02, 0.07, 6).translate(0, 0.1, 0), 0x3a6a3a), colored(new THREE.BoxGeometry(0.02, 0.05, 0.02).translate(0, 0.15, 0), 0xd8d0b0));
    else if (type === 'c4') parts.push(colored(new THREE.BoxGeometry(0.16, 0.05, 0.1), 0x8a8a6a), colored(new THREE.BoxGeometry(0.06, 0.02, 0.05).translate(0, 0.035, 0), 0x2a2a2a));
    else if (type === 'knife') parts.push(colored(new THREE.BoxGeometry(0.02, 0.01, 0.16).translate(0, 0, -0.08), 0xb8bcc0), colored(new THREE.BoxGeometry(0.025, 0.02, 0.1).translate(0, 0, 0.05), 0x2a2a2a));
    else if (type === 'rock') parts.push(colored(new THREE.IcosahedronGeometry(0.05, 0), 0x8a8478));
    else parts.push(colored(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), type === 'smoke' ? 0x6a7a6a : type === 'flash' ? 0x3a3e44 : 0x4a4a3a), colored(new THREE.BoxGeometry(0.02, 0.04, 0.03).translate(0.02, 0.07, 0), 0x8a8a80));
    g = mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q))!; this.thrownGeo.set(type, g); return g;
  }
  private updateThrown(dt: number) {
    const live = new Set<number>();
    for (const t of this.sim.throwables) {
      if (!t.alive) continue; live.add(t.id);
      let m = this.thrown.get(t.id);
      if (!m) {
        m = new THREE.Mesh(this.thrownGeometry(t.type), this.thrownMat); (m as THREE.Mesh).castShadow = true;
        if (t.type === 'semtex' || t.type === 'c4') { const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), this.blinkMat); led.position.set(0, 0.05, 0); led.name = 'led'; m.add(led); }
        m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        this.thrown.set(t.id, m); this.group.add(m);
      }
      m.position.set(t.x, t.y, t.z);
      if (!t.stuck) { m.rotation.x += dt * (t.type === 'knife' ? 14 : 7); m.rotation.z += dt * 3; }
      const led = m.getObjectByName('led'); if (led) led.visible = Math.floor(performance.now() / (t.fuse < 1 ? 90 : 350)) % 2 === 0;
    }
    for (const [id, m] of this.thrown) if (!live.has(id)) { this.group.remove(m); this.thrown.delete(id); }
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
      case 'vcrash': {
        // crunch: a spray of sparks and grit off the body
        const n = Math.min(18, 4 + e.impact * 0.6);
        for (let i = 0; i < n; i++) this.add.spawn(e.x, e.y, e.z, (R() - 0.5) * 7, 1 + R() * 4, (R() - 0.5) * 7, 0.25, 0.04, 0, 1, 0.8, 0.4, 0.8, 1, 9);
        for (let i = 0; i < 4; i++) this.smoke.spawn(e.x, e.y - 0.5, e.z, (R() - 0.5) * 2, R(), (R() - 0.5) * 2, 1.2, 0.5, 1.2, 0.55, 0.5, 0.45, 0.4, 0.5, 0);
        break;
      }
      case 'contractGone': {
        // the tablet shorts out in the gas: a spit of sparks and a puff of dark smoke
        for (let i = 0; i < 14; i++) this.add.spawn(e.x, e.y + 0.2, e.z, (R() - 0.5) * 5, 2 + R() * 4, (R() - 0.5) * 5, 0.3, 0.04, 0, 1, 0.75, 0.3, 0.8, 1, 9);
        for (let i = 0; i < 6; i++) this.smoke.spawn(e.x, e.y + 0.3, e.z, (R() - 0.5) * 0.6, 0.8 + R(), (R() - 0.5) * 0.6, 2.2, 0.3, 1.2, 0.2, 0.2, 0.2, 0.55, 0.4, 0);
        this.light(e.x, e.y + 0.5, e.z, 0xffb060, 5);
        break;
      }
      case 'flare': this.flares.push({ x: e.x, y: e.y + 1, z: e.z, t: 0, y0: e.y }); break;
      case 'marker': {
        if (e.kind !== 'airstrike' && e.kind !== 'cluster') break;
        if (!this.jetGeo) this.jetGeo = mergeGeometries([colored(new THREE.CylinderGeometry(0.7, 0.45, 15, 10).rotateX(Math.PI / 2), 0x6a7074), colored(new THREE.BoxGeometry(11, 0.25, 4).translate(0, 0, 1.5), 0x5e6468), colored(new THREE.BoxGeometry(4.6, 0.2, 1.8).translate(0, 0, 6.4), 0x5e6468), colored(new THREE.BoxGeometry(0.2, 2.6, 2.2).translate(0, 1.3, 6.4), 0x5e6468), colored(new THREE.ConeGeometry(0.7, 2.4, 10).rotateX(-Math.PI / 2).translate(0, 0, -8.7), 0x4a4f52)])!;
        const a = e.yaw ?? 0, dx = -Math.sin(a), dz = -Math.cos(a), g = this.sim.world.hf.at(e.x, e.z);
        const passAt = e.kind === 'cluster' ? 3.1 : 3.9, n = e.kind === 'cluster' ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const m = new THREE.Mesh(this.jetGeo, this.thrownMat); m.visible = false; this.group.add(m);
          // t counts to the pass over the target (t = 0); 190 m/s, 110-130 m up
          this.jets.push({ m, x: e.x + (i ? dz * 30 : 0), z: e.z - (i ? dx * 30 : 0), dx, dz, y: g + 115 + i * 15, t: -passAt - i * 0.25 });
        }
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
    this.updateThrown(dt);
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
    // vehicle damage states (2020): grey smoke from the engine below 60 %, thick black smoke below 35 %, flames below
    // 20 % (it is about to blow); wrecks smoulder
    for (const v of sim.vehicles) {
      if (Math.hypot(v.x - cam.x, v.z - cam.z) > 700) continue;
      const d = VEHICLES[v.type], f = v.alive ? v.health / d.health : 0;
      if (v.alive && f >= 0.6) continue;
      if (!v.alive && v.burnT <= 0) continue;
      const R = Math.random, fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const ex = v.x + fx * d.len * (v.type === 'heli' ? 0.1 : 0.32), ez = v.z + fz * d.len * (v.type === 'heli' ? 0.1 : 0.32), ey = v.y + d.hgt * (v.type === 'heli' ? 0.9 : 0.75);
      const heavy = !v.alive || f < 0.35, fire = !v.alive || f < VEHICLE_FIRE;
      const rate = !v.alive ? 7 : fire ? 16 : heavy ? 11 : 5;
      if (R() < dt * rate) {
        const g = heavy ? 0.1 + R() * 0.06 : 0.55 + R() * 0.1;
        this.smoke.spawn(ex + (R() - 0.5) * 0.5, ey, ez + (R() - 0.5) * 0.5, (R() - 0.5) * 0.6 - v.vx * 0.3, 1.6 + R() * 1.2, (R() - 0.5) * 0.6 - v.vz * 0.3, heavy ? 4.5 : 3, heavy ? 1.1 : 0.7, heavy ? 1.6 : 1.0, g, g, g, heavy ? 0.75 : 0.45, 0.6, 0);
      }
      if (fire && R() < dt * 30) {
        this.add.spawn(ex + (R() - 0.5) * 0.8, ey - 0.2, ez + (R() - 0.5) * 0.8, (R() - 0.5) * 0.4, 1.5 + R() * 1.5, (R() - 0.5) * 0.4, 0.45, 0.6, 0.4, 1, 0.45 + R() * 0.2, 0.12, 0.9, 1, 0);
        if (R() < 0.3) this.light(ex, ey, ez, 0xff7a30, 8);
      }
    }
    for (const j of this.jets) {
      j.t += dt; const d = j.t * 190;
      j.m.visible = j.t > -5 && j.t < 5;
      j.m.position.set(j.x + j.dx * d, j.y, j.z + j.dz * d); j.m.rotation.set(0, Math.atan2(-j.dx, -j.dz), 0);
    }
    for (const j of this.jets) if (j.t >= 5) this.group.remove(j.m);
    this.jets = this.jets.filter((j) => j.t < 5);
    for (const f of this.flares) {
      f.t += dt;
      f.y = f.t < 2.5 ? f.y0 + 1 + 70 * Math.sin((f.t / 2.5) * Math.PI / 2) : f.y0 + 71 - (f.t - 2.5) * 1.6;
      const R = Math.random;
      this.add.spawn(f.x, f.y, f.z, (R() - 0.5) * 0.6, -0.5, (R() - 0.5) * 0.6, 0.25, 1.4, 0.4, 1, 0.18, 0.1, 1, 1, 0);
      if (R() < dt * 20) this.smoke.spawn(f.x, f.y - 0.5, f.z, (R() - 0.5) * 0.3, 0.2, (R() - 0.5) * 0.3, 6, 0.8, 3, 0.85, 0.3, 0.28, 0.5, 0.3, 0);
      this.light(f.x, f.y, f.z, 0xff3020, 30);
    }
    this.flares = this.flares.filter((f) => f.t < 25);
    this.badgeT += dt;
    for (const c of sim.contracts) {
      const m = this.tablets.get(c.id); if (m) m.visible = !c.taken;
      const b = this.badges.get(c.id); if (!b) continue;
      b.sp.visible = b.beam.visible = !c.taken && !this.adsHide;
      if (c.taken || this.adsHide) continue;
      const t = this.badgeT + b.ph;
      if (c.doomAt !== undefined) { const left = c.doomAt - sim.time; b.sp.visible = b.beam.visible = left > 2.5 || Math.sin(t * (40 - left * 8)) > -0.2; }
      b.sp.position.y = b.y + 1.5 + Math.sin(t * 1.8) * 0.12;
      b.sp.scale.setScalar(0.9 * (1 + Math.sin(t * 3.2) * 0.06));
      (b.beam.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(t * 2.4));
    }
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
