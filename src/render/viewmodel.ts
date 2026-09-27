/** First-person arms + weapon, rendered in their own pass so they never clip into walls. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPON } from '../data/weapons';
import { describeGun, gunGeometry } from './gunModel';
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
function armsGeometry(sleeve: number, pistol: boolean): THREE.BufferGeometry {
  const glove = 0x2e2d2a;
  const gripZ = pistol ? 0.05 : 0.1, guardZ = pistol ? 0.04 : -0.3;
  return mergeGeometries([
    // right hand on the grip, forearm running back and down out of frame
    part(B(0.06, 0.08, 0.1), glove, 0.005, -0.075, gripZ),
    limb(0.01, -0.09, gripZ + 0.04, 0.09, -0.26, gripZ + 0.34, 0.036, sleeve),
    // left hand under the handguard (or cupping the pistol grip)
    part(B(0.07, 0.05, 0.1), glove, pistol ? -0.02 : -0.005, pistol ? -0.1 : -0.04, guardZ),
    limb(pistol ? -0.02 : -0.01, pistol ? -0.11 : -0.06, guardZ + 0.04, pistol ? -0.1 : -0.16, -0.26, guardZ + 0.36, 0.036, sleeve),
  ])!;
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
  muzzle = 0.6; sight = 0.06; scope = false; optic = false;
  private swayX = 0; swayY = 0; private bobT = 0; private kick = 0; private kickRot = 0; private flashT = 0;
  private swap = 0; private lastCur = -1; private lastId = '';
  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xd8e2ee, 0x6a6050, 2.2));
    const d = new THREE.DirectionalLight(0xfff0dc, 2.4); d.position.set(-0.5, 1, 0.3); this.scene.add(d);
    const fm = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const fg = mergeGeometries([new THREE.PlaneGeometry(0.16, 0.16), new THREE.PlaneGeometry(0.16, 0.16).rotateY(Math.PI / 2), new THREE.PlaneGeometry(0.16, 0.16).rotateX(Math.PI / 2)])!;
    this.flash = new THREE.Mesh(fg, fm); this.flash.visible = false;
    fm.side = THREE.DoubleSide;
    this.root.add(this.gun, this.arms, this.plate, this.flash, this.flashLight);
    this.plate.visible = false;
    this.root.scale.setScalar(0.7);
    this.scene.add(this.root);
    this.scene.add(this.camera);
  }
  setAspect(a: number) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }
  fire() { this.kick = 1; this.kickRot = 1; this.flashT = 0.05; this.flash.rotation.z = Math.random() * 3; }

  update(p: Player, dt: number, mouseDX: number, mouseDY: number, speed: number, sprinting: boolean) {
    const w = p.weapons[p.cur];
    const hidden = !w || p.phase === Phase.Downed || p.phase === Phase.Freefall || p.phase === Phase.Chute || p.phase === Phase.Plane || p.phase === Phase.Dead || p.phase === Phase.GulagWait || p.swimming;
    this.root.visible = !hidden;
    if (hidden) return;
    const k = `${w!.id}:${w!.rarity}`;
    if (k !== this.key) { this.key = k; const g = describeGun(WEAPON[w!.id], w!.rarity); this.gun.geometry.dispose(); this.gun.geometry = gunGeometry(g); this.muzzle = g.muzzle; this.sight = g.sight; this.scope = g.scope; this.optic = g.optic; this.arms.geometry = WEAPON[w!.id].cls === 'pistol' ? this.armsPistol : this.armsRifle; }
    if (p.cur !== this.lastCur || w!.id !== this.lastId) { this.swap = 1; this.lastCur = p.cur; this.lastId = w!.id; }
    this.swap = Math.max(0, this.swap - dt * 2.2);
    const ads = p.ads;
    // sway lags the mouse; less when aiming
    const sw = 1 - ads * 0.8;
    this.swayX += (-mouseDX * 0.0006 * sw - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (mouseDY * 0.0006 * sw - this.swayY) * Math.min(1, dt * 10);
    this.bobT += dt * (speed > 0.5 ? 2 + speed * 1.1 : 0.8);
    const bobA = (speed > 0.5 ? 0.012 + speed * 0.0022 : 0.003) * (1 - ads * 0.9);
    const bx = Math.sin(this.bobT) * bobA, by = -Math.abs(Math.cos(this.bobT)) * bobA;
    this.kick = Math.max(0, this.kick - dt * 14); this.kickRot = Math.max(0, this.kickRot - dt * 10);
    const S = 0.7, pistol = WEAPON[w!.id].cls === 'pistol';
    const hip = pistol ? new THREE.Vector3(0.1, -0.13, -0.48) : new THREE.Vector3(0.12, -0.14, -0.36), aim = new THREE.Vector3(0, -this.sight * S, pistol ? -0.5 : -0.36);
    const pos = hip.clone().lerp(aim, ads);
    let rx = 0, ry = 0, rz = 0;
    if (sprinting) { const s = p.tacSprint > 0 ? 1 : 0.7; pos.x -= 0.05 * s; pos.y -= 0.06 * s; rx -= 0.35 * s; ry += 0.75 * s; rz += 0.25 * s; if (p.tacSprint > 0) { rx = 0.9; ry = 0.2; pos.y += 0.02; } }
    if (p.reloadT > 0) { const t = Math.min(1, p.reloadT * 3); pos.y -= 0.07 * t; rx -= 0.2 * t; rz += 0.5 * t; }
    this.plate.visible = p.plateT > 0;
    if (p.plateT > 0) { pos.y -= 0.18; rx -= 0.4; const t = 1 - p.plateT / 1.25; this.plate.position.set(-0.08, 0.06 - t * 0.08, -0.1 + t * 0.12); this.plate.rotation.set(0.6, 0.3, 0); }
    if (this.swap > 0) { pos.y -= this.swap * 0.25; rx -= this.swap * 0.6; }
    pos.z += this.kick * (0.02 + (1 - ads) * 0.02);
    this.root.position.set(pos.x + bx + this.swayX, pos.y + by + this.swayY, pos.z);
    this.root.rotation.set(rx + this.kickRot * 0.05 + this.swayY * 2, ry + this.swayX * 3, rz + this.swayX * 1.5, 'YXZ');
    // scope: hide the model when fully zoomed on a scoped weapon (overlay drawn by the HUD)
    this.gun.visible = this.arms.visible = !(this.scope && ads > 0.92);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0 && this.gun.visible;
    this.flash.position.set(0, 0.012, -this.muzzle - 0.05);
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = this.flashT > 0 ? 8 : 0;
  }
  render(r: THREE.WebGLRenderer) {
    if (!this.root.visible) return;
    r.autoClear = false; r.clearDepth(); r.render(this.scene, this.camera); r.autoClear = true;
  }
}
