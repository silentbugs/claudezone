/** Weapons, bullets, throwables, explosions. */
import { WEAPON, damageAt, rarityMods, AMMO_MAX , isSuppressed } from '../data/weapons';
import { Mat, PENETRATION, RayHit } from '../world/collision';
import { Bullet, Phase, Player, Stance, Throwable } from './types';
import type { Sim } from './sim';
import { eyeHeight } from './movement';
import { segHitVehicle } from './vehicles';
import { clamp } from '../core/math';

const hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0, structure: -1, part: -1, mat: Mat.Rock, terrain: false, water: false };

export function aimDir(p: Player, out: number[] = [0, 0, 0]) {
  const yaw = p.yaw + p.recoilYaw, pitch = p.pitch + p.recoil;
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * cp;
  return out;
}

export function canShoot(p: Player) {
  return (p.phase === Phase.Alive || p.phase === Phase.Gulag) && !p.swimming && p.mantleT <= 0;
}

/** Per-tick weapon state machine: reload, swap, fire, plates. */
export function weaponTick(sim: Sim, p: Player, dt: number) {
  const it = p.intent;
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.meleeCd > 0) p.meleeCd -= dt;
  if (p.boltT > 0) p.boltT -= dt;
  // ADS
  const w = p.weapons[p.cur];
  const def = w ? WEAPON[w.id] : null;
  const wantAds = it.ads && canShoot(p) && p.reloadT <= 0.0 + (def ? def.reload : 0) && p.plateT <= 0;
  const adsT = def ? def.adsTime * rarityMods(w!.rarity).ads : 0.2;
  p.ads = clamp(p.ads + (wantAds ? dt / (adsT * (p.sprintOut > 0 ? 1.25 : 1)) : -dt / (adsT * 0.8)), 0, 1); // aiming out of a sprint is slightly slower (sprint-to-fire)
  // recoil recovery
  const firing = it.fire && p.fireCd > -0.1;
  p.recoil -= p.recoil * Math.min(1, dt * (firing ? 1.2 : 5));
  p.recoilYaw -= p.recoilYaw * Math.min(1, dt * 5);
  p.bloom = Math.max(0, p.bloom - dt * 2.5);
  if (p.flashT > 0) p.flashT -= dt;
  if (p.stunT > 0) p.stunT -= dt;
  // swapping
  if (p.swapT > 0) { p.swapT -= dt; return; }
  const wantSlot = it.swap ? (p.cur === 0 ? 1 : 0) : it.slot ? it.slot - 1 : -1;
  it.swap = false; it.slot = 0;
  if (wantSlot >= 0 && wantSlot !== p.cur && p.weapons[wantSlot]) { p.cur = wantSlot; p.swapT = 0.6; p.reloadT = 0; p.plateT = 0; sim.emit({ t: 'reload', p: p.id, w: 'swap' }); return; }
  // plates (chain while held)
  if (p.plateT > 0) {
    p.plateT -= dt;
    if (p.plateT <= 0) {
      p.armor = Math.min(150, p.armor + 50); p.plates--;
      sim.emit({ t: 'plate', p: p.id, done: true });
      if ((it.plate || p.bot) && p.plates > 0 && p.armor < 150) { p.plateT = 1.25; sim.emit({ t: 'plate', p: p.id, done: false }); }
    }
    if (it.fire && p.fireCd <= 0) p.plateT = 0; else return;
  } else if (it.plate && p.plates > 0 && p.armor < 150 && canShoot(p) || (it.plate && p.plates > 0 && p.armor < 150 && p.phase === Phase.Alive)) {
    p.plateT = 1.25; p.reloadT = 0; sim.emit({ t: 'plate', p: p.id, done: false });
    return;
  }
  if (!w || !def) return;
  const mods = rarityMods(w.rarity);
  const magSize = mods.extMag ? def.magExt : def.mag;
  // reload
  if (p.reloadT > 0) {
    if (it.fire && w.mag > 0 && !p.triggerHeld) { p.reloadT = 0; }
    else {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const need = magSize - w.mag, take = Math.min(need, p.ammo[def.ammo]);
        w.mag += take; p.ammo[def.ammo] -= take;
      }
      return;
    }
  }
  if (it.reload && w.mag < magSize && p.ammo[def.ammo] > 0 && def.cls !== 'melee') { startReload(sim, p); return; }
  // quick melee (all weapons) and the combat knife
  if ((it as any).melee || (def.cls === 'melee' && it.fire && !p.triggerHeld)) { (it as any).melee = false; if (p.meleeCd <= 0) melee(sim, p, def.cls === 'melee' ? def.melee!.damage : 60); p.triggerHeld = it.fire; return; }
  if (def.cls === 'melee') { if (!it.fire) p.triggerHeld = false; return; }
  // a burst in progress keeps firing without the trigger
  if (p.burstLeft > 0) {
    if (p.fireCd <= 0 && w.mag > 0 && canShoot(p)) { fire(sim, p, w, def, mods); p.burstLeft--; if (p.burstLeft <= 0 || w.mag <= 0) { p.burstLeft = 0; p.fireCd = 60 / (def.burstRpm ?? def.rpm); } }
    if (!it.fire) p.triggerHeld = false;
    return;
  }
  // firing
  if (it.fire && canShoot(p) && p.stanceT <= 0.05) {
    if (w.mag <= 0) {
      if (p.ammo[def.ammo] > 0) startReload(sim, p);
      else {
        if (!p.triggerHeld) sim.emit({ t: 'dryfire', p: p.id });
        // depleted-ammo weapon switch
        const o = p.weapons[p.cur === 0 ? 1 : 0];
        if (o && (p as any).prefs?.emptySwitch !== false && (o.mag > 0 || p.ammo[WEAPON[o.id].ammo] > 0)) { p.cur = p.cur === 0 ? 1 : 0; p.swapT = 0.6; sim.emit({ t: 'reload', p: p.id, w: 'swap' }); }
      }
      p.triggerHeld = true;
      return;
    }
    if (p.fireCd > 0 || p.boltT > 0) { p.triggerHeld = true; return; }
    if (!def.auto && p.triggerHeld) return;
    if (p.sprinting) { p.sprinting = false; p.sprintOut = p.tacSprint > 0 ? 0.3 : 0.18; p.tacSprint = 0; return; } // sprint-to-fire delay
    if (p.sprintOut > 0) return;
    fire(sim, p, w, def, mods);
    if (def.burst && def.burst > 1) { p.burstLeft = def.burst - 1; if (w.mag <= 0) { p.burstLeft = 0; p.fireCd = 60 / (def.burstRpm ?? def.rpm); } }
    p.triggerHeld = true;
  } else p.triggerHeld = false;
}

/** Melee: hits the closest enemy in a short cone in front. */
function melee(sim: Sim, p: Player, dmg: number) {
  p.meleeCd = 0.7; p.reloadT = 0; p.plateT = 0;
  sim.emit({ t: 'melee', p: p.id });
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best: Player | null = null, bd = 2.4;
  for (const q of sim.playersNear(p.x, p.z, 3)) {
    if (q.id === p.id || !q.alive || q.squad === p.squad) continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > bd || Math.abs(q.y - p.y) > 1.8) continue;
    if ((dx * fx + dz * fz) / Math.max(0.01, d) < 0.6) continue;
    best = q; bd = d;
  }
  if (best) sim.damage(best, dmg, p.id, 'melee', false, false, best.x, best.y + 1.1, best.z);
}

function startReload(sim: Sim, p: Player) {
  const w = p.weapons[p.cur]!; const def = WEAPON[w.id];
  p.reloadT = def.reload * (w.mag === 0 ? 1.15 : 1);
  p.ads = Math.min(p.ads, 0.4);
  sim.emit({ t: 'reload', p: p.id, w: w.id });
}

const dir = [0, 0, 0];
function fire(sim: Sim, p: Player, w: { id: string; rarity: number; mag: number }, def: typeof WEAPON[string], mods: ReturnType<typeof rarityMods>) {
  w.mag--;
  p.fireCd = 60 / def.rpm;
  if (def.bolt) p.boltT = 60 / def.rpm;
  p.lastShot = sim.time;
  const ey = p.y + eyeHeight(p);
  aimDir(p, dir);
  // spread: hip vs ads, movement, jumping, bloom
  const moving = Math.hypot(p.vx, p.vz);
  let spread = (def.spreadHip + (def.spreadAds - def.spreadHip) * p.ads) * mods.spread;
  spread *= 1 + moving * (p.ads > 0.5 ? 0.03 : 0.12) + (p.onGround ? 0 : 1.5) + p.bloom * (p.ads > 0.5 ? 0.3 : 1);
  if (p.stance === Stance.Crouch) spread *= 0.85; else if (p.stance === Stance.Prone) spread *= 0.7;
  if (p.bot) spread *= 1; // bots add aim error elsewhere
  const pellets = def.pellets ?? 1;
  const vel = def.velocity * mods.velocity;
  for (let i = 0; i < pellets; i++) {
    const r = spread * Math.sqrt(sim.rng.next()), a = sim.rng.next() * Math.PI * 2;
    // perturb direction in a cone
    const ux = -dir[2], uz = dir[0]; const ul = Math.hypot(ux, uz) || 1; // horizontal perpendicular
    const upx = -dir[1] * (dir[0]) , upy = dir[0] * dir[0] + dir[2] * dir[2], upz = -dir[1] * dir[2];
    const upl = Math.hypot(upx, upy, upz) || 1;
    const c = Math.cos(a) * r, s = Math.sin(a) * r;
    let dx = dir[0] + (ux / ul) * c + (upx / upl) * s, dy = dir[1] + (upy / upl) * s, dz = dir[2] + (uz / ul) * c + (upz / upl) * s;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const b: Bullet = { owner: p.id, weapon: w.id, rarity: w.rarity, x: p.x + dir[0] * 0.2, y: ey, z: p.z + dir[2] * 0.2, vx: dx * vel, vy: dy * vel, vz: dz * vel, dist: 0, dmgMul: 1, life: def.cls === 'launcher' ? 6 : 2.5, tracer: i === 0, rocket: def.cls === 'launcher' };
    sim.bullets.push(b);
  }
  const quiet = isSuppressed(w.id, w.rarity);
  if (!quiet) (p as any).lastLoudShot = sim.time;
  sim.emit({ t: 'shot', p: p.id, w: w.id, x: p.x, y: ey, z: p.z, dx: dir[0], dy: dir[1], dz: dir[2], suppressed: quiet });
  // recoil
  const rk = def.recoilV * mods.recoil * (p.ads > 0.5 ? 1 : 1.3) * (p.stance === Stance.Prone ? 0.6 : p.stance === Stance.Crouch ? 0.85 : 1);
  p.recoil += rk * (0.8 + sim.rng.next() * 0.4);
  p.recoilYaw += (sim.rng.next() - 0.5) * 2 * def.recoilH * mods.recoil;
  p.bloom = Math.min(3, p.bloom + 0.35);
  if (p.plateT > 0) p.plateT = 0;
}

/** Player hit volumes: returns hit distance along a segment and zone (0 body, 1 head, 2 legs). */
function segHitPlayer(p: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): { t: number; zone: number } | null {
  const prone = p.phase === Phase.Downed || p.stance === Stance.Prone;
  let best: { t: number; zone: number } | null = null;
  if (!prone) {
    const top = p.stance === Stance.Crouch ? 0.98 : 1.42;
    const t = segCapsule(ox, oy, oz, dx, dy, dz, len, p.x, p.y + 0.3, p.z, p.x, p.y + top, p.z, 0.3);
    if (t >= 0) { const hy = oy + dy * t - p.y; best = { t, zone: hy < 0.75 && p.stance === Stance.Stand ? 2 : 0 }; }
    const hy = p.y + (p.stance === Stance.Crouch ? 1.18 : 1.62);
    const th = segSphere(ox, oy, oz, dx, dy, dz, len, p.x, hy, p.z, 0.16);
    if (th >= 0 && (!best || th < best.t + 0.05)) best = { t: th, zone: 1 };
  } else {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const t = segCapsule(ox, oy, oz, dx, dy, dz, len, p.x - fx * 0.8, p.y + 0.28, p.z - fz * 0.8, p.x + fx * 0.5, p.y + 0.3, p.z + fz * 0.5, 0.3);
    if (t >= 0) best = { t, zone: 0 };
    const th = segSphere(ox, oy, oz, dx, dy, dz, len, p.x + fx * 0.8, p.y + 0.35, p.z + fz * 0.8, 0.16);
    if (th >= 0 && (!best || th < best.t)) best = { t: th, zone: 1 };
  }
  return best;
}

function segSphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, cx: number, cy: number, cz: number, r: number): number {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz, c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c; if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= len ? t : c <= 0 ? 0 : -1;
}
/** Segment vs capsule: approximate via closest approach between segment and capsule axis. */
function segCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const a = dx * dx + dy * dy + dz * dz, b = dx * ux + dy * uy + dz * uz, c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz, e = ux * wx + uy * wy + uz * wz;
  const den = a * c - b * b;
  let s = den > 1e-9 ? (b * e - c * d) / den : 0, t = den > 1e-9 ? (a * e - b * d) / den : e / c;
  s = clamp(s, 0, len); t = clamp((b * s + e) / c, 0, 1);
  s = clamp((b * t - d) / a, 0, len);
  const px = ox + dx * s - (ax + ux * t), py = oy + dy * s - (ay + uy * t), pz = oz + dz * s - (az + uz * t);
  const dist = Math.sqrt(px * px + py * py + pz * pz);
  if (dist > r) return -1;
  // back off to the surface
  return Math.max(0, s - Math.sqrt(Math.max(0, r * r - dist * dist)));
}

export function updateBullets(sim: Sim, dt: number) {
  const col = sim.world.col;
  const bs = sim.bullets;
  let w = 0;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    let alive = true;
    b.life -= dt;
    b.vy -= (b.rocket ? 2 : 9.8 * 0.55) * dt;
    const sp = Math.hypot(b.vx, b.vy, b.vz), len = sp * dt;
    const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
    // world
    const skip = (m: Mat) => m === Mat.Foliage;
    let tw = Infinity;
    if (col.raycast(b.x, b.y, b.z, dx, dy, dz, len, hit, skip)) tw = hit.t;
    // players
    let tp = Infinity, victim: Player | null = null, zone = 0;
    const near = sim.playersNear((b.x + b.x + dx * len) / 2, (b.z + b.z + dz * len) / 2, len / 2 + 2);
    for (const p of near) {
      if (p.id === b.owner && b.dist < 3) continue;
      if (!p.alive || p.phase === Phase.Plane || p.phase === Phase.Dead || p.phase === Phase.Spectate || p.phase === Phase.GulagWait) continue;
      const r = segHitPlayer(p, b.x, b.y, b.z, dx, dy, dz, Math.min(len, tw));
      if (r && r.t < tp) { tp = r.t; victim = p; zone = r.zone; }
    }
    // vehicles in the way
    let tv = Infinity, vhit: any = null;
    for (const v of sim.vehicles) { if (!v.alive || Math.abs(v.x - b.x) > len + 10 || Math.abs(v.z - b.z) > len + 10) continue; const t = segHitVehicle(v, b.x, b.y, b.z, dx, dy, dz, Math.min(len, tw)); if (t >= 0 && t < tv && (sim.players[b.owner] as any)?.vehicle !== v.id) { tv = t; vhit = v; } }
    if (vhit && tv < tp && tv < tw) {
      const def = WEAPON[b.weapon];
      if (b.rocket) sim.explode(b.x + dx * tv, b.y + dy * tv, b.z + dz * tv, def.splash!.radius, def.splash!.damage, b.owner, 'rocket');
      else { vhit.health -= damageAt(def, b.dist + tv) * b.dmgMul * (def.cls === 'sniper' ? 2 : 1); sim.emit({ t: 'impact', x: b.x + dx * tv, y: b.y + dy * tv, z: b.z + dz * tv, nx: -dx, ny: -dy, nz: -dz, mat: Mat.Metal, water: false }); if (b.owner === sim.localId) sim.emit({ t: 'hit', attacker: b.owner, victim: -1, dmg: 0, head: false, armorBroke: false, armorHit: true, kill: false, down: false, x: b.x, y: b.y, z: b.z }); }
      continue;
    }
    // near-miss whiz for the listener
    if (tp < tw && victim && riotBlocks(victim, dx, dz)) {
      const hx = b.x + dx * tp, hy = b.y + dy * tp, hz = b.z + dz * tp;
      sim.emit({ t: 'impact', x: hx, y: hy, z: hz, nx: -dx, ny: 0, nz: -dz, mat: Mat.Metal, water: false });
      if (b.rocket) sim.explode(hx, hy, hz, WEAPON[b.weapon].splash!.radius, WEAPON[b.weapon].splash!.damage * 0.5, b.owner, 'rocket');
      continue;
    }
    if (tp < tw && victim) {
      const def = WEAPON[b.weapon];
      if (b.rocket) { sim.explode(b.x + dx * tp, b.y + dy * tp, b.z + dz * tp, def.splash!.radius, def.splash!.damage, b.owner, 'rocket'); alive = false; }
      else {
        const dist = b.dist + tp;
        let dmg = damageAt(def, dist, rarityMods(b.rarity).range) * b.dmgMul;
        dmg *= zone === 1 ? def.head : zone === 2 ? def.limb : 1;
        if (def.pellets) dmg *= 1;
        sim.damage(victim, dmg, b.owner, b.weapon, zone === 1, false, b.x + dx * tp, b.y + dy * tp, b.z + dz * tp);
        alive = false;
      }
    } else if (tw < Infinity) {
      const hx = b.x + dx * tw, hy = b.y + dy * tw, hz = b.z + dz * tw;
      if (b.rocket) { sim.explode(hx, hy, hz, WEAPON[b.weapon].splash!.radius, WEAPON[b.weapon].splash!.damage, b.owner, 'rocket'); alive = false; }
      else {
        sim.emit({ t: 'impact', x: hx, y: hy, z: hz, nx: hit.nx, ny: hit.ny, nz: hit.nz, mat: hit.mat, water: hit.water });
        const pen = PENETRATION[hit.mat as Mat];
        if (pen !== undefined && b.dmgMul > 0.3) {
          // pass through thin cover and keep going
          b.dmgMul *= pen; b.x = hx + dx * 0.5; b.y = hy + dy * 0.5; b.z = hz + dz * 0.5; b.dist += tw + 0.5;
          if (alive) { bs[w++] = b; } continue;
        }
        alive = false;
      }
    } else {
      b.x += dx * len; b.y += dy * len; b.z += dz * len; b.dist += len;
      // whiz past the local player's head
      const lp = sim.players[sim.localId];
      if (lp && b.owner !== lp.id && lp.alive) {
        const ex = lp.x - b.x, ey = lp.y + 1.6 - b.y, ez = lp.z - b.z;
        if (ex * ex + ey * ey + ez * ez < 9 && !(b as any).whizzed) { (b as any).whizzed = true; sim.emit({ t: 'whiz', p: lp.id, x: b.x, y: b.y, z: b.z }); }
      }
    }
    if (b.life <= 0 || b.y < -50) alive = false;
    if (alive) bs[w++] = b;
  }
  bs.length = w;
}

// ---------------------------------------------------------------- throwables
export function throwItem(sim: Sim, p: Player, type: Throwable['type']) {
  const d = aimDir(p, [0, 0, 0]);
  const speed = type === 'knife' ? 32 : type === 'rock' ? 22 : 20;
  const t: Throwable = { id: sim.nextId++, owner: p.id, type, x: p.x + d[0] * 0.5, y: p.y + eyeHeight(p) - 0.1, z: p.z + d[2] * 0.5, vx: d[0] * speed + p.vx * 0.5, vy: d[1] * speed + (type === 'knife' ? 0.5 : 4), vz: d[2] * speed + p.vz * 0.5, fuse: type === 'frag' ? 3.2 : type === 'semtex' ? 2.2 : type === 'molotov' ? 10 : type === 'stun' || type === 'flash' ? 1.5 : type === 'smoke' ? 1.2 : type === 'c4' ? 999 : 10, stuck: false, alive: true };
  sim.throwables.push(t);
  sim.emit({ t: 'throw', p: p.id, type });
}

export function updateThrowables(sim: Sim, dt: number) {
  const col = sim.world.col;
  for (const t of sim.throwables) {
    if (!t.alive) continue;
    t.fuse -= dt;
    if (!t.stuck) {
      t.vy -= 14 * dt;
      const sp = Math.hypot(t.vx, t.vy, t.vz), len = sp * dt;
      if (sp > 0.01) {
        const dx = t.vx / sp, dy = t.vy / sp, dz = t.vz / sp;
        // hit players (knife / rock / semtex)
        if (t.type === 'knife' || t.type === 'rock' || t.type === 'semtex') {
          for (const p of sim.playersNear(t.x, t.z, len + 1.5)) {
            if (p.id === t.owner || !p.alive || p.phase === Phase.GulagWait) continue;
            const r = segHitPlayer(p, t.x, t.y, t.z, dx, dy, dz, len);
            if (r) {
              if (t.type === 'knife') { sim.damage(p, 300, t.owner, 'knife', r.zone === 1, false); t.alive = false; }
              else if (t.type === 'rock') { sim.damage(p, 5, t.owner, 'rock', false, false); p.stunT = Math.max(p.stunT, 0.3); t.alive = false; }
              else { t.stuck = true; (t as any).stickTo = p.id; }
              break;
            }
          }
          if (!t.alive) continue;
        }
        if (col.raycast(t.x, t.y, t.z, dx, dy, dz, len, hit)) {
          if (t.type === 'semtex' || t.type === 'knife' || t.type === 'c4') { t.stuck = true; t.x += dx * hit.t; t.y += dy * hit.t; t.z += dz * hit.t; if (t.type === 'knife') t.fuse = 0.01; }
          else if (t.type === 'rock') { t.alive = false; continue; }
          else if (t.type === 'molotov') { t.fuse = 0; t.x += dx * hit.t; t.y += dy * hit.t; t.z += dz * hit.t; }
          else {
            // bounce
            t.x += dx * (hit.t - 0.05); t.y += dy * (hit.t - 0.05); t.z += dz * (hit.t - 0.05);
            const vn = t.vx * hit.nx + t.vy * hit.ny + t.vz * hit.nz;
            t.vx = (t.vx - 2 * vn * hit.nx) * 0.4; t.vy = (t.vy - 2 * vn * hit.ny) * 0.35; t.vz = (t.vz - 2 * vn * hit.nz) * 0.4;
            if (hit.ny > 0.7 && Math.abs(t.vy) < 1) { t.vy = 0; t.vx *= 0.8; t.vz *= 0.8; }
          }
        } else { t.x += t.vx * dt; t.y += t.vy * dt; t.z += t.vz * dt; }
      }
    } else if ((t as any).stickTo !== undefined) {
      const p = sim.players[(t as any).stickTo]; if (p) { t.x = p.x; t.y = p.y + 1.1; t.z = p.z; }
    }
    if (t.fuse <= 0) {
      t.alive = false;
      switch (t.type) {
        case 'frag': case 'semtex': sim.explode(t.x, t.y, t.z, 7, t.type === 'semtex' ? 170 : 150, t.owner, 'frag'); break;
        case 'c4': sim.explode(t.x, t.y, t.z, 8, 220, t.owner, 'c4'); break;
        case 'molotov': sim.fires.push({ x: t.x, y: t.y, z: t.z, r: 4, t: 7, owner: t.owner }); sim.emit({ t: 'explosion', x: t.x, y: t.y, z: t.z, r: 3, kind: 'molotov' }); break;
        case 'stun': case 'flash':
          sim.emit({ t: 'explosion', x: t.x, y: t.y, z: t.z, r: 2, kind: t.type });
          for (const p of sim.playersNear(t.x, t.z, 12)) {
            const d = Math.hypot(p.x - t.x, p.y + 1.5 - t.y, p.z - t.z); if (d > 12 || !sim.world.col.los(t.x, t.y + 0.3, t.z, p.x, p.y + 1.5, p.z)) continue;
            const k = 1 - d / 12;
            if (t.type === 'stun') p.stunT = Math.max(p.stunT, 1 + 3 * k); else { p.flashT = Math.max(p.flashT, 1 + 3 * k); sim.emit({ t: 'flash', p: p.id, s: k }); }
          }
          break;
        case 'smoke': sim.smokes.push({ x: t.x, y: t.y, z: t.z, t: 20 }); sim.emit({ t: 'explosion', x: t.x, y: t.y, z: t.z, r: 1, kind: 'smoke' }); break;
      }
    }
  }
  sim.throwables = sim.throwables.filter((t) => t.alive);
  for (const f of sim.fires) {
    f.t -= dt;
    for (const p of sim.playersNear(f.x, f.z, f.r)) if (Math.hypot(p.x - f.x, p.z - f.z) < f.r && Math.abs(p.y - f.y) < 2) sim.damage(p, 40 * dt, f.owner, 'molotov', false, false);
  }
  sim.fires = sim.fires.filter((f) => f.t > 0);
  for (const s of sim.smokes) s.t -= dt;
  sim.smokes = sim.smokes.filter((s) => s.t > 0);
}

export function refillAmmo(p: Player) {
  for (const k of Object.keys(AMMO_MAX) as (keyof typeof AMMO_MAX)[]) p.ammo[k] = AMMO_MAX[k];
}

/** Riot Shield: blocks bullets from the front while held, and from behind while slung on the back. */
function riotBlocks(v: Player, dx: number, dz: number): boolean {
  const held = v.weapons[v.cur]?.id === 'riotshield', slung = !held && v.weapons.some((w) => w?.id === 'riotshield');
  if (!held && !slung) return false;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const facing = -(dx * fx + dz * fz); // > 0 when the bullet comes at the victim's front
  return held ? facing > 0.55 : facing < -0.55;
}
