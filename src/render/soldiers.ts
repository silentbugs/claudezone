/**
 * Nearby players as the rigged CC0 soldier (Quaternius): skinned mesh, animation clips cross-faded
 * by movement state, the real gun model held in both hands via two-bone arm IK, spine pitched to
 * the aim. Everyone further away (and prone / downed / skydiving players) stays on the cheap
 * instanced proxies in characters.ts.
 */
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { Phase, Player, Stance } from '../sim/types';
import { WEAPON } from '../data/weapons';
import { models } from './models';

const MAX = 14, RANGE = 55;
const SCALE = 0.94; // model is 1.82 m; our soldiers are ~1.72 m
const CAMO = [[0x5b6147, 0x2e2f28], [0x6e6a58, 0x2f2e29], [0x4a4f55, 0x25272a], [0x7a6d52, 0x33302a], [0x4d5a4a, 0x2a2e29], [0x5e5e5e, 0x2a2a2a], [0x6a5a48, 0x2c2824]];
/** clip → running speed (m/s) it was authored for, 0 = don't scale */
const NOMINAL: Record<string, number> = { Walk: 1.5, Jog: 3.6, Sprint: 6.2, Swat_Run_Back: 3.2, Swat_Run_Left: 3.4, Swat_Run_Right: 3.4, Crouch_Walk: 1.6 };

interface Slot {
  root: THREE.Group; model: THREE.Object3D; mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>; cur: string; pid: number;
  bones: Record<string, THREE.Bone>; mats: THREE.MeshStandardMaterial[][];
  gun: THREE.Group; gunKey: string; grip: THREE.Vector3; guard: THREE.Vector3; pistol: boolean;
  pitch: number; used: boolean; tilt: THREE.Group; proneK: number;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();

export class Soldiers {
  group = new THREE.Group();
  /** ids rendered here this frame (characters.ts skips them) */
  ids = new Set<number>();
  private slots: Slot[] = [];
  private byPid = new Map<number, Slot>();
  hidden = -1;

  get ready() { return models.gltf.has('soldier_swat'); }

  private make(): Slot {
    const g = models.gltf.get('soldier_swat')!;
    const model = skClone(g.scene);
    model.rotation.y = Math.PI; // authored facing +Z; our forward is -Z
    model.scale.setScalar(SCALE);
    const bones: Record<string, THREE.Bone> = {};
    const mats: THREE.MeshStandardMaterial[][] = [[], []];
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        const list = Array.isArray(m.material) ? m.material : [m.material];
        const cl = list.map((mt) => {
          const c = (mt as THREE.MeshStandardMaterial).clone();
          if (c.name === 'Swat') mats[0].push(c); else if (c.name === 'Swat_Black') mats[1].push(c);
          return c;
        });
        m.material = Array.isArray(m.material) ? cl : cl[0];
      }
    });
    const root = new THREE.Group(); const tilt = new THREE.Group(); tilt.add(model); root.add(tilt);
    const gun = new THREE.Group(); root.add(gun);
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const c of g.animations) actions.set(c.name, mixer.clipAction(c));
    root.visible = false;
    this.group.add(root);
    return { root, model, mixer, actions, cur: '', pid: -1, bones, mats, gun, gunKey: '', grip: new THREE.Vector3(), guard: new THREE.Vector3(), pistol: false, pitch: 0, used: false, tilt, proneK: 0 };
  }

  update(players: Player[], alpha: number, cam: THREE.Vector3, dt: number) {
    this.ids.clear();
    if (!this.ready) return;
    // nearest eligible players get a slot
    const cand: [number, Player][] = [];
    for (const p of players) {
      if (p.id === this.hidden || !eligible(p)) continue;
      const d2 = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2;
      if (d2 < RANGE * RANGE) cand.push([d2, p]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const chosen = cand.slice(0, MAX).map((c) => c[1]);
    const keep = new Set(chosen.map((p) => p.id));
    for (const [pid, s] of this.byPid) if (!keep.has(pid)) { s.used = false; s.pid = -1; s.root.visible = false; this.byPid.delete(pid); }
    for (const p of chosen) {
      let s = this.byPid.get(p.id);
      if (!s) {
        s = this.slots.find((x) => !x.used);
        if (!s) { if (this.slots.length >= MAX) continue; s = this.make(); this.slots.push(s); }
        s.used = true; s.pid = p.id; s.cur = ''; s.gunKey = ''; this.byPid.set(p.id, s);
        s.mixer.stopAllAction();
        const c = CAMO[p.squad % CAMO.length];
        for (const m of s.mats[0]) m.color.setHex(c[0]);
        for (const m of s.mats[1]) m.color.setHex(c[1]);
        s.pitch = p.pitch; s.proneK = p.stance === Stance.Prone ? 1 : 0;
      }
      this.pose(s, p, alpha, dt);
      this.ids.add(p.id);
    }
  }

  private play(s: Slot, name: string, fade = 0.18) {
    if (s.cur === name) return;
    const next = s.actions.get(name) ?? s.actions.get('Idle'); if (!next) return;
    const prev = s.cur ? s.actions.get(s.cur) : null;
    next.reset().setEffectiveWeight(1).play();
    if (name === 'Slide_Start' || name === 'Jump_Land') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    if (prev && prev !== next) prev.crossFadeTo(next, s.cur ? fade : 0, false);
    s.cur = name;
  }

  private pose(s: Slot, p: Player, alpha: number, dt: number) {
    const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha, z = p.pz + (p.z - p.pz) * alpha;
    const yaw = p.pyaw + wrap(p.yaw - p.pyaw);
    s.root.visible = true;
    s.root.position.set(x, y, z);
    s.root.rotation.set(0, yaw, 0);
    const speed = Math.hypot(p.vx, p.vz);
    const fwdV = -(p.vx * Math.sin(yaw) + p.vz * Math.cos(yaw)), sideV = p.vx * Math.cos(yaw) - p.vz * Math.sin(yaw);
    const inVeh = (p as any).vehicle !== undefined;
    // prone: the whole body lies flat (pivoting so the player's position is mid-body); a slow walk cycle reads as a crawl
    const prone = p.stance === Stance.Prone && !inVeh;
    s.proneK += ((prone ? 1 : 0) - s.proneK) * Math.min(1, dt * 6);
    const pk = s.proneK;
    s.tilt.rotation.x = -Math.PI / 2 * pk; s.tilt.position.set(0, 0.13 * pk, 0.85 * pk);
    let clip = 'Idle';
    if (inVeh) clip = 'Driving';
    else if (prone) clip = speed > 0.3 ? 'Walk' : 'Idle';
    else if (p.slideT > 0) clip = 'Slide_Loop';
    else if (p.swimming) clip = speed > 0.5 ? 'Swim' : 'Swim_Idle';
    else if (!p.onGround && p.mantleT <= 0) clip = 'Jump_Loop';
    else if (p.stance === Stance.Crouch) clip = speed > 0.4 ? 'Crouch_Walk' : 'Crouch_Idle';
    else if (p.sprinting) clip = 'Sprint';
    else if (speed > 0.4) {
      if (Math.abs(sideV) > Math.abs(fwdV) * 1.2) clip = sideV > 0 ? 'Swat_Run_Right' : 'Swat_Run_Left';
      else if (fwdV < 0) clip = 'Swat_Run_Back';
      else clip = speed < 2.6 ? 'Walk' : 'Jog';
    }
    this.play(s, clip);
    const a = s.actions.get(s.cur);
    if (a) a.timeScale = prone ? (speed > 0.3 ? 0.6 : 1) : NOMINAL[s.cur] ? THREE.MathUtils.clamp(speed / NOMINAL[s.cur], 0.55, 1.7) : 1;
    s.mixer.update(dt);

    // --- upper body: pitch the spine to the aim, hold the gun in both hands
    s.pitch += (p.pitch - s.pitch) * Math.min(1, dt * 14);
    const w = p.weapons[p.cur];
    const armed = !!w && !p.swimming && !inVeh && WEAPON[w.id].cls !== 'melee';
    s.root.updateMatrixWorld(true);
    const right = v4.set(1, 0, 0).applyQuaternion(s.root.quaternion);
    const chest = s.bones.Chest ?? s.bones.Torso;
    if (chest && !inVeh && pk < 0.5) rotateWorld(chest, right, s.pitch * 0.45);
    if (!armed) { s.gun.visible = false; return; }
    const key = `${w!.id}:${w!.rarity}`;
    if (key !== s.gunKey) {
      s.gunKey = key; s.gun.clear();
      const gm = models.gun(w!.id, w!.rarity);
      s.pistol = WEAPON[w!.id].cls === 'pistol';
      if (gm) s.gun.add(gm.obj);
      s.grip.set(0, -0.045, s.pistol ? 0.045 : 0.1);
      s.guard.set(s.pistol ? -0.025 : 0, s.pistol ? -0.05 : -0.035, s.pistol ? 0.05 : -0.16);
    }
    s.gun.visible = true;
    // gun pose in the soldier's facing frame (forward -Z, right +X)
    const sprint = p.sprinting && p.ads < 0.3;
    const sh = 1.36 - (p.stance === Stance.Crouch ? 0.46 : 0) - (p.slideT > 0 ? 0.62 : 0);
    const reload = p.reloadT > 0;
    s.gun.position.set(sprint ? 0.1 : 0.13 - p.ads * 0.06, sh - (sprint ? 0.2 : p.ads > 0.5 ? 0.06 : 0.12), sprint ? -0.24 : s.pistol ? -0.42 : -0.3 + p.ads * 0.06);
    s.gun.rotation.set(sprint ? -0.55 : s.pitch * 0.9 + (reload ? -0.35 : 0), sprint ? 0.9 : 0.03, sprint ? 0.5 : reload ? 0.4 : 0, 'YXZ');
    if (pk > 0.5) { s.gun.position.set(0.1, 0.24, s.pistol ? -1.2 : -1.02); s.gun.rotation.set(s.pitch * 0.5, 0.02, 0, 'YXZ'); }
    s.gun.updateMatrixWorld(true);
    // arms: two-bone IK from the shoulders to the grip / handguard
    const tR = v1.copy(s.grip).applyMatrix4(s.gun.matrixWorld);
    const tL = v2.copy(s.guard).applyMatrix4(s.gun.matrixWorld);
    if (reload) tL.copy(v3.set(0, -0.12, 0.02).applyMatrix4(s.gun.matrixWorld));
    const down = v3.set(0, -1, 0);
    // prone: elbows rest on the ground out to the sides
    const pr = poleOf(s.root, 0.55, down), pl = poleOf(s.root, -0.55, down);
    if (pk > 0.5) { pr.set(0.9, -0.6, 0.3).applyQuaternion(s.root.quaternion); pl.set(-0.9, -0.6, 0.3).applyQuaternion(s.root.quaternion); }
    ik(s.bones.UpperArmR, s.bones.LowerArmR, s.bones.WristR, tR, pr);
    if (p.plateT <= 0) ik(s.bones.UpperArmL, s.bones.LowerArmL, s.bones.WristL, tL, pl);
  }
}

function eligible(p: Player) {
  if (p.phase === Phase.Plane || p.phase === Phase.Dead || p.phase === Phase.Spectate || p.phase === Phase.Freefall || p.phase === Phase.Chute || p.phase === Phase.Downed) return false;
  if (p.phase === Phase.GulagWait) return false;
  return true;
}

/** Elbow hint: out to the side and down, in world space. */
function poleOf(root: THREE.Object3D, side: number, _down: THREE.Vector3) {
  return new THREE.Vector3(side, -0.9, 0.15).applyQuaternion(root.quaternion);
}

/** Rotate a bone by `angle` about a world-space axis, keeping its parent. */
function rotateWorld(b: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  const parent = b.parent!; parent.updateWorldMatrix(true, false);
  const pw = parent.getWorldQuaternion(q2);
  const bw = b.getWorldQuaternion(new THREE.Quaternion());
  const nw = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(bw);
  b.quaternion.copy(pw.invert().multiply(nw));
  b.updateMatrixWorld(true);
}

/** Swing bone so that the direction to `child` points at `dir` (world). */
function aim(b: THREE.Object3D, childPos: THREE.Vector3, want: THREE.Vector3) {
  const bp = b.getWorldPosition(new THREE.Vector3());
  const cur = childPos.clone().sub(bp).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, want.clone().normalize());
  const parent = b.parent!;
  const pw = parent.getWorldQuaternion(new THREE.Quaternion());
  const bw = b.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(pw.invert().multiply(q.multiply(bw)));
  b.updateMatrixWorld(true);
}

function ik(up: THREE.Bone | undefined, lo: THREE.Bone | undefined, wr: THREE.Bone | undefined, target: THREE.Vector3, pole: THREE.Vector3) {
  if (!up || !lo || !wr) return;
  const S = up.getWorldPosition(new THREE.Vector3()), E = lo.getWorldPosition(new THREE.Vector3()), W = wr.getWorldPosition(new THREE.Vector3());
  const a = E.distanceTo(S), b = W.distanceTo(E);
  const toT = target.clone().sub(S); let d = toT.length();
  d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  // elbow: law of cosines, bent toward the pole
  const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pn = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const elbow = S.clone().add(dir.clone().multiplyScalar(cosA * a)).add(pn.multiplyScalar(sinA * a));
  aim(up, E, elbow.clone().sub(S));
  const W2 = wr.getWorldPosition(new THREE.Vector3());
  const tgt = S.clone().add(dir.multiplyScalar(d));
  aim(lo, W2, tgt.sub(lo.getWorldPosition(new THREE.Vector3())));
}

const wrap = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
