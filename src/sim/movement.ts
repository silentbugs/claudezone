/** Player locomotion for every phase: C-130, freefall, parachute, ground, downed, swimming. */
import { MOVE, DEPLOY } from './config';
import { Phase, Player, Stance } from './types';
import type { Sim } from './sim';
import { WEAPON } from '../data/weapons';
import { clamp } from '../core/math';

const push = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

export function playerHeight(p: Player): number {
  if (p.phase === Phase.Downed) return MOVE.proneH;
  return p.stance === Stance.Prone ? MOVE.proneH : p.stance === Stance.Crouch ? MOVE.crouchH : MOVE.height;
}
export function eyeHeight(p: Player): number {
  if (p.phase === Phase.Downed) return 0.45;
  return p.stance === Stance.Prone ? 0.42 : p.stance === Stance.Crouch ? 1.12 : 1.62;
}

export function movePlayer(sim: Sim, p: Player, dt: number) {
  const it = p.intent;
  p.yaw = it.yaw; p.pitch = clamp(it.pitch, -1.5, 1.5);
  switch (p.phase) {
    case Phase.Plane: {
      const pl = sim.plane;
      p.x = pl.x; p.y = pl.y - 3; p.z = pl.z; p.vx = pl.dx * DEPLOY.planeSpeed; p.vz = pl.dz * DEPLOY.planeSpeed; p.vy = 0;
      if ((it.jump && sim.plane.canJump) || pl.t >= pl.dur - 0.5) {
        p.phase = Phase.Freefall; p.vx *= 0.4; p.vz *= 0.4;
        sim.emit({ t: 'jump', p: p.id });
      }
      return;
    }
    case Phase.Freefall: return air(sim, p, dt, false);
    case Phase.Chute: return air(sim, p, dt, true);
    case Phase.Dead: case Phase.Spectate: return;
  }
  ground(sim, p, dt);
}

function air(sim: Sim, p: Player, dt: number, chute: boolean) {
  const it = p.intent, col = sim.world.col;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  const g = col.groundAt(p.x, p.z, p.y + 0.5);
  const agl = p.y - g;
  if (!chute) {
    // looking down dives: faster fall, less glide
    const dive = clamp(-p.pitch / 1.2, 0, 1);
    const hs = DEPLOY.freefallH * (1 - dive * 0.35) * Math.max(0.25, it.mz * 0.8 + 0.2 + Math.abs(it.mx) * 0.4);
    const tx = (fx * Math.max(0, it.mz) + rx * it.mx) * hs, tz = (fz * Math.max(0, it.mz) + rz * it.mx) * hs;
    p.vx += (tx - p.vx) * Math.min(1, dt * 1.6); p.vz += (tz - p.vz) * Math.min(1, dt * 1.6);
    const tv = -(DEPLOY.freefallFall + dive * (DEPLOY.diveFall - DEPLOY.freefallFall));
    if ((p as any).launchT > 0) { (p as any).launchT -= dt; p.vy -= 20 * dt; } // balloon launch: ballistic climb first
    else p.vy += (tv - p.vy) * Math.min(1, dt * 1.2);
    if (((it.jump && agl > DEPLOY.minChuteAGL) || (agl < DEPLOY.autoChuteAGL && (p as any).prefs?.autoChute !== false) || agl < 8) && !((p as any).launchT > 0)) { p.phase = Phase.Chute; p.vy = Math.max(p.vy, -18); sim.emit({ t: 'chute', p: p.id }); p.intent.jump = false; }
  } else {
    const fwd = clamp(it.mz, -0.5, 1);
    const hs = DEPLOY.chuteH * (0.55 + 0.45 * Math.max(0, fwd));
    const tx = fx * hs * (fwd >= 0 ? 1 : 0.3) + rx * it.mx * 6, tz = fz * hs * (fwd >= 0 ? 1 : 0.3) + rz * it.mx * 6;
    p.vx += (tx - p.vx) * Math.min(1, dt * 1.2); p.vz += (tz - p.vz) * Math.min(1, dt * 1.2);
    const tv = -(DEPLOY.chuteFall + Math.max(0, fwd) * 2.5);
    p.vy += (tv - p.vy) * Math.min(1, dt * 2.2);
    // cut the chute (unlimited redeploy in 2020 Warzone)
    if (it.jump && agl > 25) { p.phase = Phase.Freefall; sim.emit({ t: 'chute', p: p.id }); p.intent.jump = false; }
  }
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  clampToWorld(sim, p);
  // hit something on the way down
  col.pushOut(p.x, p.y, p.z, MOVE.height, MOVE.radius, MOVE.step, push);
  p.x = push.x; p.z = push.z;
  const g2 = col.groundAt(p.x, p.z, p.y + 0.6);
  const w = col.waterAt(p.x, p.z);
  if (p.y <= Math.max(g2, w - 1.0)) {
    p.y = Math.max(g2, w - 1.0);
    const hard = !chute && p.vy < -25;
    p.phase = Phase.Alive; p.onGround = true; p.vy = 0; p.vx *= 0.3; p.vz *= 0.3; p.fallStartY = p.y;
    if (sim.train?.carUnder(p.x, p.y, p.z)) { p.vx = 0; p.vz = 0; } // landed on the train: the car carries us from here
    sim.emit({ t: 'land', p: p.id, hard });
    if (hard) sim.damage(p, 999, -1, 'fall', false, true);
  }
}

function clampToWorld(sim: Sim, p: Player) {
  const s = sim.world.hf.size;
  p.x = clamp(p.x, 5, s - 5); p.z = clamp(p.z, 5, s - 5);
}

function ground(sim: Sim, p: Player, dt: number) {
  const it = p.intent, col = sim.world.col;
  const downed = p.phase === Phase.Downed;
  const def = p.weapons[p.cur] ? WEAPON[p.weapons[p.cur]!.id] : null;
  // --- ladders
  if (downed) { (p as any).ladder = -1; (p as any).asc = -1; }
  else if (ascend(sim, p, dt)) return;
  else if (ladder(sim, p, dt)) return;
  // --- mantle in progress
  if (p.mantleT > 0) {
    p.mantleT -= dt;
    // two phases so the body never cuts through the edge: pull up (small forward creep), then over
    const M = p as any, T = M.mantleDur ?? 0.3, u = Math.min(1, 1 - Math.max(0, p.mantleT) / T);
    const up = Math.min(1, u / 0.55), over = Math.max(0, (u - 0.45) / 0.55);
    const eu = 1 - (1 - up) * (1 - up), eo = over * over * (3 - 2 * over);
    const fwd = 0.12 * up + 0.88 * eo;
    p.y = M.mantleY0 + (p.mantleY - M.mantleY0) * eu;
    p.x = M.mantleX0 + (M.mantleX1 - M.mantleX0) * fwd; p.z = M.mantleZ0 + (M.mantleZ1 - M.mantleZ0) * fwd;
    if (p.mantleT <= 0) {
      p.y = p.mantleY; p.fallStartY = p.y;
      if ((p as any).vaulting) { p.vx *= 0.45; p.vz *= 0.45; p.onGround = false; (p as any).vaulting = false; }
      else { p.vx *= 0.3; p.vz *= 0.3; p.onGround = true; }
      if (p.stance === Stance.Stand && !sim.world.col.fits(p.x, p.y, p.z, MOVE.height, MOVE.radius * 0.9)) p.stance = Stance.Crouch;
    }
    return;
  }
  // --- stance
  if (!downed) {
    if (it.crouch) {
      it.crouch = false;
      if (p.slideT > 0) {
        // slide cancel: pop back up and keep running (the 2020 slide-cancel)
        p.slideT = 0; p.stance = tryStand(sim, p); p.slideCd = 0.35;
        if (p.stance === Stance.Stand && it.sprint) p.sprinting = true;
      } else if (p.sprinting && p.onGround && p.slideCd <= 0 && p.stance === Stance.Stand && Math.hypot(p.vx, p.vz) > MOVE.walk * 0.9) {
        // slide: carry sprint momentum with a boost (tactical sprint slides further)
        const cur = Math.hypot(p.vx, p.vz) || 1;
        const sp = Math.max(MOVE.slideSpeed * (p.tacSprint > 0 ? 1.12 : 1), cur * 1.2);
        p.slideDx = (p.vx / cur) * sp; p.slideDz = (p.vz / cur) * sp;
        p.slideT = MOVE.slideTime; p.slideCd = MOVE.slideCooldown; p.stance = Stance.Crouch;
        p.sprinting = false; p.tacSprint = 0; p.stanceT = 0;
        sim.emit({ t: 'slide', p: p.id });
      } else { const ns = p.stance === Stance.Crouch ? tryStand(sim, p) : Stance.Crouch; if (ns !== p.stance) { p.stanceT = p.stance === Stance.Prone ? 0.4 : 0.12; p.stance = ns; } }
    }
    if (it.prone) {
      it.prone = false;
      const ns = p.stance === Stance.Prone ? tryStand(sim, p) : Stance.Prone;
      if (ns !== p.stance) { p.stanceT = 0.45; p.stance = ns; p.slideT = 0; p.sprinting = false; }
    }
  }
  if ((it as any).crouchHoldMode && !(it as any).crouchHeld && p.stance === Stance.Crouch && p.slideT <= 0 && !downed) { const ns = tryStand(sim, p); if (ns !== p.stance) { p.stance = ns; p.stanceT = 0.12; } }
  if (p.slideCd > 0) p.slideCd -= dt;
  if (p.stanceT > 0) p.stanceT -= dt;
  // --- water
  const wl = col.waterAt(p.x, p.z);
  p.swimming = !downed && wl > p.y + 1.25;
  // --- target speed
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let mx = it.mx, mz = it.mz; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const mob = def?.mobility ?? 1;
  const wantSprint = p.slideT <= 0 && it.sprint && !it.ads && mz > 0.3 && !downed && p.stance !== Stance.Prone && p.plateT <= 0 && !p.swimming && p.reloadT <= 0;
  if (wantSprint && !p.sprinting) { p.sprinting = true; if (p.stance === Stance.Crouch) p.stance = tryStand(sim, p); }
  if (!wantSprint) { if (p.sprinting) p.sprintOut = p.tacSprint > 0 ? (def?.tacSprintOut ?? 0.375) : (def?.sprintOut ?? 0.25); p.sprinting = false; p.tacSprint = 0; }
  if (p.sprintOut > 0) p.sprintOut -= dt;
  // tac sprint: second sprint press while sprinting (flagged by the input layer as sprint pulses)
  if (p.sprinting && (it as any).tac && p.tacCooldown <= 0 && p.tacSprint <= 0) { p.tacSprint = MOVE.tacSprintTime; (it as any).tac = false; }
  if (p.tacSprint > 0) { p.tacSprint -= dt; if (p.tacSprint <= 0) p.tacCooldown = MOVE.tacSprintCooldown; }
  else if (p.tacCooldown > 0) p.tacCooldown -= dt * (p.sprinting ? 0.5 : 1);
  // speeds from the held weapon (walk per class, sprint x1.31, tac sprint x1.57, crouch 60%, prone 15%)
  const walk = def?.walk ?? MOVE.walk * mob, adsWalk = def?.adsWalk ?? MOVE.ads * mob;
  let speed = downed ? MOVE.downed : p.swimming ? MOVE.swim : p.stance === Stance.Prone ? walk * MOVE.proneMul : p.stance === Stance.Crouch ? walk * MOVE.crouchMul : p.sprinting ? walk * (p.tacSprint > 0 ? MOVE.tacSprintMul : MOVE.sprintMul) : walk;
  const aiming = !downed && p.ads > 0.5;
  if (aiming && p.stance === Stance.Stand) speed = Math.min(speed, adsWalk);
  else if (aiming) speed *= adsWalk / walk;
  if (p.plateT > 0) speed *= 0.7;
  if (p.stunT > 0) speed *= 0.45;
  if (p.stanceT > 0) speed *= 0.35; // getting up / going prone
  if (!p.sprinting) { // strafing / backpedalling are slower (datamined multipliers)
    if (mz < 0) mz *= aiming ? MOVE.backAdsMul : MOVE.backMul;
    mx *= aiming ? MOVE.strafeAdsMul : MOVE.strafeMul;
  }
  let tx = (fx * mz + rx * mx) * speed, tz = (fz * mz + rz * mx) * speed;
  if (p.slideT > 0) {
    p.slideT -= dt;
    // friction, plus gravity along the slope (downhill slides carry)
    const n = col.terrain.normal(p.x, p.z);
    const fr = Math.exp(-dt * 1.1);
    p.slideDx = p.slideDx * fr + n[0] * 9 * dt; p.slideDz = p.slideDz * fr + n[2] * 9 * dt;
    // a little steering from strafe input
    const sp0 = Math.hypot(p.slideDx, p.slideDz);
    if (mx && sp0 > 0.1) { p.slideDx += rx * mx * sp0 * 1.1 * dt; p.slideDz += rz * mx * sp0 * 1.1 * dt; const k2 = sp0 / Math.hypot(p.slideDx, p.slideDz); p.slideDx *= k2; p.slideDz *= k2; }
    tx = p.slideDx; tz = p.slideDz;
    const ss = Math.hypot(p.slideDx, p.slideDz);
    if (ss < MOVE.crouch * 1.1 || p.slideT <= 0) p.slideT = 0;
    if ((it as any).slideHold && !(it as any).crouchHeld && p.slideT > 0 && p.slideT < MOVE.slideTime - 0.15) p.slideT = 0; // hold mode: releasing crouch ends the slide (stay crouched)
    if (it.jump) { p.slideT = 0; p.stance = tryStand(sim, p); p.vx = p.slideDx; p.vz = p.slideDz; } // slide into a jump keeps the speed
  }
  const acc = p.slideT > 0 ? 80 : p.onGround || p.swimming ? MOVE.accel : MOVE.airAccel;
  const dvx = tx - p.vx, dvz = tz - p.vz, dl = Math.hypot(dvx, dvz), step = acc * dt;
  if (dl <= step) { p.vx = tx; p.vz = tz; } else { p.vx += (dvx / dl) * step; p.vz += (dvz / dl) * step; }
  // --- jump / mantle
  const h = playerHeight(p);
  if (it.jump && !downed) {
    it.jump = false;
    (p as any).jumpBuf = sim.time + 0.45; // a jump toward a ledge mantles when you reach it
    if (p.swimming) { p.vy = 3; }
    else if (p.onGround) {
      if (p.stance !== Stance.Stand) { p.stance = tryStand(sim, p); }
      else if (tryMantle(sim, p)) return;
      else { p.vy = MOVE.jumpV; p.onGround = false; sim.emit({ t: 'jump', p: p.id }); }
    } else if (tryMantle(sim, p)) return;
    else {
      // pop the parachute when falling from a height (rooftops, cliffs, helicopters)
      const agl = p.y - col.groundAt(p.x, p.z, p.y, 0.3);
      if (p.vy < -4 && agl > 14) { p.phase = Phase.Chute; p.vy = Math.max(p.vy, -12); sim.emit({ t: 'chute', p: p.id }); return; }
    }
  }
  else if (!p.onGround && !p.swimming && !downed && it.mz > 0.3 && ((p as any).jumpBuf ?? 0) > sim.time && tryMantle(sim, p)) { (p as any).jumpBuf = 0; return; }
  // --- vertical
  if (p.swimming) {
    const target = wl - 1.35;
    p.vy += (Math.sign(target - p.y) * 2 - p.vy) * Math.min(1, dt * 3);
  } else if (!p.onGround) p.vy -= MOVE.gravity * dt;
  // --- integrate horizontal with collision
  const ox = p.x, oz = p.z;
  p.x += p.vx * dt; p.z += p.vz * dt;
  clampToWorld(sim, p);
  sim.doors?.pushBy(p, MOVE.radius, tx, tz);
  col.pushOut(p.x, p.y, p.z, h, MOVE.radius, MOVE.step, push);
  p.x = push.x; p.z = push.z;
  if (push.hit) {
    // remove velocity into the wall
    const vn = p.vx * push.nx + p.vz * push.nz; if (vn < 0) { p.vx -= vn * push.nx; p.vz -= vn * push.nz; }
    if (p.slideT > 0) { p.slideT = 0; }
  }
  // --- vertical integrate + ground
  p.y += p.vy * dt;
  const ceil = col.ceilingAt(p.x, p.z, p.y + 0.3, MOVE.radius * 0.7);
  if (p.y + h > ceil && p.vy > 0) { p.vy = 0; p.y = Math.min(p.y, ceil - h); }
  const gnd = col.groundAt(p.x, p.z, p.y + MOVE.step, MOVE.radius * 0.6);
  if (p.swimming) { if (p.y < gnd) p.y = gnd; p.onGround = false; p.fallStartY = p.y; }
  else if (p.y <= gnd) {
    if (!p.onGround) {
      const fall = p.fallStartY - gnd;
      if (fall > MOVE.fallSafe) {
        const dmg = ((fall - MOVE.fallSafe) / (MOVE.fallLethal - MOVE.fallSafe)) * 110;
        sim.damage(p, dmg, -1, 'fall', false, true);
      }
      if (fall > 1.2) sim.emit({ t: 'land', p: p.id, hard: fall > MOVE.fallSafe });
    }
    p.y = gnd; p.vy = 0; p.onGround = true; p.fallStartY = p.y;
  } else if (p.onGround && p.vy <= 0 && p.y - gnd < 0.7) {
    p.y = gnd; // walking down stairs/slopes
  } else {
    if (p.onGround) { p.onGround = false; p.fallStartY = p.y; }
    if (p.y > p.fallStartY) p.fallStartY = p.y;
  }
  // --- footsteps
  const moved = Math.hypot(p.x - ox, p.z - oz);
  if (p.onGround && moved > 0.001) {
    p.lastStep += moved;
    const stride = p.sprinting ? 2.0 : p.stance !== Stance.Stand ? 1.2 : 1.5;
    if (p.lastStep > stride) { p.lastStep = 0; if (p.stance === Stance.Stand) sim.emit({ t: 'step', p: p.id, x: p.x, y: p.y, z: p.z, metal: false }); }
  }
}

function tryStand(sim: Sim, p: Player): Stance {
  return sim.world.col.fits(p.x, p.y, p.z, MOVE.height, MOVE.radius * 0.9) ? Stance.Stand : p.stance === Stance.Prone ? Stance.Crouch : p.stance;
}

/**
 * Mantle / vault. Reach is measured from the floor under your feet (not from the top of a jump), so
 * spamming jump next to a wall can't chain you up a facade. Thin obstacles (window sills, low walls,
 * railings) are vaulted: you go over them and drop on the far side, through window openings too.
 * Deep surfaces (crates, containers, ledges, balconies) are climbed onto.
 */
function tryMantle(sim: Sim, p: Player): boolean {
  if (((p as any).mantleCd ?? 0) > sim.time) return false;
  const col = sim.world.col;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const foot = col.groundAt(p.x, p.z, p.y + 0.1, 0.2);
  const base = p.y - foot < 1.6 ? foot : p.y;
  const reach = base + MOVE.mantleMax;
  for (const d of [0.45, 0.65, 0.85]) {
    const x = p.x + fx * d, z = p.z + fz * d;
    const top = col.groundAt(x, z, reach + 0.05, 0.12);
    if (top <= p.y + 0.3 || top <= base + MOVE.step || top > reach) continue;
    // headroom: we rise in place first, so nothing may be overhead (stair landings, the floor above)
    if (col.ceilingAt(p.x, p.z, p.y + 0.3, MOVE.radius * 0.7) < top + 0.95) continue;
    // ...and no walkable surface (stair flight, sloped roof) between our head and the ledge
    if (col.groundAt(p.x, p.z, top - 0.1, 0.2) > p.y + 1.7) continue;
    // what is behind the obstacle's top surface?
    let drop = -1, deep = false;
    for (const e of [0.3, 0.5, 0.75]) {
      const g = col.groundAt(x + fx * e, z + fz * e, top + 0.25, 0.12);
      if (g < top - 0.4) { drop = e; break; }
      if (Math.abs(g - top) < 0.3 && e >= 0.5) { deep = true; break; }
    }
    const go = (tx: number, tz: number, y: number, t: number, vault: boolean) => {
      t = Math.min(0.9, t); p.mantleT = t; p.mantleY = y;
      const M = p as any; M.mantleDur = t; M.mantleY0 = p.y; M.mantleX0 = p.x; M.mantleZ0 = p.z; M.mantleX1 = tx; M.mantleZ1 = tz;
      p.vx = (tx - p.x) / t; p.vz = (tz - p.z) / t; p.vy = 0;
      p.onGround = false; p.slideT = 0; p.sprinting = false;
      (p as any).vaulting = vault; (p as any).mantleCd = sim.time + t + 0.35;
      sim.emit({ t: 'jump', p: p.id });
      return true;
    };
    if (drop > 0) {
      // vault: need crouched clearance over the top (window openings are ~1.35 m tall) and room on the far side
      const lx = x + fx * (drop + 0.4), lz = z + fz * (drop + 0.4);
      if (col.fits(x, top + 0.03, z, 0.85, 0.22) && col.fits(lx, top + 0.03, lz, 0.85, MOVE.radius * 0.8))
        return go(lx, lz, top + 0.03, 0.5 + (top - p.y) * 0.2, true); // vault 0.5-0.9 s
    } else if (deep) {
      const tx = p.x + fx * (d + 0.4), tz = p.z + fz * (d + 0.4);
      if (col.fits(tx, top + 0.02, tz, MOVE.crouchH, MOVE.radius * 0.9))
        return go(tx, tz, top + 0.02, 0.4 + (top - p.y) * 0.22, false); // climb 0.4-0.9 s
    }
  }
  return false;
}

const CLIMB = 3.0; // m/s up/down a ladder
/**
 * Exterior ladders: walk into one facing it to grab on; forward climbs, back descends, strafe/jump lets
 * go. At the top you pull yourself onto the roof (a short mantle); at the bottom you step off.
 */
function ladder(sim: Sim, p: Player, dt: number): boolean {
  const P = p as any, it = p.intent, L = sim.world.ladders;
  if (!L || !L.length) return false;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  if (P.ladder === undefined || P.ladder < 0) {
    // grab: close to a ladder, facing its wall, pushing forward, feet within its span
    if (it.mz < 0.5 || p.mantleT > 0 || p.stance === Stance.Prone || p.swimming) return false;
    for (const i of sim.laddersNear(p.x, p.z)) {
      const l = L[i];
      const rx = p.x - l.x, rz = p.z - l.z, out = rx * l.nx + rz * l.nz, lat = Math.abs(rx * -l.nz + rz * l.nx);
      if (out < 0 || out > 0.9 || lat > 0.5 || p.y < l.y0 - 0.4 || p.y > l.y1 - 0.6) continue;
      if (fx * -l.nx + fz * -l.nz < 0.55) continue;
      P.ladder = i; p.sprinting = false; p.tacSprint = 0; p.slideT = 0; p.stance = Stance.Stand; p.ads = 0;
      sim.emit({ t: 'jump', p: p.id });
      break;
    }
    if (P.ladder === undefined || P.ladder < 0) return false;
  }
  const l = L[P.ladder];
  // hug the ladder
  p.x += (l.x + l.nx * 0.45 - p.x) * Math.min(1, dt * 12); p.z += (l.z + l.nz * 0.45 - p.z) * Math.min(1, dt * 12);
  p.vx = p.vz = p.vy = 0; p.onGround = false; p.fallStartY = p.y; p.sprinting = false;
  const climb = it.mz > 0.3 ? 1 : it.mz < -0.3 ? -1 : 0;
  p.y += climb * CLIMB * dt;
  P.climbT = (P.climbT ?? 0) + Math.abs(climb) * dt;
  if (it.jump || Math.abs(it.mx) > 0.8) { // let go / hop off backwards
    it.jump = false; P.ladder = -1; p.vx = l.nx * 2; p.vz = l.nz * 2; return true;
  }
  if (p.y >= l.y1 - 0.15 && climb > 0) {
    // over the top onto the roof (reuse the two-phase mantle)
    P.ladder = -1;
    const k = l.hatch ? -1.25 : 0.7; // hatch: step off onto the floor beside the hole; wall: over the top onto the roof
    const tx = l.x - l.nx * k, tz = l.z - l.nz * k, t = 0.55;
    p.mantleT = t; p.mantleY = l.y1 + 0.02; P.mantleDur = t; P.mantleY0 = p.y; P.mantleX0 = p.x; P.mantleZ0 = p.z; P.mantleX1 = tx; P.mantleZ1 = tz;
    return true;
  }
  if (p.y <= l.y0 && climb < 0) { p.y = sim.world.col.groundAt(p.x, p.z, p.y + 0.5); P.ladder = -1; p.onGround = true; }
  if (p.y < l.y0) p.y = l.y0;
  return true;
}

const ASCEND = 7.0; // m/s
/** Riding an ascender: pulled up the cable; at the top (or on Jump / Use at a floor) you step out of the shaft. */
function ascend(sim: Sim, p: Player, dt: number): boolean {
  const P = p as any; if (P.asc === undefined || P.asc < 0) return false;
  const a = sim.world.ascenders[P.asc]; if (!a) { P.asc = -1; return false; }
  const it = p.intent;
  p.x += (a.x - p.x) * Math.min(1, dt * 14); p.z += (a.z - p.z) * Math.min(1, dt * 14);
  p.vx = p.vz = 0; p.vy = 0; p.onGround = false; p.fallStartY = p.y; p.stance = Stance.Stand;
  p.y = Math.min(a.y1, p.y + ASCEND * dt);
  const stepOut = (floorY: number) => {
    P.asc = -1; sim.emit({ t: 'ascender', p: p.id, on: false });
    const tx = a.x + a.nx * 1.3, tz = a.z + a.nz * 1.3, t = 0.4;
    p.mantleT = t; p.mantleY = floorY + 0.02; P.mantleDur = t; P.mantleY0 = p.y; P.mantleX0 = p.x; P.mantleZ0 = p.z; P.mantleX1 = tx; P.mantleZ1 = tz;
  };
  if (p.y >= a.y1 - 1e-3) { stepOut(a.y1); return true; }
  if (!it.interact) P.ascHeld = false;
  if (it.jump || (it.interact && !P.ascHeld)) {
    it.jump = false; P.ascHeld = true;
    // step off at the floor we're passing (within 1.6 m below the feet), otherwise just let go
    const below = a.stops.filter((y) => y <= p.y + 0.3 && y >= p.y - 1.6);
    if (below.length) stepOut(below[below.length - 1]);
    else { P.asc = -1; sim.emit({ t: 'ascender', p: p.id, on: false }); }
  }
  return true;
}
