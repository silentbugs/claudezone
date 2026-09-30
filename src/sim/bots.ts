/**
 * Bot brains. They fill the same Intent a human does. Decisions run at 10 Hz (staggered); aim and
 * movement smoothing run every tick. Lessons carried over: commit to one target, break stalemates,
 * don't let loose loot out-rank fights, and spread the drop so the whole lobby isn't in one POI.
 */
import type { Sim } from './sim';
import { ItemKind, Phase, Player, Stance } from './types';
import { POIS } from '../world/mapdata';
import { WEAPON } from '../data/weapons';
import { eyeHeight } from './movement';
import { clamp, wrapAngle } from '../core/math';
import { PRICES } from './config';
import { Mat, RayHit } from '../world/collision';
import { gulagArena } from '../world/landmarks';
import { vehicleOf, enterVehicle, exitVehicle, VEHICLES } from './vehicles';

type Goal = 'drop' | 'loot' | 'rotate' | 'fight' | 'revive' | 'buy' | 'idle' | 'follow';

/** Bot difficulty (chosen on the menu): skill range, aim error, extra reaction time, aim turn speed. */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'veteran';
export const DIFFICULTY: Record<Difficulty, { lo: number; hi: number; err: number; react: number; turn: number; label: string }> = {
  easy: { lo: 0.1, hi: 0.4, err: 3.5, react: 0.55, turn: 0.55, label: 'Easy' },
  normal: { lo: 0.25, hi: 0.65, err: 2, react: 0.25, turn: 0.8, label: 'Normal' },
  hard: { lo: 0.35, hi: 0.9, err: 1, react: 0, turn: 1, label: 'Hard' },
  veteran: { lo: 0.6, hi: 1, err: 0.75, react: -0.08, turn: 1.15, label: 'Veteran' },
};
export class BotBrain {
  goal: Goal = 'drop';
  tx = 0; tz = 0; // current move target
  dropX = 0; dropZ = 0; jumpAt = 0;
  target = -1; targetSince = 0; seenAt = -99; reactAt = 0; aimErr = 0.2; lastSeenX = 0; lastSeenZ = 0; lastSeenY = 0;
  engageStart = 0; blacklist = new Map<number, number>();
  strafe = 1; strafeT = 0; crouchT = 0;
  stuckT = 0; lastX = 0; lastZ = 0; detourT = 0; detourA = 0;
  itemId = -1; itemT = 0;
  thinkT = 0; wanderA = 0;
  skill: number;
  fireHold = 0; burstT = 0;
  buyId = -1;
  roofT = 0;
  tx2 = 0; tz2 = 0; driveStuck = 0;
  failed = new Map<number, number>();
  path: [number, number][] | null = null; pathI = 0; pathGX = 0; pathGZ = 0; replan = false; pathCd = 0;
  chestId = -1; chestT = 0;
  /** play style: how the bot spends a match (what it goes for and how) */
  style: 'aggressive' | 'contractor' | 'looter' | 'camper';
  contractScanAt = 0; tabletId = -1; holdUntil = 0; holdX = 0; holdZ = 0;
  lootScanAt = 0; gunScanAt = 0;
  constructor(public id: number, r: number) {
    this.skill = 0.35 + r * 0.55; this.wanderA = r * 6.28;
    const k = ((id * 2654435761) >>> 0) % 100;
    this.style = k < 30 ? 'aggressive' : k < 60 ? 'contractor' : k < 85 ? 'looter' : 'camper';
  }
  /** difficulty tuning shared by all bots (see DIFFICULTY) */
  static tune = { err: 1, react: 0, turn: 1 };
}

const hitBuf: RayHit = { t: 0, nx: 0, ny: 0, nz: 0, structure: -1, part: -1, mat: Mat.Rock, terrain: false, water: false };
const claims = new Map<string, number>();

function chooseDrop(sim: Sim, b: BotBrain, p: Player) {
  // squadmates share the leader's choice
  const leader = sim.brains[p.squad * sim.squadSize];
  if (leader && leader.id !== b.id && leader.dropX) { b.dropX = leader.dropX + sim.rng.range(-40, 40); b.dropZ = leader.dropZ + sim.rng.range(-40, 40); b.jumpAt = leader.jumpAt + sim.rng.range(-1, 1); return; }
  const pl = sim.plane;
  const cand = POIS.filter((q) => q.tier !== 'landmark');
  const pick = sim.rng.weighted(cand, (q) => {
    // distance from the flight line
    const rx = q.x - pl.sx, rz = q.z - pl.sz; const along = rx * pl.dx + rz * pl.dz; const off = Math.abs(rx * pl.dz - rz * pl.dx);
    if (along < 0) return 0.01;
    const near = Math.exp(-(off * off) / (2 * 700 * 700));
    const c = claims.get(q.id) ?? 0;
    return (q.tier === 'major' ? 1.4 : 0.8) * (0.15 + near) / Math.pow(1 + c, 2.2);
  });
  claims.set(pick.id, (claims.get(pick.id) ?? 0) + 1);
  const a = sim.rng.range(0, 6.28), d = Math.sqrt(sim.rng.next()) * Math.max(40, pick.r * 0.7);
  b.dropX = pick.x + Math.cos(a) * d; b.dropZ = pick.z + Math.sin(a) * d;
  for (let i = 0; i < 12; i++) { const g = sim.world.hf.at(b.dropX, b.dropZ); if (sim.world.col.groundAt(b.dropX, b.dropZ, g + 300, 2) <= g + 1 && g > 1) break; b.dropX += sim.rng.range(-15, 15); b.dropZ += sim.rng.range(-15, 15); }
  // jump when the plane's along-track position passes the target minus a glide lead
  const rx = b.dropX - pl.sx, rz = b.dropZ - pl.sz; const along = rx * pl.dx + rz * pl.dz; const off = Math.abs(rx * pl.dz - rz * pl.dx);
  const lead = Math.max(0, Math.min(off * 0.3, 350));
  b.jumpAt = Math.max(4, (along - lead) / 62 + sim.rng.range(-3, 3));
}

function moveToward(sim: Sim, b: BotBrain, p: Player, x: number, z: number, run: boolean, dt: number) {
  const it = p.intent;
  const dTot = Math.hypot(x - p.x, z - p.z);
  if (dTot < 1.2) { it.mz = 0; it.mx = 0; it.sprint = false; return true; }
  // plan with the nav grid when the straight line is blocked (re-plan on a new goal or when stuck)
  const nav = sim.nav;
  if (dTot > 12 && (Math.hypot(b.pathGX - x, b.pathGZ - z) > 15 || b.replan)) {
    b.replan = false; b.pathGX = x; b.pathGZ = z; b.path = null; b.pathI = 0;
    if (!nav.los(p.x, p.z, x, z) && sim.time >= b.pathCd) {
      // a few searches per tick across all bots: when gunfire makes a crowd re-target at once, the rest wait a tick
      // (walking straight meanwhile) instead of stacking dozens of A* runs into one frame
      if (sim.pathBudget > 0) { sim.pathBudget--; b.path = nav.find(p.x, p.z, x, z, 14000); b.pathCd = sim.time + 1.5; }
      else b.replan = true;
    }
  }
  let wx = x, wz = z;
  if (b.path && b.pathI < b.path.length) {
    const w = b.path[b.pathI];
    if (Math.hypot(w[0] - p.x, w[1] - p.z) < 3.5 && b.pathI < b.path.length - 1) b.pathI++;
    // skip ahead when a later waypoint is directly reachable
    if (b.pathI + 1 < b.path.length && nav.los(p.x, p.z, b.path[b.pathI + 1][0], b.path[b.pathI + 1][1])) b.pathI++;
    wx = b.path[b.pathI][0]; wz = b.path[b.pathI][1];
  }
  const dx = wx - p.x, dz = wz - p.z, d = Math.hypot(dx, dz);
  let a = Math.atan2(-dx, -dz); // yaw facing target
  // stuck handling: detour sideways for a moment
  if (b.detourT > 0) { b.detourT -= dt; a += b.detourA; }
  else {
    const moved = Math.hypot(p.x - b.lastX, p.z - b.lastZ);
    b.lastX = p.x; b.lastZ = p.z;
    if (moved < 0.02 && p.onGround) b.stuckT += dt; else b.stuckT = Math.max(0, b.stuckT - dt);
    if (b.stuckT > 0.8) { b.stuckT = 0; b.detourT = 0.9 + sim.rng.next(); b.detourA = (sim.rng.chance(0.5) ? 1 : -1) * (0.9 + sim.rng.next() * 0.8); it.jump = true; b.replan = true; b.pathCd = 0; }
  }
  // don't walk off drops that would hurt: probe the ground two metres ahead
  if (p.onGround && b.detourT <= 0) {
    const ax = p.x - Math.sin(a) * 2, az = p.z - Math.cos(a) * 2;
    const g = sim.world.col.groundAt(ax, az, p.y + 0.6, 0.2);
    if (p.y - g > 4.5 && Math.abs(b.tx - p.x) + Math.abs(b.tz - p.z) > 3) { b.detourT = 0.6; b.detourA = (sim.rng.chance(0.5) ? 1 : -1) * 1.6; b.roofT = (b.roofT ?? 0) + dt * 10; a += b.detourA; }
  }
  it.yaw = lerpYaw(it.yaw, a, Math.min(1, dt * 8));
  it.mz = 1; it.mx = 0;
  it.sprint = run && dTot > 6;
  void d;
  if (it.sprint && sim.rng.chance(0.004)) (it as any).tac = true;
  return false;
}
const lerpYaw = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

function humanIn(sim: Sim, p: Player): boolean { for (const q of sim.players) if (q.squad === p.squad && !q.bot) return true; return false; }
function canSee(sim: Sim, p: Player, q: Player): boolean {
  const ey = p.y + eyeHeight(p), ty = q.y + (q.phase === Phase.Downed || q.stance === Stance.Prone ? 0.35 : q.stance === Stance.Crouch ? 1.0 : 1.4);
  if (!sim.world.col.los(p.x, ey, p.z, q.x, ty, q.z)) return false;
  for (const s of sim.smokes) { // smoke blocks sight
    const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
    if (Math.hypot(s.x - mx, s.z - mz) < 8 || Math.hypot(s.x - q.x, s.z - q.z) < 7) return false;
  }
  return true;
}

function bestWeaponFor(p: Player, dist: number): number {
  let best = p.cur, bs = -1;
  p.weapons.forEach((w, i) => {
    if (!w) return;
    const d = WEAPON[w.id];
    const ammo = w.mag + p.ammo[d.ammo];
    if (ammo <= 0) return;
    let s = w.rarity * 0.3;
    if (d.cls === 'melee') s -= 5;
    const cls = d.cls === 'tactical' ? 'ar' : d.cls;
    if (dist < 15) s += cls === 'shotgun' || cls === 'smg' ? 3 : cls === 'ar' ? 2 : cls === 'lmg' ? 1.5 : cls === 'pistol' ? 1 : 0.5;
    else if (dist < 60) s += cls === 'ar' ? 3 : cls === 'lmg' ? 2.6 : cls === 'smg' ? 2 : cls === 'marksman' ? 1.5 : 1;
    else s += cls === 'sniper' || cls === 'marksman' ? 3 : cls === 'ar' || cls === 'lmg' ? 2.4 : 0.8;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}

export function botThink(sim: Sim, b: BotBrain, p: Player, dt: number, think: boolean) {
  const it = p.intent;
  it.fire = false; it.jump = it.jump && false; it.interact = false; it.plate = false; it.reload = false;
  switch (p.phase) {
    case Phase.Plane: {
      const human = humanLeader(sim, p);
      if (human) { if (human.phase !== Phase.Plane) it.jump = true; return; } // jump with the squad leader
      if (!b.dropX) chooseDrop(sim, b, p);
      if (sim.plane.canJump && sim.plane.t >= b.jumpAt) it.jump = true;
      return;
    }
    case Phase.Freefall: case Phase.Chute: {
      const human = humanLeader(sim, p);
      if (human && (human.phase === Phase.Freefall || human.phase === Phase.Chute)) { const a0 = (p.id % 3) * 2.1; b.dropX = human.x + Math.cos(a0) * 25 + human.vx * 4; b.dropZ = human.z + Math.sin(a0) * 25 + human.vz * 4; }
      else if (human && human.phase === Phase.Alive && Math.hypot(human.x - b.dropX, human.z - b.dropZ) > 60) { const a0 = (p.id % 3) * 2.1; b.dropX = human.x + Math.cos(a0) * 20; b.dropZ = human.z + Math.sin(a0) * 20; }
      if (!b.dropX) { b.dropX = p.x + sim.rng.range(-200, 200); b.dropZ = p.z + sim.rng.range(-200, 200); }
      const dx = b.dropX - p.x, dz = b.dropZ - p.z, d = Math.hypot(dx, dz);
      it.yaw = lerpYaw(it.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 3));
      const agl = p.y - sim.world.hf.at(p.x, p.z);
      // glide ratio: dive when the target is under us
      it.pitch = d < agl * 0.5 ? -1.2 : -0.1;
      if (p.phase === Phase.Chute && agl < 60) {
        // about to land on a roof? slide the target to open ground
        const col = sim.world.col, g = sim.world.hf.at(b.dropX, b.dropZ);
        if (col.groundAt(b.dropX, b.dropZ, g + 200, 1.5) > g + 1.5) { const a2 = sim.rng.range(0, 6.28); b.dropX += Math.cos(a2) * 12; b.dropZ += Math.sin(a2) * 12; }
      }
      it.mz = d > 15 ? 1 : 0; it.mx = 0;
      return;
    }
    case Phase.Downed: {
      // crawl toward the nearest teammate, self revive when nobody is close
      const mate = sim.players.find((q) => q.squad === p.squad && q.id !== p.id && q.phase === Phase.Alive);
      if (mate) moveToward(sim, b, p, mate.x, mate.z, false, dt); else { it.mz = 0; }
      if (p.selfRevive) {
        const threat = sim.playersNear(p.x, p.z, 40).some((q) => q.squad !== p.squad && q.alive && q.phase === Phase.Alive);
        it.selfRevive = !threat;
      }
      return;
    }
    case Phase.GulagWait: {
      it.mz = 0; it.mx = 0;
      const f0 = sim.gulag.fights.find((f) => f.arena === 0);
      if (think && f0 && sim.rng.chance(0.02)) it.tactical = true; // throw rocks at the fighters
      const tgt = f0 ? sim.players[(p.id % 2) ? f0.a : f0.b] : null;
      if (tgt) { const dx = tgt.x - p.x, dz = tgt.z - p.z; it.yaw = Math.atan2(-dx, -dz); it.pitch = Math.atan2(tgt.y + 1 - p.y - 1.6, Math.hypot(dx, dz)) + 0.15; }
      return;
    }
    case Phase.Dead: case Phase.Spectate: return;
  }
  // ------------------------------------------------ Alive / Gulag
  const inGulag = p.phase === Phase.Gulag;
  const veh = vehicleOf(sim, p);
  if (veh) { botDrive(sim, b, p, veh, dt, think); return; }
  if (think) decide(sim, b, p, inGulag);
  const w = p.weapons[p.cur];
  const def = w ? WEAPON[w.id] : null;
  // --- combat
  if (b.target >= 0) {
    const q = sim.players[b.target];
    const visible = sim.time - b.seenAt < 0.25;
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    const aimY = q.y + (q.phase === Phase.Downed || q.stance === Stance.Prone ? 0.3 : q.stance === Stance.Crouch ? 0.95 : 1.25);
    const ey = p.y + eyeHeight(p);
    // lead moving targets a little, plus a tracking error that shrinks while we keep sight
    const tof = def ? dist / def.velocity : 0;
    const ax = q.x + q.vx * tof, az = q.z + q.vz * tof;
    const wantYaw = Math.atan2(-(ax - p.x), -(az - p.z));
    const wantPitch = Math.atan2(aimY - ey, dist) + (def ? 0.5 * 9.8 * 0.55 * tof * tof / Math.max(1, dist) : 0);
    const T = BotBrain.tune;
    b.aimErr = Math.max((0.008 + (1 - b.skill) * 0.02) * T.err, b.aimErr - dt * (0.1 + b.skill * 0.22));
    const errYaw = Math.sin(sim.time * 3.1 + b.id) * b.aimErr * (1 + dist / 120), errPitch = Math.cos(sim.time * 2.3 + b.id * 1.7) * b.aimErr * 0.7 * (1 + dist / 120);
    const turn = Math.min(1, dt * (6 + b.skill * 10) * T.turn);
    it.yaw = lerpYaw(it.yaw, wantYaw + errYaw, turn);
    it.pitch += (wantPitch + errPitch - p.recoil * (0.4 + b.skill * 0.5) - it.pitch) * turn;
    const aimed = Math.abs(wrapAngle(p.yaw - wantYaw)) < 0.12 + 2 / Math.max(5, dist);
    it.ads = dist > 12 && visible && p.stance !== Stance.Prone || (def?.scope ?? false) && visible;
    if (visible && sim.time >= b.reactAt && aimed && def) {
      const maxRange = def.cls === 'shotgun' ? 30 : def.cls === 'smg' ? 90 : def.cls === 'pistol' ? 70 : 450;
      if (dist < maxRange) {
        // bursts at range, full auto up close
        if (dist > 45 && def.auto) { b.burstT -= dt; if (b.burstT < -0.25) b.burstT = 0.22 + sim.rng.next() * 0.2; it.fire = b.burstT > 0; }
        else it.fire = !def.auto ? sim.rng.chance(0.5) : true;
        if (def.bolt && p.ads < 0.9) it.fire = false;
      }
    }
    // fight movement: strafe, some crouching, close to preferred range
    b.strafeT -= dt; if (b.strafeT <= 0) { b.strafeT = 0.5 + sim.rng.next() * 1.2; b.strafe = sim.rng.chance(0.5) ? 1 : -1; if (sim.rng.chance(0.2 * b.skill)) it.crouch = true; }
    const c1 = sim.circle;
    if (!inGulag && Math.hypot(p.x - c1.cx, p.z - c1.cz) > c1.r - 10) {
      // fighting in the gas: keep running for the circle, strafe relative to that
      const toC = Math.atan2(-(c1.cx - p.x), -(c1.cz - p.z)), rel = wrapAngle(toC - p.yaw);
      it.mz = Math.cos(rel); it.mx = -Math.sin(rel); it.sprint = false; if (w && w.mag === 0) it.reload = true;
      return;
    }
    it.mx = visible ? b.strafe * 0.9 : 0;
    const pref = def ? (def.cls === 'shotgun' || def.cls === 'smg' ? 10 : def.cls === 'sniper' ? 120 : 35) : 20;
    it.mz = !visible ? 1 : dist > pref * 1.8 ? 0.8 : dist < pref * 0.4 ? -0.6 : 0;
    it.sprint = !visible && dist > 20;
    if (!visible) {
      // push toward last known position
      const lx = b.lastSeenX - p.x, lz = b.lastSeenZ - p.z;
      it.yaw = lerpYaw(it.yaw, Math.atan2(-lx, -lz), Math.min(1, dt * 5));
      if (Math.hypot(lx, lz) < 2) b.target = -1;
    }
    if (p.stance === Stance.Crouch && sim.rng.chance(0.01)) it.crouch = true;
    if (w && w.mag === 0) it.reload = true;
    return;
  }
  it.ads = false;
  if (p.stance !== Stance.Stand && sim.rng.chance(0.05)) it.crouch = p.stance === Stance.Crouch;
  // --- non-combat upkeep
  if (p.plates > 0 && p.armor < 150 && sim.time - b.seenAt > 1.5) it.plate = true;
  if (w && def && w.mag < (def.mag * 0.5) && p.ammo[def.ammo] > 0 && sim.time - b.seenAt > 2) it.reload = true;
  switch (b.goal) {
    case 'loot': case 'rotate': case 'follow': case 'buy': case 'idle': {
      const arrived = moveToward(sim, b, p, b.tx, b.tz, b.goal !== 'loot' || Math.hypot(b.tx - p.x, b.tz - p.z) > 25, dt);
      if (b.goal === 'loot' && b.itemId >= 0) {
        b.itemT += dt;
        const itm = sim.itemById.get(b.itemId);
        if (!itm || !itm.alive) { b.itemId = -1; break; }
        const d = Math.hypot(itm.x - p.x, itm.z - p.z);
        if (d < 2.4 || (b.itemT > 5 && d < 22)) {
          // looting abstraction: bots can't path through every doorway, so after trying for a while they "find the way"
          if (itm.kind === ItemKind.Weapon || itm.kind === ItemKind.Lethal || itm.kind === ItemKind.Tactical || itm.kind === ItemKind.Killstreak || itm.kind === ItemKind.SelfRevive || itm.kind === ItemKind.GasMask || itm.kind === ItemKind.Satchel) wantPickup(sim, p, itm.id);
          else simTake(sim, p, itm.id);
          b.itemId = -1;
        } else if (b.itemT > 12) { b.failed.set(b.itemId, sim.time + 90); b.itemId = -1; }
      } else if (b.goal === 'buy' && arrived) {
        const st = sim.buyStations.find((s) => s.id === b.buyId);
        if (st && Math.hypot(st.x - p.x, st.z - p.z) < 5) botShop(sim, p);
        b.goal = 'idle';
      }
      break;
    }
    case 'revive': {
      const q = sim.players[b.target >= 0 ? b.target : 0];
      void q;
      break;
    }
  }
  if (b.goal === 'revive') {
    const mate = sim.players.find((q) => q.id === (b as any).reviveId);
    if (mate && mate.phase === Phase.Downed) {
      const arrived = moveToward(sim, b, p, mate.x, mate.z, true, dt);
      if (arrived || Math.hypot(mate.x - p.x, mate.z - p.z) < 2) { it.interact = true; it.mz = 0; it.sprint = false; }
    } else b.goal = 'idle';
  }
}

function wantPickup(sim: Sim, p: Player, id: number) {
  const itm = sim.itemById.get(id); if (!itm) return;
  // only swap weapons for something better
  if (itm.kind === ItemKind.Weapon) {
    const empty = p.weapons.findIndex((w) => !w);
    if (empty < 0) {
      const worst = p.weapons.reduce((m, w, i) => (w!.rarity + (WEAPON[w!.id].cls === 'pistol' ? -3 : 0) < (p.weapons[m]!.rarity + (WEAPON[p.weapons[m]!.id].cls === 'pistol' ? -3 : 0)) ? i : m), 0);
      const cur = p.weapons[worst]!;
      const score = (id2: string, r: number) => r + (WEAPON[id2].cls === 'pistol' ? -3 : 0) + (WEAPON[id2].cls === 'launcher' ? -2 : 0);
      if (score(itm.weapon!, itm.rarity!) <= score(cur.id, cur.rarity)) return;
      p.cur = worst;
    }
  }
  simTake(sim, p, id, true);
}
import { tryPickup } from './loot';
function simTake(sim: Sim, p: Player, id: number, explicit = false) {
  const itm = sim.itemById.get(id); if (itm) tryPickup(sim, p, itm, explicit);
}

function botShop(sim: Sim, p: Player) {
  const dead = sim.players.find((q) => q.squad === p.squad && q.id !== p.id && q.phase === Phase.Dead);
  if (dead && p.cash >= PRICES.buyback) { sim.buy(p, 'buyback', dead.id); return; }
  if (p.cash >= PRICES.loadout && !p.loadoutUsed) { sim.buy(p, 'loadout'); return; }
  if (p.cash >= PRICES.plates && p.plates < 3) sim.buy(p, 'plates');
  if (p.cash >= PRICES.selfRevive && !p.selfRevive) sim.buy(p, 'selfRevive');
  // spare cash: a UAV (or sometimes a Counter UAV / airstrike) for the next fight
  if (!p.killstreak && p.cash >= PRICES.uav + 2000) sim.buy(p, sim.rng.pick(['uav', 'uav', 'cuav', 'cluster', 'airstrike'] as const));
}

function decide(sim: Sim, b: BotBrain, p: Player, inGulag: boolean) {
  const it = p.intent;
  // ---------------- perception: commit to a target, re-acquire only when needed
  if (b.target >= 0) {
    const q = sim.players[b.target];
    const gone = !q.alive || (q.phase !== Phase.Alive && q.phase !== Phase.Downed && q.phase !== Phase.Gulag && q.phase !== Phase.Chute) || (q.phase === Phase.Gulag) !== inGulag;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (gone || d > 320) b.target = -1;
    else if (canSee(sim, p, q)) { b.seenAt = sim.time; b.lastSeenX = q.x; b.lastSeenZ = q.z; b.lastSeenY = q.y; }
    else if (sim.time - b.seenAt > 6) b.target = -1;
    // stalemate breaker
    if (b.target >= 0 && sim.time - b.engageStart > 18 && p.health + p.armor > 150 && q.health + q.armor > 150) { b.blacklist.set(q.id, sim.time + 20); b.target = -1; }
  }
  // squad callouts: a bot that just picked a target pings it for its squad (if a human is in it)
  if (b.target >= 0 && sim.time - b.targetSince < 0.05 && humanIn(sim, p) && canSee(sim, p, sim.players[b.target])) {
    const last = (sim as any).lastBotPing?.[p.squad] ?? -99;
    if (sim.time - last > 5) { ((sim as any).lastBotPing ??= {})[p.squad] = sim.time; sim.pingEnemy(p, sim.players[b.target]); }
  }
  // an enemy pinged by the squad becomes our target when we have none and it's close enough
  if (b.target < 0) for (const e of sim.enemyPings) if (e.squad === p.squad && e.until > sim.time && e.by !== p.id) {
    const q = sim.players[e.target]; if (!q.alive || Math.hypot(q.x - p.x, q.z - p.z) > 160) continue;
    b.target = q.id; b.targetSince = sim.time; b.seenAt = sim.time; b.lastSeenX = e.x; b.lastSeenZ = e.z; b.lastSeenY = e.y; b.reactAt = sim.time + 0.4; break;
  }
  // killstreaks: scans as soon as a fight starts, strikes on a target that has been dug in for a while
  if (p.killstreak && p.killstreak !== 'turret' && b.target >= 0 && !inGulag && p.phase === Phase.Alive) {
    const q = sim.players[b.target], ks = p.killstreak;
    if ((ks === 'uav' || ks === 'cuav') && sim.time - b.targetSince > 1.5) sim.useKillstreak(p);
    else if ((ks === 'cluster' || ks === 'airstrike') && sim.time - b.targetSince > 8 && Math.hypot(q.x - p.x, q.z - p.z) > 45) sim.useKillstreak(p, q.x, q.z);
  }
  const c0 = sim.circle;
  const gasNow = !inGulag && Math.hypot(p.x - c0.cx, p.z - c0.cz) > c0.r - 15;
  const gasSoon = !inGulag && Math.hypot(p.x - c0.nx, p.z - c0.nz) > c0.nr && c0.closing;
  if (b.target >= 0 && (gasNow || gasSoon)) { const q = sim.players[b.target]; if (Math.hypot(q.x - p.x, q.z - p.z) > (gasNow ? 20 : 45)) b.target = -1; }
  // (b) with only a sidearm, loot first: fight only when close or when shot at
  const armed = p.weapons.some((w) => w && WEAPON[w.id].cls !== 'pistol');
  if (b.target < 0) {
    const range = inGulag ? 60 : gasNow ? 30 : !armed && sim.time - p.lastDamaged > 2 ? 22 : 120 + b.skill * 100;
    let best: Player | null = null, bd = Infinity;
    let checks = 0;
    const recentlyHit = sim.time - p.lastDamaged < 1;
    for (const q of sim.playersNear(p.x, p.z, range)) {
      if (q.squad === p.squad || !q.alive) continue;
      if ((q.phase === Phase.Gulag) !== inGulag || q.phase === Phase.GulagWait) continue;
      if (q.phase !== Phase.Alive && q.phase !== Phase.Gulag && q.phase !== Phase.Downed && q.phase !== Phase.Chute) continue;
      if ((b.blacklist.get(q.id) ?? 0) > sim.time) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      // field of view unless we were just shot
      const ang = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - p.yaw));
      if (!recentlyHit && ang > 1.2 && d > 12) continue;
      // far targets are noticed less often (and never in dense vegetation)
      if (d > 80 && !sim.rng.chance(0.2 + b.skill * 0.25)) continue;
      const score = d * (q.phase === Phase.Downed ? 1.6 : 1) * (q.lastShot > sim.time - 2 ? 0.7 : 1);
      if (score < bd && checks++ < 4 && canSee(sim, p, q)) { bd = score; best = q; }
    }
    if (best) {
      b.target = best.id; b.seenAt = sim.time; b.engageStart = sim.time; b.lastSeenX = best.x; b.lastSeenZ = best.z;
      b.reactAt = sim.time + Math.max(0.15, 0.35 + (1 - b.skill) * 0.6 + BotBrain.tune.react) + Math.hypot(best.x - p.x, best.z - p.z) / 300;
      b.aimErr = (0.07 + (1 - b.skill) * 0.1) * BotBrain.tune.err;
      const dist = Math.hypot(best.x - p.x, best.z - p.z);
      const slot = bestWeaponFor(p, dist); if (slot !== p.cur) it.slot = slot + 1;
      return;
    }
  }
  if (b.target >= 0) return;
  if (inGulag) {
    // no one seen: take the flag in overtime or advance
    const f = sim.fightOf(p.id);
    b.goal = 'idle';
    if (!f) return;
    const other = sim.players[f.a === p.id ? f.b : f.a];
    if (f.overtime) { const c = gulagArena(f.arena); b.tx = c.x; b.tz = c.z; }
    else if (other) { b.tx = other.x; b.tz = other.z; }
    return;
  }
  if (sim.inWarmup) { if (b.goal !== 'idle' || Math.hypot(b.tx - p.x, b.tz - p.z) < 4) { b.goal = 'idle'; b.wanderA += sim.rng.range(-1, 1); b.tx = clamp(p.x + Math.cos(b.wanderA) * 80, 100, 3140); b.tz = clamp(p.z + Math.sin(b.wanderA) * 80, 100, 3000); } return; }
  // ---------------- goals
  if (b.goal !== 'loot') b.itemId = -1; // a stale loot target would block looting forever
  // revive a downed squadmate
  const downed = sim.players.find((q) => q.squad === p.squad && q.phase === Phase.Downed && Math.hypot(q.x - p.x, q.z - p.z) < 120);
  if (downed) { b.goal = 'revive'; (b as any).reviveId = downed.id; return; }
  if (b.goal === 'revive') b.goal = 'idle';
  // gas
  const c = sim.circle;
  const toNext = Math.hypot(p.x - c.nx, p.z - c.nz), toCur = Math.hypot(p.x - c.cx, p.z - c.cz);
  const urgent = toCur > c.r - 20 || (toNext > c.nr * 0.85 && (c.closing || c.t < 60 + toNext / 7));
  if (urgent) {
    b.goal = 'rotate';
    const a = Math.atan2(p.z - c.nz, p.x - c.nx);
    const rr = c.nr * (0.3 + (b.id % 5) * 0.1);
    b.tx = c.nx + Math.cos(a) * rr; b.tz = c.nz + Math.sin(a) * rr;
    if (Math.hypot(b.tx - p.x, b.tz - p.z) > 450) {
      const bi = sim.world.balloons.findIndex((q) => Math.hypot(q.x - p.x, q.z - p.z) < 60);
      if (bi >= 0) { const q = sim.world.balloons[bi]; if (Math.hypot(q.x - p.x, q.z - p.z) < 3) { sim.launch(p); b.dropX = b.tx; b.dropZ = b.tz; } else { b.tx = q.x; b.tz = q.z; } return; }
    }
    if (Math.hypot(b.tx - p.x, b.tz - p.z) > 350) {
      // grab a free ground vehicle close by
      const v = sim.vehicles.find((q) => q.alive && q.type !== 'heli' && q.seats[0] < 0 && Math.hypot(q.x - p.x, q.z - p.z) < 45);
      if (v) { if (Math.hypot(v.x - p.x, v.z - p.z) < VEHICLES[v.type].len / 2 + 2.2) enterVehicle(sim, p, v); else { b.tx2 = b.tx; b.tz2 = b.tz; b.tx = v.x; b.tz = v.z; } }
    }
    return;
  }
  // shop for buybacks / loadouts
  const deadMate = sim.players.some((q) => q.squad === p.squad && q.id !== p.id && q.phase === Phase.Dead);
  if ((deadMate && p.cash >= PRICES.buyback) || (p.cash >= PRICES.loadout && !p.loadoutUsed)) {
    let st = null, bd = 600;
    for (const s of sim.buyStations) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd && Math.hypot(s.x - c.nx, s.z - c.nz) < c.r) { bd = d; st = s; } }
    if (st) { b.goal = 'buy'; b.buyId = st.id; b.tx = st.x; b.tz = st.z; return; }
  }
  // contracts (2020): squads without a human take nearby contracts and work them
  if (armed && workContract(sim, b, p)) return;
  // tactics by play style
  if (armed && tactics(sim, b, p)) return;
  // loot: nearest useful item nearby
  // unarmed: go a long way for a gun or a supply box before anything else
  if (!armed && b.itemId < 0) {
    // a supply box we're already heading for
    const cur = b.chestId >= 0 ? sim.chests.find((c2) => c2.id === b.chestId && !c2.opened) : undefined;
    if (cur) {
      const d = Math.hypot(cur.x - p.x, cur.z - p.z);
      b.chestT += 0.1;
      if (d < 2.6 || (b.chestT > 6 && d < 22)) { cur.opened = true; for (const i2 of chestContentsLazy(sim, cur)) sim.addItem(i2); b.chestId = -1; }
      else if (b.chestT > 14) { b.failed.set(-cur.id, sim.time + 120); b.chestId = -1; }
      else { b.tx = cur.x; b.tz = cur.z; b.goal = 'loot'; return; }
    } else b.chestId = -1;
    if (sim.time >= b.gunScanAt) {
      b.gunScanAt = sim.time + 1 + sim.rng.next();
      let best: any = null, bd = 130;
      for (const itm of sim.itemsNear(p.x, p.z, 130)) { if (itm.kind !== ItemKind.Weapon || WEAPON[itm.weapon!].cls === 'pistol' || (b.failed.get(itm.id) ?? 0) > sim.time) continue; const d = Math.hypot(itm.x - p.x, itm.z - p.z); if (d < bd) { bd = d; best = itm; } }
      if (best) { b.itemId = best.id; b.itemT = 0; b.tx = best.x; b.tz = best.z; b.goal = 'loot'; return; }
      let ch: any = null; bd = 160;
      for (const c2 of sim.chests) { if (c2.opened || Math.abs(c2.x - p.x) > bd || Math.abs(c2.z - p.z) > bd || (b.failed.get(-c2.id) ?? 0) > sim.time) continue; const d = Math.hypot(c2.x - p.x, c2.z - p.z); if (d < bd) { bd = d; ch = c2; } }
      if (ch) { b.chestId = ch.id; b.chestT = 0; b.tx = ch.x; b.tz = ch.z; b.goal = 'loot'; return; }
    }
  }
  const needy = !armed || p.plates < 2 || p.armor < 100;
  if (b.itemId < 0 && sim.time >= b.lootScanAt && (needy || sim.rng.chance(0.5))) {
    b.lootScanAt = sim.time + 0.8 + sim.rng.next() * 0.6;
    const R = needy ? 70 : 45;
    let best = null, bd = R;
    for (const itm of sim.itemsNear(p.x, p.z, R)) {
      if (!useful(p, itm.kind, itm)) continue;
      if ((b.failed.get(itm.id) ?? 0) > sim.time) continue;
      const d = Math.hypot(itm.x - p.x, itm.z - p.z) + Math.abs(itm.y - p.y) * 2 - (!armed && itm.kind === ItemKind.Weapon ? 30 : 0) - (itm.kind === ItemKind.Plate && p.plates < 2 ? 10 : 0);
      if (d < bd) { bd = d; best = itm; }
    }
    // open supply boxes too
    for (const ch of sim.chests) if (!ch.opened && Math.abs(ch.x - p.x) < 30 && Math.abs(ch.z - p.z) < 30) { const d = Math.hypot(ch.x - p.x, ch.z - p.z); if (d < 2.5) { ch.opened = true; for (const i2 of chestContentsLazy(sim, ch)) sim.addItem(i2); } else if (d < bd) { bd = d; best = null; b.tx = ch.x; b.tz = ch.z; b.goal = 'loot'; } }
    if (best) { b.itemId = best.id; b.itemT = 0; b.tx = best.x; b.tz = best.z; b.goal = 'loot'; return; }
  }
  if (b.goal === 'loot' && b.itemId >= 0) return;
  // follow the squad leader loosely, else wander toward the next circle through POIs
  const hl = humanLeader(sim, p), ping = hl ? (hl as any).ping as { x: number; z: number } | undefined : undefined;
  if (ping && Math.hypot(ping.x - p.x, ping.z - p.z) > 12) { b.goal = 'follow'; const a0 = (p.id % 3) * 2.1; b.tx = ping.x + Math.cos(a0) * 5; b.tz = ping.z + Math.sin(a0) * 5; return; }
  const leader = sim.players.filter((q) => q.squad === p.squad && q.alive && q.phase === Phase.Alive && q.id !== p.id).sort((a2, b2) => a2.id - b2.id)[0];
  if (leader && leader.id < p.id && Math.hypot(leader.x - p.x, leader.z - p.z) > 35) { b.goal = 'follow'; b.tx = leader.x + Math.cos(b.wanderA) * 6; b.tz = leader.z + Math.sin(b.wanderA) * 6; return; }
  if (b.goal !== 'idle' && Math.hypot(b.tx - p.x, b.tz - p.z) > 4) return;
  b.goal = 'idle';
  b.wanderA += sim.rng.range(-0.8, 0.8);
  const towardNext = Math.atan2(c.nz - p.z, c.nx - p.x);
  const a = toNext > c.nr * 0.5 ? towardNext + sim.rng.range(-0.7, 0.7) : b.wanderA;
  const step = 60 + sim.rng.next() * 80;
  b.tx = clamp(p.x + Math.cos(a) * step, 100, 3140); b.tz = clamp(p.z + Math.sin(a) * step, 100, 3000);
}

/** Take a contract (tablet within reach, style-dependent) or work the squad's active one. Returns true when it set a goal. */
function workContract(sim: Sim, b: BotBrain, p: Player): boolean {
  const ac = sim.active.find((a) => a.squad === p.squad);
  const humanSquad = sim.players.some((q) => q.squad === p.squad && !q.bot);
  if (!ac) {
    if (humanSquad) return false;
    // heading for a tablet?
    if (b.tabletId >= 0) {
      const t = sim.contracts.find((c) => c.id === b.tabletId && !c.taken);
      if (!t) b.tabletId = -1;
      else {
        if (Math.hypot(t.x - p.x, t.z - p.z) < 2.2) { sim.botAcceptContract(p, t.id); b.tabletId = -1; return false; }
        b.goal = 'loot'; b.tx = t.x; b.tz = t.z; return true;
      }
    }
    if (sim.time < b.contractScanAt) return false;
    b.contractScanAt = sim.time + 4 + sim.rng.next() * 4;
    const want = { contractor: 0.9, aggressive: 0.45, looter: 0.4, camper: 0.25 }[b.style];
    if (!sim.rng.chance(want)) return false;
    const c = sim.circle, reach = b.style === 'contractor' ? 320 : 180;
    let best = null as null | (typeof sim.contracts)[number], bd = reach;
    for (const t of sim.contracts) {
      if (t.taken || Math.hypot(t.x - c.cx, t.z - c.cz) > c.r * 0.85) continue;
      // style preference: aggressive -> bounty, looter -> scavenger / supply, camper -> recon
      const pref = (b.style === 'aggressive' && t.kind === 'bounty') || (b.style === 'looter' && (t.kind === 'scavenger' || t.kind === 'supply')) || (b.style === 'camper' && t.kind === 'recon') ? 60 : 0;
      const d = Math.hypot(t.x - p.x, t.z - p.z) - pref; if (d < bd) { bd = d; best = t; }
    }
    if (best) { b.tabletId = best.id; b.goal = 'loot'; b.tx = best.x; b.tz = best.z; return true; }
    return false;
  }
  // working the active contract
  if (ac.kind === 'scavenger') {
    const ch = sim.chests.find((q) => q.id === ac.chest && !q.opened); if (!ch) return false;
    if (Math.hypot(ch.x - p.x, ch.z - p.z) < 2.6) { sim.openChest(ch, p); return false; }
    b.goal = 'loot'; b.tx = ch.x; b.tz = ch.z; return true;
  }
  if (ac.kind === 'recon' || ac.kind === 'supply') {
    const d = Math.hypot(ac.zx! - p.x, ac.zz! - p.z);
    if (ac.kind === 'recon' && d < 5) { b.goal = 'idle'; b.tx = ac.zx! + Math.cos(b.wanderA) * 2; b.tz = ac.zz! + Math.sin(b.wanderA) * 2; p.intent.crouch = p.stance === Stance.Stand && sim.rng.chance(0.02); return true; }
    b.goal = 'rotate'; b.tx = ac.zx!; b.tz = ac.zz!; return true;
  }
  if (ac.kind === 'bounty') {
    const t = sim.players[ac.target!]; if (!t?.alive) return false;
    // hunt the rough area (the circle on their map), the fight code takes over once the target is seen
    if (b.target < 0) { b.goal = 'rotate'; b.tx = t.x + Math.cos(b.wanderA) * 25; b.tz = t.z + Math.sin(b.wanderA) * 25; return true; }
    return false;
  }
  if (ac.kind === 'mostwanted') {
    // everyone can see us: dig in where we are and survive the timer
    if (b.holdUntil < sim.time) { b.holdUntil = sim.time + 999; b.holdX = p.x; b.holdZ = p.z; }
    b.goal = 'idle'; b.tx = b.holdX; b.tz = b.holdZ; return true;
  }
  return false;
}

/** Style tactics when there is nothing more pressing: aggressive bots push toward gunfire, campers hold a building a while. */
function tactics(sim: Sim, b: BotBrain, p: Player): boolean {
  if (b.style === 'aggressive' && b.target < 0) {
    let best = null as Player | null, bd = 260;
    for (const q of sim.players) {
      if (q.squad === p.squad || !q.alive || sim.time - ((q as any).lastLoudShot ?? -99) > 4) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; }
    }
    if (best && bd > 25) { b.goal = 'rotate'; b.tx = best.x + Math.cos(b.wanderA) * 15; b.tz = best.z + Math.sin(b.wanderA) * 15; return true; }
  }
  if (b.style === 'camper') {
    if (b.holdUntil > sim.time) { if (Math.hypot(b.holdX - p.x, b.holdZ - p.z) > 3) { b.goal = 'idle'; b.tx = b.holdX; b.tz = b.holdZ; } else { b.goal = 'idle'; b.tx = p.x; b.tz = p.z; } return true; }
    if (b.holdUntil < sim.time - 30 && sim.rng.chance(0.02)) {
      // pick a building close by, inside the circle, and hold it for a minute
      const c = sim.circle;
      const near = sim.world.col.near(p.x, p.z, 60, []).filter((s) => (s.kind === 'house' || s.kind === 'block' || s.kind === 'tenement' || s.kind === 'shop') && Math.hypot(s.x - c.nx, s.z - c.nz) < c.nr * 0.9);
      if (near.length) { const s = near[Math.floor(sim.rng.next() * near.length)]; b.holdX = s.x; b.holdZ = s.z; b.holdUntil = sim.time + 45 + sim.rng.next() * 40; return true; }
    }
  }
  return false;
}

function useful(p: Player, kind: ItemKind, itm: any): boolean {
  switch (kind) {
    case ItemKind.Weapon: {
      if (p.weapons.some((w) => !w)) return true;
      return p.weapons.some((w) => w && (itm.rarity > w.rarity + 0 || WEAPON[w.id].cls === 'pistol'));
    }
    case ItemKind.Ammo: return p.weapons.some((w) => w && WEAPON[w.id].ammo === itm.ammo && p.ammo[itm.ammo as keyof typeof p.ammo] < 120);
    case ItemKind.Plate: return p.plates < p.maxPlates;
    case ItemKind.Cash: return true;
    case ItemKind.Lethal: return !p.lethal;
    case ItemKind.Tactical: return !p.tactical;
    case ItemKind.Killstreak: return !p.killstreak;
    case ItemKind.SelfRevive: return !p.selfRevive;
    case ItemKind.GasMask: return !p.hasMask;
    case ItemKind.Satchel: return p.maxPlates < 8;
  }
}
import { chestContents } from './loot';
const chestContentsLazy = (sim: Sim, ch: { x: number; y: number; z: number; legendary: boolean }) => chestContents(sim, ch.x, ch.y, ch.z, ch.legendary);
void hitBuf;

/** The human in this bot's squad, if any (bots follow their jump and pings). */
function humanLeader(sim: Sim, p: Player): Player | null {
  for (const q of sim.players) if (q.squad === p.squad && !q.bot && q.id !== p.id && q.alive) return q;
  return null;
}

function botDrive(sim: Sim, b: BotBrain, p: Player, v: import('./vehicles').Vehicle, dt: number, think: boolean) {
  const it = p.intent;
  it.fire = false; it.ads = false; (it as any).up = false;
  if (p.id !== v.seats[0]) { it.mz = 0; it.mx = 0; return; } // passengers just ride (and shoot via combat if targets)
  const c = sim.circle;
  if (think && (b.tx2 || b.tz2)) { b.tx = b.tx2; b.tz = b.tz2; b.tx2 = b.tz2 = 0; }
  const dx = b.tx - v.x, dz = b.tz - v.z, dist = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz), err = wrapAngle(want - v.yaw);
  it.mx = clamp(-err * 1.8, -1, 1);
  it.mz = Math.abs(err) > 1.4 ? 0.4 : 1;
  // stuck: reverse a moment
  if (v.speed < 1.5) b.driveStuck += dt; else b.driveStuck = Math.max(0, b.driveStuck - dt);
  if (b.driveStuck > 1.5) { it.mz = -1; it.mx = -it.mx; if (b.driveStuck > 3) b.driveStuck = 0; }
  // bail out near the destination, when shot at, or when the car is burning
  const hurt = sim.time - p.lastDamaged < 0.5 && dist < 250;
  if (dist < 60 || hurt || v.health < VEHICLES[v.type].health * 0.25 || (think && sim.rng.chance(0.002))) { exitVehicle(sim, p); b.goal = 'idle'; }
  void c;
}
