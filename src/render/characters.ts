/**
 * Soldiers as instanced rigid parts. One InstancedMesh per body part (a dozen draw calls for the
 * whole lobby); every frame we pose each visible player with procedural joint angles.
 */
import * as THREE from 'three';
import { Phase, Player, Stance } from '../sim/types';
import { WEAPON } from '../data/weapons';

type PartName = 'pelvis' | 'torso' | 'vest' | 'pack' | 'head' | 'helmet' | 'uarmL' | 'uarmR' | 'farmL' | 'farmR' | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'bootL' | 'bootR' | 'gun' | 'canopy';
const PARTS: PartName[] = ['pelvis', 'torso', 'vest', 'pack', 'head', 'helmet', 'uarmL', 'uarmR', 'farmL', 'farmR', 'thighL', 'thighR', 'shinL', 'shinR', 'bootL', 'bootR', 'gun', 'canopy'];

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function rbox(w: number, h: number, d: number, oy: number, oz = 0, r = 0.04) { return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)).translate(0, oy, oz); }
/** Limb: capsule hanging down from the joint. */
function limb(r0: number, len: number) { return new THREE.CapsuleGeometry(r0, Math.max(0.01, len - r0 * 2), 3, 7).translate(0, -len / 2, 0); }
const merge = (...g: THREE.BufferGeometry[]) => mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { x.deleteAttribute('uv'); return x; }))!;

const GEO: Record<PartName, THREE.BufferGeometry> = {
  pelvis: rbox(0.34, 0.22, 0.22, 0, 0, 0.07),
  torso: merge(rbox(0.36, 0.5, 0.21, 0.25, 0, 0.08), new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8).translate(0, 0.53, 0)),
  // plate carrier with front mag pouches and a radio pouch
  vest: merge(rbox(0.42, 0.36, 0.29, 0.27, 0.005, 0.05), rbox(0.3, 0.12, 0.07, 0.2, -0.17, 0.02), rbox(0.08, 0.14, 0.08, 0.34, 0.14, 0.02).translate(0.14, 0, 0.02)),
  pack: merge(rbox(0.3, 0.36, 0.16, 0.27, 0.22, 0.05), rbox(0.24, 0.12, 0.08, 0.12, 0.31, 0.03)),
  head: new THREE.SphereGeometry(0.115, 10, 8).scale(0.95, 1.1, 1.0).translate(0, 0.12, 0),
  // helmet shell with a brim and NVG mount
  helmet: merge(new THREE.SphereGeometry(0.14, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.9, 1.08).translate(0, 0.15, 0.01), rbox(0.05, 0.04, 0.03, 0.2, -0.14, 0.01)),
  uarmL: limb(0.058, 0.3), uarmR: limb(0.058, 0.3),
  farmL: merge(limb(0.05, 0.3), new THREE.SphereGeometry(0.05, 6, 5).translate(0, -0.31, 0)), farmR: merge(limb(0.05, 0.3), new THREE.SphereGeometry(0.05, 6, 5).translate(0, -0.31, 0)),
  thighL: limb(0.078, 0.45), thighR: limb(0.078, 0.45),
  shinL: merge(limb(0.064, 0.45), rbox(0.1, 0.1, 0.05, -0.08, -0.06, 0.02)), shinR: merge(limb(0.064, 0.45), rbox(0.1, 0.1, 0.05, -0.08, -0.06, 0.02)),
  bootL: rbox(0.13, 0.11, 0.28, -0.05, -0.05, 0.035), bootR: rbox(0.13, 0.11, 0.28, -0.05, -0.05, 0.035),
  gun: merge(new THREE.BoxGeometry(0.055, 0.08, 0.42).translate(0, 0, -0.2), new THREE.CylinderGeometry(0.013, 0.013, 0.36, 6).rotateX(Math.PI / 2).translate(0, 0.012, -0.58), new THREE.BoxGeometry(0.035, 0.12, 0.05).translate(0, -0.08, -0.26), new THREE.BoxGeometry(0.045, 0.07, 0.2).translate(0, -0.015, 0.08)),
  canopy: new THREE.CylinderGeometry(3.4, 3.8, 1.0, 14, 1, true).scale(1, 1, 0.55).translate(0, 5.2, 0),
};

const CAMOS = [
  [0x5b6147, 0x3f4433, 0x2e2f28], [0x6e6a58, 0x4d4a3d, 0x2f2e29], [0x4a4f55, 0x33373c, 0x25272a], [0x7a6d52, 0x5a4f3a, 0x33302a],
  [0x4d5a4a, 0x39433a, 0x2a2e29], [0x5e5e5e, 0x434343, 0x2a2a2a], [0x6a5a48, 0x4a3e32, 0x2c2824],
];
const SKIN = [0xc79a7c, 0xa77a5a, 0x7a5238, 0xdcb094];

interface Pose { m: THREE.Matrix4 }
const POOL = Array.from({ length: 24 }, () => new THREE.Matrix4()), ROOT = new THREE.Matrix4(), CANOPY = new THREE.Matrix4(), GUN = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

export class Characters {
  group = new THREE.Group();
  meshes = new Map<PartName, THREE.InstancedMesh>();
  private max: number;
  private phase = new Float32Array(200);
  hidden = -1; // local player id (first person)
  private col = new THREE.Color();

  constructor(max = 160) {
    this.max = max;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    const canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
    for (const n of PARTS) {
      const im = new THREE.InstancedMesh(GEO[n], n === 'canopy' ? canopyMat : mat, max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = n !== 'canopy'; im.receiveShadow = true; im.frustumCulled = false;
      im.count = 0;
      this.meshes.set(n, im); this.group.add(im);
    }
  }

  private put(n: PartName, idx: number, m: THREE.Matrix4, color: number) {
    const im = this.meshes.get(n)!;
    im.setMatrixAt(idx, m);
    this.col.setHex(color); im.setColorAt(idx, this.col);
  }

  update(players: Player[], alpha: number, cam: THREE.Vector3, dt: number, localSquad: number) {
    let n = 0, nc = 0;
    for (const p of players) {
      if (p.id === this.hidden) continue;
      if (p.phase === Phase.Plane || p.phase === Phase.Dead || p.phase === Phase.Spectate) continue;
      const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha, z = p.pz + (p.z - p.pz) * alpha;
      const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      if (d2 > 700 * 700) continue;
      if (n >= this.max) break;
      const speed = Math.hypot(p.vx, p.vz);
      this.phase[p.id] += dt * (speed > 0.3 ? 2.2 + speed * 0.95 : 0);
      const camo = CAMOS[p.squad % CAMOS.length];
      const skin = SKIN[p.id % SKIN.length];
      const chute = this.pose(p, x, y, z, n, camo, skin, speed);
      if (chute) { this.put('canopy', nc, chute, p.squad === localSquad ? 0x3a78c8 : 0x8a8f6a); nc++; }
      n++;
    }
    for (const [name, im] of this.meshes) {
      im.count = name === 'canopy' ? nc : n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** Builds all part matrices for one player; returns canopy matrix if on a parachute. */
  private pose(p: Player, x: number, y: number, z: number, idx: number, camo: number[], skin: number, speed: number): THREE.Matrix4 | null {
    const root = ROOT;
    const yaw = p.pyaw + wrap(p.yaw - p.pyaw);
    const ph = this.phase[p.id];
    const fwdV = -(p.vx * Math.sin(yaw) + p.vz * Math.cos(yaw)), sideV = p.vx * Math.cos(yaw) - p.vz * Math.sin(yaw);
    let hipY = 0.95, bodyPitch = 0, bodyRoll = 0;
    let thighL = 0, thighR = 0, shinL = 0, shinR = 0, legSpreadL = 0, legSpreadR = 0;
    let uarmL = -1.1, uarmR = -1.25, farmL = -0.3, farmR = -1.2, armOutL = 0.35, armOutR = -0.15;
    let spine = p.pitch * 0.35;
    const downed = p.phase === Phase.Downed;
    let canopy: THREE.Matrix4 | null = null;
    const stride = Math.min(1, speed / 5);
    const swing = Math.sin(ph) * (0.35 + stride * 0.35) * stride;
    const strafeK = Math.abs(sideV) > Math.abs(fwdV) ? 1 : 0;
    if (p.phase === Phase.Freefall) {
      bodyPitch = -1.35 + Math.max(0, -p.pitch) * 0.2; hipY = 0;
      uarmL = -2.2; uarmR = -2.2; armOutL = 1.0; armOutR = -1.0; farmL = 0.3; farmR = 0.3;
      thighL = 0.25; thighR = 0.25; legSpreadL = 0.35; legSpreadR = -0.35; shinL = 0.6; shinR = 0.6; spine = 0.2;
    } else if (p.phase === Phase.Chute) {
      hipY = 0; uarmL = -2.7; uarmR = -2.7; armOutL = 0.35; armOutR = -0.35; farmL = 0; farmR = 0;
      thighL = 0.2 + Math.sin(ph * 0.5) * 0.1; thighR = 0.1; shinL = 0.3; shinR = 0.4; spine = 0;
      canopy = CANOPY.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(0, yaw, 0)), one);
    } else if (downed || p.stance === Stance.Prone) {
      bodyPitch = -Math.PI / 2 + (downed ? 0.15 : 0); hipY = 0.2;
      thighL = 0.1 + Math.sin(ph) * 0.25 * stride; thighR = 0.1 - Math.sin(ph) * 0.25 * stride; shinL = 0.2; shinR = 0.2;
      legSpreadL = 0.15; legSpreadR = -0.15;
      if (downed) { uarmR = -2.4 + Math.sin(ph) * 0.4 * stride; uarmL = -0.6; armOutL = 0.6; farmL = -0.8; farmR = 0.2; }
      else { uarmL = -2.6; uarmR = -2.8; armOutL = 0.25; armOutR = -0.1; farmL = -0.1; farmR = -0.3; }
      spine = downed ? 0.35 : 0.9 + p.pitch * 0.3;
    } else {
      const crouch = p.stance === Stance.Crouch;
      if (crouch) { hipY = 0.62; thighL = 1.3 + swing * 0.4; thighR = 0.55 - swing * 0.4; shinL = 1.7; shinR = 1.3; bodyPitch = 0.12; }
      else {
        thighL = strafeK ? 0 : swing; thighR = strafeK ? 0 : -swing;
        legSpreadL = strafeK ? Math.max(0, Math.sin(ph)) * 0.45 * stride * Math.sign(sideV) : 0;
        legSpreadR = strafeK ? Math.max(0, -Math.sin(ph)) * -0.45 * stride * Math.sign(sideV) : 0;
        shinL = Math.max(0, -Math.cos(ph)) * 1.1 * stride + 0.05; shinR = Math.max(0, Math.cos(ph)) * 1.1 * stride + 0.05;
        if (fwdV < -0.5 && !strafeK) { thighL = -thighL; thighR = -thighR; }
        hipY = 0.95 - Math.abs(Math.sin(ph)) * 0.05 * stride;
        bodyPitch = p.sprinting ? 0.22 : 0.04 * stride;
      }
      if (p.sprinting) { uarmR = -0.5 + Math.sin(ph) * 0.3; farmR = -1.6; uarmL = -0.7 - Math.sin(ph) * 0.3; farmL = -1.4; armOutL = 0.2; spine = 0.1; }
      else if (p.ads > 0.5) { uarmR = -1.45; farmR = -1.15; uarmL = -1.35; farmL = -0.35; armOutL = 0.55; }
      if (p.reloadT > 0) { farmL = -1.6 + Math.sin(ph * 3 + y) * 0.2; uarmL = -0.7; }
      if (p.plateT > 0) { uarmL = -1.0; farmL = -1.9; uarmR = -1.0; farmR = -1.9; armOutR = -0.3; }
    }
    // sign conventions: +angle swings a limb forward; knees flex backward; arms were authored negated
    uarmL = -uarmL; uarmR = -uarmR; farmL = -farmL; farmR = -farmR; shinL = -shinL; shinR = -shinR;
    root.compose(tmpV.set(x, y + hipY, z), tmpQ.setFromEuler(tmpE.set(bodyPitch, yaw, bodyRoll, 'YXZ')), one);
    if (p.phase === Phase.Chute) root.compose(tmpV.set(x, y + 0.95, z), tmpQ.setFromEuler(tmpE.set(0, yaw, 0)), one);
    const fatigue = camo[0], dark = camo[1], gear = camo[2];
    let pi = 0;
    const J = (parent: THREE.Matrix4, ox: number, oy: number, oz: number, rx: number, ry: number, rz: number) => { const m = POOL[pi++]; return m.multiplyMatrices(parent, tmpM.compose(tmpV.set(ox, oy, oz), tmpQ.setFromEuler(tmpE.set(rx, ry, rz, 'XYZ')), one)); };
    this.put('pelvis', idx, root, dark);
    const torso = J(root, 0, 0.08, 0, spine, 0, 0);
    this.put('torso', idx, torso, fatigue);
    this.put('vest', idx, torso, gear);
    this.put('pack', idx, torso, dark);
    const head = J(torso, 0, 0.52, 0, -spine * 0.6 + (p.phase === Phase.Freefall ? 1.0 : 0), 0, 0);
    this.put('head', idx, head, skin);
    this.put('helmet', idx, head, gear);
    const shL = J(torso, -0.25, 0.44, 0, uarmL, 0, armOutL), shR = J(torso, 0.25, 0.44, 0, uarmR, 0, armOutR);
    this.put('uarmL', idx, shL, fatigue); this.put('uarmR', idx, shR, fatigue);
    const elL = J(shL, 0, -0.3, 0, farmL, 0, 0), elR = J(shR, 0, -0.3, 0, farmR, 0, 0);
    this.put('farmL', idx, elL, fatigue); this.put('farmR', idx, elR, fatigue);
    // gun in the right hand, pointing along the aim
    if (p.weapons[p.cur] && p.phase !== Phase.Freefall && p.phase !== Phase.Chute && !downed) {
      const g = GUN.multiplyMatrices(torso, tmpM.compose(tmpV.set(0.12, 0.38 - (p.sprinting ? 0.15 : 0), -0.25), tmpQ.setFromEuler(tmpE.set(p.sprinting ? -0.6 : p.pitch * 0.65, p.sprinting ? 0.5 : 0, 0)), one));
      const cls = WEAPON[p.weapons[p.cur]!.id].cls;
      const s = cls === 'pistol' ? 0.35 : cls === 'smg' ? 0.75 : cls === 'sniper' ? 1.35 : 1;
      g.scale(tmpV.set(1, 1, s));
      this.put('gun', idx, g, 0x1f2022);
    } else this.put('gun', idx, ZERO, 0);
    const hL = J(root, -0.1, -0.08, 0, thighL, 0, legSpreadL), hR = J(root, 0.1, -0.08, 0, thighR, 0, legSpreadR);
    this.put('thighL', idx, hL, dark); this.put('thighR', idx, hR, dark);
    const kL = J(hL, 0, -0.44, 0, shinL, 0, 0), kR = J(hR, 0, -0.44, 0, shinR, 0, 0);
    this.put('shinL', idx, kL, dark); this.put('shinR', idx, kR, dark);
    this.put('bootL', idx, J(kL, 0, -0.44, 0, 0, 0, 0), 0x1c1b19); this.put('bootR', idx, J(kR, 0, -0.44, 0, 0, 0, 0), 0x1c1b19);
    return canopy;
  }
}
const wrap = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
