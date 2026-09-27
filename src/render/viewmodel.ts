/** First-person arms + weapon, rendered in their own pass so they never clip into walls. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPON, WeaponDef, RARITY_COLORS } from '../data/weapons';
import { Player, Phase } from '../sim/types';

function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone(); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
  const c = new THREE.Color(color).convertSRGBToLinear(), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const C = (r: number, l: number, s = 10) => new THREE.CylinderGeometry(r, r, l, s).rotateX(Math.PI / 2);

const METAL = 0x4a4e52, DARK = 0x323436, POLY = 0x46483f, WOOD = 0x7b5a3a;

/** Per-weapon silhouette parameters (metres, gun-local; -z is the muzzle). */
interface Shape { recv: number; barrel: number; guard: number; guardW: number; mag: 'curve' | 'straight' | 'long' | 'box' | 'drum' | 'grip' | 'none' | 'tube'; magLen: number; stock: 'full' | 'tube' | 'fold' | 'none' | 'wood'; bull?: boolean; wood?: boolean; jacket?: boolean; bipod?: boolean; scope?: 'tube' | 'aug' | 'none'; slide?: number }
const SHAPES: Record<string, Shape> = {
  m4: { recv: 0.36, barrel: 0.34, guard: 0.26, guardW: 0.055, mag: 'curve', magLen: 0.15, stock: 'tube' },
  grau: { recv: 0.36, barrel: 0.3, guard: 0.36, guardW: 0.058, mag: 'curve', magLen: 0.15, stock: 'fold' },
  kilo: { recv: 0.38, barrel: 0.32, guard: 0.28, guardW: 0.062, mag: 'straight', magLen: 0.15, stock: 'full' },
  m13: { recv: 0.32, barrel: 0.24, guard: 0.24, guardW: 0.052, mag: 'curve', magLen: 0.14, stock: 'fold' },
  ram7: { recv: 0.5, barrel: 0.18, guard: 0.18, guardW: 0.06, mag: 'curve', magLen: 0.14, stock: 'none', bull: true },
  fal: { recv: 0.42, barrel: 0.42, guard: 0.3, guardW: 0.06, mag: 'straight', magLen: 0.13, stock: 'wood', wood: true },
  oden: { recv: 0.55, barrel: 0.3, guard: 0.22, guardW: 0.07, mag: 'straight', magLen: 0.13, stock: 'none', bull: true },
  aug: { recv: 0.52, barrel: 0.26, guard: 0.14, guardW: 0.06, mag: 'curve', magLen: 0.13, stock: 'none', bull: true, scope: 'aug' },
  mp5: { recv: 0.3, barrel: 0.12, guard: 0.18, guardW: 0.05, mag: 'curve', magLen: 0.17, stock: 'tube' },
  mp7: { recv: 0.24, barrel: 0.1, guard: 0.1, guardW: 0.05, mag: 'grip', magLen: 0.2, stock: 'fold' },
  bruen: { recv: 0.46, barrel: 0.46, guard: 0.3, guardW: 0.065, mag: 'box', magLen: 0.12, stock: 'full', bipod: true },
  mg34: { recv: 0.42, barrel: 0.5, guard: 0.3, guardW: 0.05, mag: 'drum', magLen: 0.1, stock: 'wood', wood: true, jacket: true, bipod: true },
  hdr: { recv: 0.45, barrel: 0.7, guard: 0.3, guardW: 0.06, mag: 'straight', magLen: 0.09, stock: 'full', scope: 'tube', bipod: true },
  ax50: { recv: 0.45, barrel: 0.62, guard: 0.28, guardW: 0.062, mag: 'straight', magLen: 0.1, stock: 'full', scope: 'tube' },
  kar98: { recv: 0.5, barrel: 0.5, guard: 0.4, guardW: 0.05, mag: 'none', magLen: 0, stock: 'wood', wood: true, scope: 'tube' },
  m680: { recv: 0.3, barrel: 0.52, guard: 0.14, guardW: 0.052, mag: 'tube', magLen: 0, stock: 'wood', wood: true },
  deagle: { recv: 0.2, barrel: 0, guard: 0, guardW: 0, mag: 'none', magLen: 0, stock: 'none', slide: 0.05 },
  m1911: { recv: 0.18, barrel: 0, guard: 0, guardW: 0, mag: 'none', magLen: 0, stock: 'none', slide: 0.035 },
  x16: { recv: 0.18, barrel: 0, guard: 0, guardW: 0, mag: 'none', magLen: 0, stock: 'none', slide: 0.04 },
};

/** Returns weapon geometry (muzzle at z = -muzzle), and the sight height for ADS alignment. */
function gunGeometry(def: WeaponDef, rarity: number): { geo: THREE.BufferGeometry; muzzle: number; sight: number; scope: boolean; optic: boolean } {
  const p: THREE.BufferGeometry[] = [];
  const tint = rarity >= 4 ? 0x5a4a2a : rarity >= 3 ? 0x3a3448 : METAL;
  const sh = SHAPES[def.id];
  if (def.model === 'launcher' || !sh) {
    p.push(part(C(0.045, 1.0), 0x3d4a2e, 0, 0.02, -0.1));
    p.push(part(new THREE.ConeGeometry(0.06, 0.18, 8).rotateX(-Math.PI / 2), 0x4a5a3a, 0, 0.02, -0.68));
    p.push(part(B(0.03, 0.1, 0.04), POLY, 0, -0.06, 0.05, -0.2));
    return { geo: mergeGeometries(p)!, muzzle: 0.75, sight: 0.09, scope: false, optic: false };
  }
  if (sh.slide) {
    // pistols: slide, frame, grip, trigger guard
    p.push(part(B(sh.slide, 0.045, sh.recv), tint, 0, 0.022, -0.03));
    p.push(part(B(sh.slide * 0.9, 0.03, sh.recv * 0.8), DARK, 0, -0.012, -0.04));
    p.push(part(B(sh.slide * 0.85, 0.11, 0.05), POLY, 0, -0.07, 0.045, -0.22));
    p.push(part(B(0.008, 0.012, 0.012), DARK, 0, 0.05, -0.12)); // front sight
    p.push(part(B(sh.slide, 0.01, 0.012), DARK, 0, 0.05, 0.05)); // rear sight
    return { geo: mergeGeometries(p)!, muzzle: sh.recv * 0.6 + 0.02, sight: 0.05, scope: false, optic: false };
  }
  const furn = sh.wood ? WOOD : POLY;
  const zf = sh.bull ? -sh.recv * 0.45 : -sh.recv * 0.55; // front of receiver
  p.push(part(B(0.055, 0.07, sh.recv), tint, 0, 0, sh.bull ? 0.06 : -0.05));
  p.push(part(B(sh.guardW, sh.guardW, sh.guard), sh.wood ? WOOD : POLY, 0, 0.003, zf - sh.guard / 2 + 0.05));
  const bz = zf - sh.guard + 0.05;
  p.push(part(C(sh.jacket ? 0.022 : 0.012, sh.barrel), DARK, 0, 0.012, bz - sh.barrel / 2));
  if (sh.jacket) for (let i = 0; i < 5; i++) p.push(part(C(0.024, 0.02), METAL, 0, 0.012, bz - 0.05 - i * 0.07));
  p.push(part(C(0.017, 0.05), DARK, 0, 0.012, bz - sh.barrel - 0.02)); // muzzle device
  const muzzle = -(bz - sh.barrel - 0.045);
  // magazine
  const mz = sh.bull ? 0.16 : zf + 0.1;
  switch (sh.mag) {
    case 'curve': for (let i = 0; i < 3; i++) p.push(part(B(0.032, sh.magLen / 3 + 0.01, 0.06), DARK, 0, -0.05 - (i + 0.5) * sh.magLen / 3, mz + i * 0.018, 0.12 + i * 0.12)); break;
    case 'straight': p.push(part(B(0.032, sh.magLen, 0.055), DARK, 0, -0.04 - sh.magLen / 2, mz, 0.08)); break;
    case 'box': p.push(part(B(0.1, 0.11, 0.13), POLY, -0.025, -0.08, mz)); break;
    case 'drum': p.push(part(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14).rotateZ(Math.PI / 2), DARK, -0.03, -0.08, mz)); break;
    case 'grip': p.push(part(B(0.03, sh.magLen, 0.045), DARK, 0, -0.04 - sh.magLen / 2, 0.08, -0.25)); break;
    case 'tube': p.push(part(C(0.013, sh.barrel * 0.85), DARK, 0, -0.018, bz - sh.barrel * 0.42)); p.push(part(B(0.055, 0.05, 0.14), WOOD, 0, -0.02, bz - 0.12)); break;
  }
  // grip + trigger guard
  const gz = sh.bull ? -0.1 : 0.1;
  p.push(part(B(0.034, 0.09, 0.042), furn, 0, -0.075, gz, -0.3));
  p.push(part(B(0.01, 0.01, 0.07), DARK, 0, -0.045, gz - 0.05));
  // stock
  switch (sh.stock) {
    case 'full': p.push(part(B(0.045, 0.075, 0.22), furn, 0, -0.02, 0.27)); break;
    case 'wood': p.push(part(B(0.045, 0.085, 0.26), WOOD, 0, -0.03, 0.29, 0.08)); break;
    case 'tube': p.push(part(C(0.014, 0.16), DARK, 0, -0.005, 0.2)); p.push(part(B(0.042, 0.07, 0.07), POLY, 0, -0.02, 0.3)); break;
    case 'fold': p.push(part(B(0.012, 0.05, 0.2), DARK, 0.02, -0.01, 0.22)); p.push(part(B(0.04, 0.06, 0.03), DARK, 0.02, -0.02, 0.33)); break;
  }
  if (sh.bipod) { p.push(part(B(0.01, 0.12, 0.01), DARK, 0.025, -0.07, bz + 0.02, 0.35)); p.push(part(B(0.01, 0.12, 0.01), DARK, -0.025, -0.07, bz + 0.02, 0.35)); }
  // top rail + iron sights
  p.push(part(B(0.045, 0.01, sh.recv * 0.8), DARK, 0, 0.04, -0.05));
  let sight = 0.06, scope = !!def.scope, optic = false;
  if (sh.scope === 'aug') { p.push(part(C(0.02, 0.18), DARK, 0, 0.075, -0.02)); p.push(part(B(0.03, 0.03, 0.05), DARK, 0, 0.05, -0.02)); sight = 0.075; optic = true; }
  else if (sh.scope === 'tube' || scope) {
    p.push(part(C(0.022, 0.3), DARK, 0, 0.078, -0.05)); p.push(part(C(0.03, 0.06), DARK, 0, 0.078, -0.22)); p.push(part(C(0.027, 0.05), DARK, 0, 0.078, 0.1));
    p.push(part(B(0.015, 0.03, 0.02), DARK, 0, 0.055, -0.12)); p.push(part(B(0.015, 0.03, 0.02), DARK, 0, 0.055, 0.02));
    sight = 0.078; scope = true;
  } else if (rarity >= 1 && def.cls !== 'shotgun') {
    // open red-dot: base, two posts and a hood so the sight picture stays clear
    p.push(part(B(0.04, 0.012, 0.07), DARK, 0, 0.051, -0.05));
    p.push(part(B(0.005, 0.042, 0.05), DARK, -0.019, 0.078, -0.05)); p.push(part(B(0.005, 0.042, 0.05), DARK, 0.019, 0.078, -0.05));
    p.push(part(B(0.043, 0.005, 0.05), DARK, 0, 0.101, -0.05));
    sight = 0.078; optic = true;
  } else {
    p.push(part(B(0.008, 0.03, 0.01), DARK, 0, 0.055, bz + 0.02)); // front post
    p.push(part(B(0.03, 0.02, 0.01), DARK, 0, 0.05, 0.08)); // rear aperture
    sight = 0.062;
  }
  if (rarity >= 2) p.push(part(B(0.057, 0.012, 0.12), parseInt(RARITY_COLORS[rarity].slice(1), 16), 0, 0.028, 0.02));
  return { geo: mergeGeometries(p)!, muzzle, sight, scope, optic };
}

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
    if (k !== this.key) { this.key = k; const g = gunGeometry(WEAPON[w!.id], w!.rarity); this.gun.geometry.dispose(); this.gun.geometry = g.geo; this.muzzle = g.muzzle; this.sight = g.sight; this.scope = g.scope; this.optic = g.optic; this.arms.geometry = WEAPON[w!.id].cls === 'pistol' ? this.armsPistol : this.armsRifle; }
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
