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

type Goal = 'drop' | 'loot' | 'rotate' | 'fight' | 'revive' | 'buy' | 'idle' | 'follow';

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
  constructor(public id: number, r: number) { this.skill = 0.35 + r * 0.55; this.wanderA = r * 6.28; }
}

const hitBuf: RayHit = { t: 0, nx: 0, ny: 0, nz: 0, structure: -1, part: -1, mat: Mat.Rock, terrain: false, water: false };
const claims = new Map<string, number>();

function chooseDrop(sim: Sim, b: BotBrain, p: Player) {
  // squadmates share the leader's choice
  const leader = sim.brains[p.squad * 3];
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
  // jump when the plane's along-track position passes the target minus a glide lead
  const rx = b.dropX - pl.sx, rz = b.dropZ - pl.sz; const along = rx * pl.dx + rz * pl.dz; const off = Math.abs(rx * pl.dz - rz * pl.dx);
  const lead = Math.max(0, Math.min(off * 0.3, 350));
  b.jumpAt = Math.max(4, (along - lead) / 62 + sim.rng.range(-3, 3));
}

function moveToward(sim: Sim, b: BotBrain, p: Player, x: number, z: number, run: boolean, dt: number) {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  const it = p.intent;
  if (d < 1.2) { it.mz = 0; it.mx = 0; it.sprint = false; return true; }
  let a = Math.atan2(-dx, -dz); // yaw facing target
  // stuck handling: detour sideways for a moment
  if (b.detourT > 0) { b.detourT -= dt; a += b.detourA; }
  else {
    const moved = Math.hypot(p.x - b.lastX, p.z - b.lastZ);
    b.lastX = p.x; b.lastZ = p.z;
    if (moved < 0.02 && p.onGround) b.stuckT += dt; else b.stuckT = Math.max(0, b.stuckT - dt);
    if (b.stuckT > 0.8) { b.stuckT = 0; b.detourT = 0.9 + sim.rng.next(); b.detourA = (sim.rng.chance(0.5) ? 1 : -1) * (0.9 + sim.rng.next() * 0.8); it.jump = true; }
  }
  it.yaw = lerpYaw(it.yaw, a, Math.min(1, dt * 8));
  it.mz = 1; it.mx = 0;
  it.sprint = run && d > 6;
  if (it.sprint && sim.rng.chance(0.004)) (it as any).tac = true;
  return false;
}
const lerpYaw = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

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
    if (dist < 15) s += d.cls === 'shotgun' || d.cls === 'smg' ? 3 : d.cls === 'ar' ? 2 : d.cls === 'lmg' ? 1.5 : d.cls === 'pistol' ? 1 : 0.5;
    else if (dist < 60) s += d.cls === 'ar' ? 3 : d.cls === 'lmg' ? 2.6 : d.cls === 'smg' ? 2 : d.cls === 'marksman' ? 1.5 : 1;
    else s += d.cls === 'sniper' || d.cls === 'marksman' ? 3 : d.cls === 'ar' || d.cls === 'lmg' ? 2.4 : 0.8;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}

export function botThink(sim: Sim, b: BotBrain, p: Player, dt: number, think: boolean) {
  const it = p.intent;
  it.fire = false; it.jump = it.jump && false; it.interact = false; it.plate = false; it.reload = false;
  switch (p.phase) {
    case Phase.Plane: {
      if (!b.dropX) chooseDrop(sim, b, p);
      if (sim.plane.canJump && sim.plane.t >= b.jumpAt) it.jump = true;
      return;
    }
    case Phase.Freefall: case Phase.Chute: {
      if (!b.dropX) { b.dropX = p.x + sim.rng.range(-200, 200); b.dropZ = p.z + sim.rng.range(-200, 200); }
      const dx = b.dropX - p.x, dz = b.dropZ - p.z, d = Math.hypot(dx, dz);
      it.yaw = lerpYaw(it.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 3));
      const agl = p.y - sim.world.hf.at(p.x, p.z);
      // glide ratio: dive when the target is under us
      it.pitch = d < agl * 0.5 ? -1.2 : -0.1;
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
    b.aimErr = Math.max(0.004 + (1 - b.skill) * 0.012, b.aimErr - dt * (0.25 + b.skill * 0.5));
    const errYaw = Math.sin(sim.time * 3.1 + b.id) * b.aimErr * (1 + dist / 120), errPitch = Math.cos(sim.time * 2.3 + b.id * 1.7) * b.aimErr * 0.7 * (1 + dist / 120);
    const turn = Math.min(1, dt * (6 + b.skill * 10));
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
        if (d < 2.4 || (b.itemT > 7 && d < 14)) {
          // looting abstraction: bots can't path through every doorway, so after trying for a while they "find the way"
          if (itm.kind === ItemKind.Weapon || itm.kind === ItemKind.Lethal || itm.kind === ItemKind.Tactical || itm.kind === ItemKind.Killstreak || itm.kind === ItemKind.SelfRevive || itm.kind === ItemKind.GasMask || itm.kind === ItemKind.Satchel) wantPickup(sim, p, itm.id);
          else simTake(sim, p, itm.id);
          b.itemId = -1;
        } else if (b.itemT > 14) b.itemId = -1;
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
  if (b.target < 0) {
    const range = inGulag ? 60 : 160 + b.skill * 120;
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
      if (d > 90 && !sim.rng.chance(0.35 + b.skill * 0.3)) continue;
      const score = d * (q.phase === Phase.Downed ? 1.6 : 1) * (q.lastShot > sim.time - 2 ? 0.7 : 1);
      if (score < bd && checks++ < 4 && canSee(sim, p, q)) { bd = score; best = q; }
    }
    if (best) {
      b.target = best.id; b.seenAt = sim.time; b.engageStart = sim.time; b.lastSeenX = best.x; b.lastSeenZ = best.z;
      b.reactAt = sim.time + 0.22 + (1 - b.skill) * 0.45 + Math.hypot(best.x - p.x, best.z - p.z) / 600;
      b.aimErr = 0.05 + (1 - b.skill) * 0.08;
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
  // ---------------- goals
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
    return;
  }
  // shop for buybacks / loadouts
  const deadMate = sim.players.some((q) => q.squad === p.squad && q.id !== p.id && q.phase === Phase.Dead);
  if ((deadMate && p.cash >= PRICES.buyback) || (p.cash >= PRICES.loadout && !p.loadoutUsed)) {
    let st = null, bd = 600;
    for (const s of sim.buyStations) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd && Math.hypot(s.x - c.nx, s.z - c.nz) < c.r) { bd = d; st = s; } }
    if (st) { b.goal = 'buy'; b.buyId = st.id; b.tx = st.x; b.tz = st.z; return; }
  }
  // loot: nearest useful item nearby
  if (b.itemId < 0 && sim.rng.chance(0.5)) {
    let best = null, bd = 45;
    for (const itm of sim.itemsNear(p.x, p.z, 45)) {
      if (!useful(p, itm.kind, itm)) continue;
      const d = Math.hypot(itm.x - p.x, itm.z - p.z) + Math.abs(itm.y - p.y) * 2;
      if (d < bd) { bd = d; best = itm; }
    }
    // open supply boxes too
    for (const ch of sim.chests) if (!ch.opened && Math.abs(ch.x - p.x) < 30 && Math.abs(ch.z - p.z) < 30) { const d = Math.hypot(ch.x - p.x, ch.z - p.z); if (d < 2.5) { ch.opened = true; for (const i2 of chestContentsLazy(sim, ch)) sim.addItem(i2); } else if (d < bd) { bd = d; best = null; b.tx = ch.x; b.tz = ch.z; b.goal = 'loot'; } }
    if (best) { b.itemId = best.id; b.itemT = 0; b.tx = best.x; b.tz = best.z; b.goal = 'loot'; return; }
  }
  if (b.goal === 'loot' && b.itemId >= 0) return;
  // follow the squad leader loosely, else wander toward the next circle through POIs
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
