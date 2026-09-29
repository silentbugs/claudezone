/** First-person arms + weapon, rendered in their own pass so they never clip into walls. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPON } from '../data/weapons';
import { describeGun, gunGeometry } from './gunModel';
import { models } from './models';
import { Player, Phase } from '../sim/types';

function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone(); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const C = (r: number, l: number, s = 10) => new THREE.CylinderGeometry(r, r, l, s).rotateX(Math.PI / 2);

/** Cylinder from a to b (gun-local space). */
function limb(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: number) {
  const A = new THREE.Vector3(ax, ay, az), B2 = new THREE.Vector3(bx, by, bz), d = B2.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r * 0.9, r, len, 8).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(ax, ay, az);
  return part(g, color, 0, 0, 0);
}
/** Support (left) arm for model guns, fist at the origin so the arm can be moved as a whole. */
function leftArmGeometry(sleeve: number, pistol: boolean): THREE.BufferGeometry {
  const glove = 0x2e2d2a;
  const fist = new RoundedBoxGeometry(0.055, 0.045, 0.09, 2, 0.018);
  return mergeGeometries([
    part(fist, glove, 0, 0, 0),
    limb(pistol ? -0.003 : -0.006, -0.015, 0.035, pistol ? -0.08 : -0.166, -0.26, 0.26, 0.036, sleeve),
  ].map((g) => { g.deleteAttribute('uv'); return g; }))!;
}
function armsGeometry(sleeve: number, pistol: boolean, glb = false, gz?: number, hz?: number): THREE.BufferGeometry {
  const glove = 0x2e2d2a;
  // model guns: grip / support-hand positions come from the model (see models.ts HD_GRIP)
  const gripZ = gz ?? (glb ? (pistol ? 0.035 : 0.085) : pistol ? 0.05 : 0.1), guardZ = hz ?? (glb ? (pistol ? 0.03 : -0.17) : pistol ? 0.04 : -0.3);
  if (glb) {
    // gloved fists wrapped around the model's grip and handguard
    const fist = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, 0.018);
    return mergeGeometries([
      part(fist(0.05, 0.075, 0.075), glove, 0.004, pistol ? -0.055 : -0.06, gripZ),
      limb(0.006, -0.07, gripZ + 0.03, 0.08, -0.3, gripZ + 0.24, 0.036, sleeve),
    ].map((g) => { g.deleteAttribute('uv'); return g; }))!;
  }
  return mergeGeometries([
    // right hand on the grip, forearm running back and down out of frame
    part(B(0.06, 0.08, 0.1), glove, 0.005, -0.075, gripZ),
    limb(0.01, -0.09, gripZ + 0.04, 0.09, -0.26, gripZ + 0.34, 0.036, sleeve),
    // left hand under the handguard (or cupping the pistol grip)
    part(B(0.07, 0.05, 0.1), glove, pistol ? -0.02 : -0.005, pistol ? -0.1 : -0.04, guardZ),
    limb(pistol ? -0.02 : -0.01, pistol ? -0.11 : -0.06, guardZ + 0.04, pistol ? -0.1 : -0.16, -0.26, guardZ + 0.36, 0.036, sleeve),
  ])!;
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/** Piecewise smooth interpolation through [time, position] keys (time 0..1). */
function keyframe(keys: [number, THREE.Vector3][], u: number): THREE.Vector3 {
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) {
    const [t0, a] = keys[i - 1], [t1, b] = keys[i];
    return a.clone().lerp(b, smooth((u - t0) / Math.max(1e-4, t1 - t0)));
  }
  return keys[keys.length - 1][1].clone();
}

export class ViewModel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  private root = new THREE.Group();
  private gun = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }));
  private arms = new THREE.Mesh(armsGeometry(0x4d5140, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  private armsRifle = armsGeometry(0x4d5140, false); private armsPistol = armsGeometry(0x4d5140, true);
  private plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.03), new THREE.MeshStandardMaterial({ color: 0x3a3c38, roughness: 0.6 }));
  private flash: THREE.Mesh;
  private flashLight = new THREE.PointLight(0xffc070, 0, 6, 2);
  private key = '';
  private glb: THREE.Object3D | null = null;
  private reticle: THREE.Object3D | null = null;
  private lensMask: THREE.Object3D | null = null;
  private armsCache = new Map<string, THREE.BufferGeometry>();
  /** model guns: the left arm + a magazine it carries during reloads */
  private armL = new THREE.Mesh(leftArmGeometry(0x4d5140, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  private armLRifle = leftArmGeometry(0x4d5140, false); private armLPistol = leftArmGeometry(0x4d5140, true);
  private mag = new THREE.Mesh(new RoundedBoxGeometry(0.028, 0.13, 0.06, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.6, metalness: 0.3 }));
  private guardAt = new THREE.Vector3(); private gripZ = 0.085; private pistolArms = false;
  private reloadTotal = 0; private reloadEmpty = false;
  private mantleHand = 0; private mantleU = 0; private climbK = 0;
  muzzle = 0.6; sight = 0.06; scope = false; optic = false; private opticZ = 0;
  private swayX = 0; swayY = 0; private bobT = 0; private kick = 0; private kickRot = 0; private flashT = 0;
  private swap = 0; private lastCur = -1; private lastId = '';
  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xd8e2ee, 0x6a6050, 2.2));
    const d = new THREE.DirectionalLight(0xfff0dc, 2.4); d.position.set(-0.5, 1, 0.3); this.scene.add(d);
    const fm = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const fg = mergeGeometries([new THREE.PlaneGeometry(0.16, 0.16), new THREE.PlaneGeometry(0.16, 0.16).rotateY(Math.PI / 2), new THREE.PlaneGeometry(0.16, 0.16).rotateX(Math.PI / 2)])!;
    this.flash = new THREE.Mesh(fg, fm); this.flash.visible = false;
    fm.side = THREE.DoubleSide;
    this.root.add(this.gun, this.arms, this.plate, this.flash, this.flashLight, this.armL);
    this.scene.add(this.tablet); this.tablet.visible = false;
    this.armL.add(this.mag); this.mag.position.set(0, -0.07, 0); this.mag.visible = false; this.armL.visible = false;
    this.plate.visible = false;
    this.root.scale.setScalar(0.7);
    this.scene.add(this.root);
    this.scene.add(this.camera);
  }
  /**
   * The viewmodel keeps its own framing whatever the world FOV. Vertical 58° is tuned for 16:9; on
   * narrower windows widen it so the horizontal view never crops the hands, gun or parachute toggles.
   */
  /** 0..1 how far indoors the player is: dims the viewmodel's own lights like the world around it */
  setIndoor(k: number) {
    this.indoorK += (k - this.indoorK) * 0.1;
    const f = 1 - 0.62 * this.indoorK;
    this.scene.traverse((o) => { const l = o as THREE.Light; if ((l as any).isHemisphereLight || (l as any).isDirectionalLight) { l.userData.base ??= l.intensity; l.intensity = l.userData.base * f; } });
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as any; for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (!mm.defines || mm.defines.NO_INDOOR === undefined) { mm.defines = { ...(mm.defines ?? {}), NO_INDOOR: '' }; mm.needsUpdate = true; } });
  }
  private indoorK = 0;
  setAspect(a: number) {
    const base = 58, ref = 16 / 9;
    const vfov = a >= ref ? base : (2 * Math.atan(Math.tan((base * Math.PI) / 360) * ref / a) * 180) / Math.PI;
    this.camera.aspect = a; this.camera.fov = Math.min(95, vfov); this.camera.updateProjectionMatrix();
  }
  /** recoil is a damped spring: each shot is an impulse, so automatic fire stacks and settles like MW's */
  fire() { this.kickVel += 26; this.kickRotVel += 22; this.flashT = 0.05; this.flash.rotation.z = Math.random() * 3; }
  private kickVel = 0; private kickRotVel = 0;
  /** killstreak tablet (call-in): a rugged tablet raised in both hands with a glowing map screen */
  private tablet = (() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.018), new THREE.MeshStandardMaterial({ color: 0x2a2d2a, roughness: 0.7 })));
    const c = document.createElement('canvas'); c.width = 128; c.height = 96; const x = c.getContext('2d')!;
    x.fillStyle = '#0d2a1a'; x.fillRect(0, 0, 128, 96); x.strokeStyle = 'rgba(80,255,140,0.35)'; for (let i = 0; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 96); x.stroke(); } for (let i = 0; i < 96; i += 16) { x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
    x.strokeStyle = '#6aff9a'; x.lineWidth = 3; x.beginPath(); x.arc(64, 48, 22, 0, 7); x.stroke(); x.fillStyle = '#ff5a3a'; x.beginPath(); x.arc(64, 48, 5, 0, 7); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.11), new THREE.MeshBasicMaterial({ map: t })); scr.position.z = 0.0095; g.add(scr);
    for (const sx of [-1, 1]) { const h = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.08, 0.05, 2, 0.015), new THREE.MeshStandardMaterial({ color: 0x2e2d2a, roughness: 0.85 })); h.position.set(sx * 0.11, -0.03, -0.01); g.add(h); }
    return g;
  })();
  private sprintK = 0; private tacK = 0; private crawlK = 0; private slideK = 0; private idleT = 0;

  /** Hands on the parachute toggles / spread in freefall (first-person infil view). */
  private air = new THREE.Group();
  private airL = new THREE.Mesh(); private airR = new THREE.Mesh();
  private airBuilt = false;
  private buildAir() {
    this.airBuilt = true;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const arm = (side: number) => mergeGeometries([limb(0, 0, 0, 0, 0.32, -0.08, 0.032, 0x4d5140), part(new THREE.SphereGeometry(0.05, 10, 8).scale(0.9, 1.1, 0.8), 0x2e2d2a, 0, 0.37, -0.1), part(new THREE.BoxGeometry(0.035, 0.05, 0.05), 0x2e2d2a, side * -0.035, 0.39, -0.12)])!;
    this.airL = new THREE.Mesh(arm(-1), mat); this.airR = new THREE.Mesh(arm(1), mat);
    this.air.add(this.airL, this.airR); this.air.scale.setScalar(0.7); this.scene.add(this.air);
    // open canopy: the front edge of the chute across the top of the view, with risers down to the toggles
    const cm = new THREE.MeshStandardMaterial({ color: 0x5c6b4a, roughness: 0.95, side: THREE.DoubleSide });
    const band = new THREE.CylinderGeometry(3.2, 3.2, 0.9, 40, 1, true, -0.7, 1.4).rotateY(Math.PI).translate(0, 0.45, 0);
    const canopy = new THREE.Mesh(band, cm); canopy.position.set(0, 1.62, 0); this.canopyMesh = canopy;
    const ribs = new THREE.Mesh(new THREE.CylinderGeometry(3.19, 3.19, 0.9, 12, 1, true, -0.7, 1.4).rotateY(Math.PI).translate(0, 0.45, 0), new THREE.MeshBasicMaterial({ color: 0x2c3326, wireframe: true }));
    canopy.add(ribs);
    this.risers = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xcfc6b0 }));
    this.risers.frustumCulled = false;
    this.canopy.add(canopy, this.risers); this.scene.add(this.canopy);
  }
  private chuteK = 0; private steerS = 0; private airInit = false;
  private tq = new THREE.Quaternion(); private te = new THREE.Euler();
  /** ease an arm toward its pose (snaps on the first frame the arms are shown) */
  private poseAir(m: THREE.Object3D, x: number, y: number, z: number, rx: number, ry: number, rz: number, dt: number) {
    const k = this.airInit ? 1 - Math.exp(-dt * 9) : 1;
    m.position.x += (x - m.position.x) * k; m.position.y += (y - m.position.y) * k; m.position.z += (z - m.position.z) * k;
    this.tq.setFromEuler(this.te.set(rx, ry, rz)); m.quaternion.slerp(this.tq, k);
    if (m === this.airR) this.airInit = true;
  }
  private canopy = new THREE.Group(); private risers!: THREE.LineSegments; private canopyMesh!: THREE.Mesh;
  updateAir(p: Player | null, dt: number, show: boolean) {
    if (!this.airBuilt) this.buildAir();
    this.air.visible = !!p && show && (p.phase === Phase.Chute || p.phase === Phase.Freefall);
    this.canopy.visible = this.air.visible && p!.phase === Phase.Chute;
    if (p && (p.phase === Phase.Plane || p.phase === Phase.Freefall || p.phase === Phase.Chute)) this.root.visible = false;
    if (!this.air.visible || !p) { this.chuteK = 0; this.airInit = false; return; }
    this.bobT += dt;
    const chute = p.phase === Phase.Chute, pull = Math.max(0, -p.intent.mz);
    // steering and the deploy are eased: toggles are pulled, not teleported
    this.steerS += (p.intent.mx - this.steerS) * (1 - Math.exp(-dt * 6)); const steer = this.steerS;
    this.chuteK = chute ? Math.min(1, this.chuteK + dt / 0.85) : 0;
    if (chute) {
      // hands up on the toggles; pulling one side steers
      // the deploy: reach up and grab the toggles as the canopy blossoms open above with a small overshoot
      const k = this.chuteK, grab = Math.min(1, k / 0.35);
      this.poseAir(this.airL, -0.34 - 0.08 * (1 - grab), -0.3 + Math.max(0, -steer) * -0.07 - pull * 0.05 + 0.1 * (1 - grab), -0.42, 0.2, 0, 0.35, dt);
      this.poseAir(this.airR, 0.34 + 0.08 * (1 - grab), -0.3 + Math.max(0, steer) * -0.07 - pull * 0.05 + 0.1 * (1 - grab), -0.42, 0.2, 0, -0.35, dt);
      const c1 = 1.6, c3 = c1 + 1, open = k >= 1 ? 1 : 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      this.canopyMesh.scale.set(0.25 + 0.75 * open, 0.4 + 0.6 * Math.min(1, k * 1.6), 0.25 + 0.75 * open);
      this.canopyMesh.position.y = 1.62 - 0.9 * (1 - Math.min(1, k * 1.3));
      // canopy sways a little and banks with steering; risers run from each fist up to the canopy edge
      this.canopy.rotation.set(Math.sin(this.bobT * 0.9) * 0.02 - 0.12 * (1 - this.chuteK), 0, -steer * 0.06 + Math.sin(this.bobT * 0.6) * 0.015);
      this.air.updateMatrixWorld(true); this.canopy.updateMatrixWorld(true);
      const pos = this.risers.geometry.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      let i = 0;
      for (const [arm, sx] of [[this.airL, -1], [this.airR, 1]] as [THREE.Mesh, number][]) {
        const hand = arm.localToWorld(new THREE.Vector3(sx * 0.02, 0.4, -0.12));
        this.risers.worldToLocal(hand);
        for (const a of [0.25, 0.6]) {
          v.set(-Math.sin(a) * 3.2 * sx * -1, 0, -Math.cos(a) * 3.2); this.canopyMesh.localToWorld(v); this.risers.worldToLocal(v);
          pos.setXYZ(i++, hand.x, hand.y, hand.z); pos.setXYZ(i++, v.x, v.y, v.z);
        }
      }
      pos.needsUpdate = true;
    } else {
      // freefall: arms spread, fluttering in the wind
      const f = Math.sin(this.bobT * 17) * 0.02;
      this.poseAir(this.airL, -0.46, -0.36 + f, -0.3, -0.6, 0, 1.1 + steer * 0.2, dt);
      this.poseAir(this.airR, 0.46, -0.36 - f, -0.3, -0.6, 0, -1.1 + steer * 0.2, dt);
    }
  }

  /**
   * The sim runs at 60 Hz; the screen may not. Everything the viewmodel animates from (swap, reload,
   * mantle, plate and stance timers, ADS) is read through this view of the player: count-down timers are
   * advanced to the render instant and ADS is blended between the last two ticks, so a swap or an ADS
   * raise moves every frame instead of stepping at the tick rate.
   */
  interp(p: Player, alpha: number, simTime: number): Player {
    if (simTime !== this.tickT) { this.tickT = simTime; this.adsPrev = this.adsLast; this.adsLast = p.ads; }
    const q = Object.create(p) as Player, T = alpha / 60;
    const down = (v: number) => (v > 0 ? Math.max(1e-4, v - T) : v);
    q.swapT = down(p.swapT); q.reloadT = down(p.reloadT); q.mantleT = down(p.mantleT); q.plateT = down(p.plateT); q.stanceT = down(p.stanceT); q.meleeCd = down(p.meleeCd);
    q.ads = this.adsPrev + (this.adsLast - this.adsPrev) * alpha;
    return q;
  }
  private tickT = -1; private adsPrev = 0; private adsLast = 0;

  update(p: Player, dt: number, mouseDX: number, mouseDY: number, speed: number, sprinting: boolean) {
    // during the drop half of a swap we still hold the old weapon
    const P = p as any, swapDur = P.swapDur ?? 0, swapEl = swapDur - p.swapT;
    const dropping = p.swapT > 0 && swapEl < (P.swapDrop ?? 0) && p.weapons[P.swapFrom] != null;
    const w = dropping ? p.weapons[P.swapFrom] : p.weapons[p.cur];
    const hidden = !w || p.phase === Phase.Downed || p.phase === Phase.Freefall || p.phase === Phase.Chute || p.phase === Phase.Plane || p.phase === Phase.Dead || p.phase === Phase.GulagWait || p.swimming;
    this.root.visible = !hidden;
    if (hidden) { this.tablet.visible = false; return; }
    const k = `${w!.id}:${w!.rarity}`;
    if (k !== this.key) {
      this.key = k;
      const pistolArms = WEAPON[w!.id].cls === 'pistol';
      if (this.glb) { this.root.remove(this.glb); this.glb = null; }
      const m = models.gun(w!.id, w!.rarity);
      if (m) {
        this.glb = m.obj; this.root.add(m.obj); this.gun.visible = false;
        this.reticle = null; this.lensMask = null; m.obj.traverse((o) => { if (o.userData.reticle) this.reticle = o; if (o.userData.lensMask) this.lensMask = o; });
        this.muzzle = m.muzzle; this.sight = m.sight; this.scope = m.scope; this.optic = m.optic; this.opticZ = m.opticZ;
        const ak = `${pistolArms}:${m.gripZ.toFixed(3)}:${m.guardZ.toFixed(3)}`;
        let ag = this.armsCache.get(ak); if (!ag) { ag = armsGeometry(0x4d5140, pistolArms, true, m.gripZ, m.guardZ); this.armsCache.set(ak, ag); }
        this.arms.geometry = ag;
        this.armL.geometry = pistolArms ? this.armLPistol : this.armLRifle; this.armL.visible = true;
        this.pistolArms = pistolArms; this.gripZ = m.gripZ;
        this.guardAt.set(pistolArms ? -0.022 : -0.004, pistolArms ? -0.06 : -0.035, m.guardZ);
        this.mag.scale.set(1, pistolArms ? 0.7 : 1, pistolArms ? 0.6 : 1);
      } else {
        const g = describeGun(WEAPON[w!.id], w!.rarity); this.gun.geometry.dispose(); this.gun.geometry = gunGeometry(g);
        this.muzzle = g.muzzle; this.sight = g.sight; this.scope = g.scope; this.optic = g.optic;
        this.arms.geometry = pistolArms ? this.armsPistol : this.armsRifle; this.armL.visible = false;
      }
    }
    // swap pose follows the sim: lower over the drop time, raise over the raise time
    if (p.swapT > 0 && swapDur > 0) {
      const drop = P.swapDrop ?? 0;
      this.swap = dropping ? Math.min(1, swapEl / Math.max(0.01, drop)) : Math.min(1, p.swapT / Math.max(0.01, swapDur - drop));
    } else this.swap = Math.max(0, this.swap - dt * 4);
    this.lastCur = p.cur; this.lastId = w!.id;
    const ads = p.ads;
    // sway lags the mouse; less when aiming
    const sw = 1 - ads * 0.8;
    this.swayX += (-mouseDX * 0.0006 * sw - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (mouseDY * 0.0006 * sw - this.swayY) * Math.min(1, dt * 10);
    this.bobT += dt * (speed > 0.5 ? 2 + speed * 1.1 : 0.8);
    const bobA = (speed > 0.5 ? 0.012 + speed * 0.0022 : 0.003) * (1 - ads * 0.9);
    const bx = Math.sin(this.bobT) * bobA, by = -Math.abs(Math.cos(this.bobT)) * bobA;
    for (let i = 0, h = Math.min(dt, 1 / 20) / 2; i < 2; i++) {
      const K = 420, C = 2 * Math.sqrt(K) * 0.72;
      this.kickVel += (-K * this.kick - C * this.kickVel) * h; this.kick += this.kickVel * h;
      this.kickRotVel += (-K * 0.7 * this.kickRot - C * 0.85 * this.kickRotVel) * h; this.kickRot += this.kickRotVel * h;
    }
    // discrete states blend in and out instead of snapping
    const ease = (k: number, t: number, r: number) => k + (t - k) * (1 - Math.exp(-dt * r));
    this.sprintK = ease(this.sprintK, sprinting ? 1 : 0, 11); this.tacK = ease(this.tacK, sprinting && p.tacSprint > 0 ? 1 : 0, 9);
    this.crawlK = ease(this.crawlK, p.stance === 2 && speed > 0.3 ? 1 : 0, 8); this.slideK = ease(this.slideK, p.slideT > 0 ? 1 : 0, 12);
    this.idleT += dt;
    const S = 0.7, pistol = WEAPON[w!.id].cls === 'pistol';
    const g = !!this.glb;
    const hip = pistol ? new THREE.Vector3(0.1, g ? -0.11 : -0.13, g ? -0.42 : -0.48) : new THREE.Vector3(g ? 0.13 : 0.12, g ? -0.15 : -0.14, g ? -0.4 : -0.36), aim = new THREE.Vector3(0, -this.sight * S, pistol ? (g ? -0.4 : -0.5) : g && this.optic ? -0.1 - this.opticZ * S : g ? -0.3 : -0.36);
    const pos = hip.clone().lerp(aim, ads);
    let rx = 0, ry = 0, rz = 0;
    if (this.sprintK > 0.001) {
      // sprint: carried across the chest, muzzle left and down; tactical sprint: raised, muzzle up
      const s = this.sprintK * 0.7, t = this.tacK;
      pos.x -= 0.05 * s; pos.y -= 0.06 * s; rx -= 0.35 * s; ry += 0.75 * s; rz += 0.25 * s;
      if (t > 0.001) { rx += (0.9 - rx) * t; ry += (0.2 - ry) * t; pos.y += (0.02 + 0.06 * s) * t; }
    }
    // breathing idle
    { const b = 1 - ads * 0.75; pos.y += Math.sin(this.idleT * 1.7) * 0.0016 * b; rz += Math.sin(this.idleT * 0.85) * 0.005 * b; rx += Math.sin(this.idleT * 1.7 + 1) * 0.004 * b; }
    // reload: track the reload's length when it starts (empty reloads also rack the bolt / slide)
    if (p.reloadT > 0 && this.reloadTotal === 0) { this.reloadTotal = p.reloadT; this.reloadEmpty = w!.mag === 0; }
    if (p.reloadT <= 0) this.reloadTotal = 0;
    let handOff: THREE.Vector3 | null = null, magVis = false;
    if (p.reloadT > 0 && this.reloadTotal > 0) {
      const u = 1 - p.reloadT / this.reloadTotal;
      // cant the gun toward you, a little lower, and hold it there
      const tilt = smooth(u / 0.12) * (1 - smooth((u - 0.86) / 0.14));
      pos.y -= 0.03 * tilt; pos.x += 0.015 * tilt; rz -= 0.3 * tilt; rx += 0.1 * tilt; ry += 0.1 * tilt;
      if (this.glb) {
        const P = this.pistolArms, g = this.guardAt;
        const well = new THREE.Vector3(P ? 0 : -0.004, P ? -0.13 : -0.1, P ? this.gripZ + 0.01 : this.gripZ - 0.1);
        const below = well.clone().add(new THREE.Vector3(-0.05, -0.3, 0.12));
        const bolt = new THREE.Vector3(-0.03, P ? 0.03 : 0.035, P ? this.gripZ - 0.02 : this.gripZ - 0.04);
        const keys: [number, THREE.Vector3][] = this.reloadEmpty
          ? [[0, g], [0.14, well], [0.3, below], [0.46, below], [0.62, well], [0.68, well.clone().add(new THREE.Vector3(0, 0.012, 0))], [0.76, bolt], [0.84, bolt.clone().add(new THREE.Vector3(0, 0, 0.07))], [0.9, bolt], [1, g]]
          : [[0, g], [0.16, well], [0.34, below], [0.52, below], [0.74, well], [0.8, well.clone().add(new THREE.Vector3(0, 0.012, 0))], [1, g]];
        handOff = keyframe(keys, u);
        magVis = u > (this.reloadEmpty ? 0.12 : 0.14) && u < (this.reloadEmpty ? 0.66 : 0.78);
      }
    }
    this.armL.position.copy(handOff ?? this.guardAt); this.armL.rotation.set(0, 0, 0);
    this.mag.visible = magVis;
    this.plate.visible = p.plateT > 0;
    if (p.plateT > 0) { pos.y -= 0.18; rx -= 0.4; const t = 1 - p.plateT / 1.25; this.plate.position.set(-0.08, 0.06 - t * 0.08, -0.1 + t * 0.12); this.plate.rotation.set(0.6, 0.3, 0); }
    // climbing a ladder: weapon lowered out of view
    this.climbK += ((((p as any).ladder ?? -1) >= 0 || ((p as any).asc ?? -1) >= 0 ? 1 : 0) - this.climbK) * Math.min(1, dt * 8);
    if (this.climbK > 0.01) { pos.y -= 0.45 * this.climbK; rx -= 0.9 * this.climbK; }
    if (this.swap > 0) {
      // drop: accelerate down and roll out; raise: come up with a small overshoot and settle (MW swap feel)
      let e: number;
      if (dropping) e = this.swap * this.swap;
      else { const r = 1 - this.swap, c1 = 1.9, c3 = c1 + 1; e = 1 - (1 + c3 * Math.pow(r - 1, 3) + c1 * Math.pow(r - 1, 2)); }
      pos.y -= e * 0.28; pos.x += e * 0.05; rx -= e * 0.8; rz += e * 0.35; ry -= e * 0.15;
    }
    // killstreak call-in: weapon dropped out of view, tablet raised, tapped, lowered
    const callT = (p as any).callT ?? 0;
    if (callT > 0) {
      const u = 1 - callT / 1.1, up = smooth(u / 0.25) * (1 - smooth((u - 0.85) / 0.15));
      pos.y -= 0.4 * up; rx -= 0.9 * up;
      this.tablet.visible = true;
      this.tablet.position.set(0, -0.36 + 0.22 * up, -0.34); this.tablet.rotation.set(0.45 - 0.2 * up, 0, 0);
      if (u > 0.55 && u < 0.62) this.tablet.position.z -= 0.01; // the tap
    } else this.tablet.visible = false;
    // mantle: weapon tucked down and away, left hand reaches out and plants on the ledge
    if (p.mantleT > 0) {
      const T = P.mantleDur ?? 0.5, u = 1 - p.mantleT / T, k = Math.sin(Math.min(1, u) * Math.PI);
      pos.y -= 0.1 * k; pos.x += 0.04 * k; rx -= 0.3 * k; rz -= 0.25 * k;
      this.mantleHand = this.glb ? k : 0; this.mantleU = u;
    } else this.mantleHand = 0;
    // stance changes dip the weapon; prone crawling lowers and rocks it
    if (p.stanceT > 0) { const k = Math.min(1, p.stanceT / 0.45); pos.y -= 0.08 * k; rx -= 0.3 * k; rz += 0.15 * k; }
    if (this.crawlK > 0.001) { const c = this.crawlK; pos.y -= 0.06 * c; rz += Math.sin(this.bobT * 0.9) * 0.12 * c; rx -= 0.25 * c; }
    if (this.slideK > 0.001) { rz += 0.18 * this.slideK; pos.x -= 0.02 * this.slideK; }
    // melee swing
    if (p.meleeCd > 0.35) { const t = (0.7 - p.meleeCd) / 0.35; pos.x -= Math.sin(t * Math.PI) * 0.12; pos.z -= Math.sin(t * Math.PI) * 0.12; ry += Math.sin(t * Math.PI) * 0.9; }
    pos.z += this.kick * (0.024 + (1 - ads) * 0.014); pos.y += this.kickRot * 0.004;
    this.root.position.set(pos.x + bx + this.swayX, pos.y + by + this.swayY, pos.z);
    this.root.rotation.set(rx + this.kickRot * 0.06 + this.swayY * 2, ry + this.swayX * 3, rz + this.swayX * 1.5, 'YXZ');
    if (this.mantleHand > 0.01) {
      // the planted hand lives in view space: reach up-left, grab the ledge, then sink as we pull up over it
      const u = this.mantleU, reach = Math.min(1, u / 0.3), push = Math.max(0, (u - 0.35) / 0.65);
      const v = new THREE.Vector3(-0.1, -0.2 + 0.13 * reach - 0.16 * push, -0.4 + 0.05 * push);
      this.root.updateMatrixWorld(true);
      this.armL.position.copy(this.root.worldToLocal(v.divideScalar(1)));
      this.armL.rotation.set(-this.root.rotation.x - 0.25, 0.15, -this.root.rotation.z - 0.2);
    }
    // scope: hide the model when fully zoomed on a scoped weapon (overlay drawn by the HUD)
    this.arms.visible = !(this.scope && ads > 0.92);
    if (this.glb) this.armL.visible = this.arms.visible;
    this.gun.visible = this.arms.visible && !this.glb;
    if (this.glb) this.glb.visible = this.arms.visible;
    if (this.reticle) this.reticle.visible = p.ads > 0.6 && this.arms.visible;
    if (this.lensMask) this.lensMask.visible = p.ads > 0.6 && this.arms.visible;
    // aiming through an optic: clip everything between the eye and the optic (receiver, rear iron sight)
    const near = this.glb && this.optic && !this.scope ? Math.max(0.01, (-this.root.position.z - this.opticZ * S) - 0.012) : 0.01;
    const nearNow = 0.01 + (near - 0.01) * Math.max(0, (p.ads - 0.7) / 0.3);
    if (Math.abs(this.camera.near - nearNow) > 1e-4) { this.camera.near = nearNow; this.camera.updateProjectionMatrix(); }
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0 && this.arms.visible;
    // aiming: a smaller, dimmer flash so it doesn't sit over the sight picture
    this.flash.scale.setScalar(1 - p.ads * 0.55);
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 - p.ads * 0.5;
    this.flash.position.set(0, 0.012, -this.muzzle - 0.05);
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = this.flashT > 0 ? 8 - p.ads * 5 : 0;
  }
  render(r: THREE.WebGLRenderer) {
    if (!this.root.visible && !this.air.visible) return;
    r.autoClear = false; r.clearDepth(); r.render(this.scene, this.camera); r.autoClear = true;
  }
}
