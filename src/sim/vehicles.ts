/**
 * Vehicles: ATV, Tactical Rover, SUV, Cargo Truck, light Helicopter. Arcade handling: ground
 * vehicles ride four sampled wheel points; the helicopter holds altitude with collective input.
 */
import type { Sim } from './sim';
import { Phase, Player } from './types';
import { toLocal } from '../world/collision';
import { clamp, wrapAngle } from '../core/math';

export type VehicleType = 'atv' | 'rover' | 'suv' | 'truck' | 'heli';
/**
 * Top speeds are Warzone 2020 measurements (racinggames.gg vehicle stats: ATV 17.8, Tac Rover 19.4, SUV 16.9,
 * helicopter 25.8 m/s; the Cargo Truck is not listed, heavy-truck class ~15 m/s). `accel` is the launch
 * acceleration (m/s²); it tapers off toward top speed, so 0 → max takes ~2.8 s (ATV) to ~6.5 s (truck).
 */
export interface VehicleDef { name: string; seats: [number, number, number][]; maxSpeed: number; accel: number; turn: number; health: number; len: number; wid: number; hgt: number; air?: boolean }
/** Seat offsets are local (x right, y up, z forward = -z). Seat 0 drives. */
export const VEHICLES: Record<VehicleType, VehicleDef> = {
  atv: { name: 'ATV', seats: [[0, 0.9, 0.1], [0, 1.0, 0.8]], maxSpeed: 17.8, accel: 10.5, turn: 1.9, health: 900, len: 2.2, wid: 1.2, hgt: 1.2 },
  rover: { name: 'Tactical Rover', seats: [[-0.45, 0.9, -0.2], [0.45, 0.9, -0.2], [-0.45, 1.1, 0.9], [0.45, 1.1, 0.9]], maxSpeed: 19.4, accel: 9.5, turn: 1.5, health: 1200, len: 3.6, wid: 1.9, hgt: 1.6 },
  suv: { name: 'SUV', seats: [[-0.45, 0.9, -0.3], [0.45, 0.9, -0.3], [-0.45, 0.9, 0.8], [0.45, 0.9, 0.8]], maxSpeed: 16.9, accel: 6.2, turn: 1.3, health: 2000, len: 4.8, wid: 2.1, hgt: 1.9 },
  truck: { name: 'Cargo Truck', seats: [[-0.5, 1.8, -2.2], [0.5, 1.8, -2.2], [-0.6, 1.9, 1.2], [0.6, 1.9, 1.2], [-0.6, 1.9, 2.6], [0.6, 1.9, 2.6]], maxSpeed: 15, accel: 3.8, turn: 1.0, health: 3000, len: 7.5, wid: 2.5, hgt: 3.0 },
  heli: { name: 'Helicopter', seats: [[-0.5, 0.8, -1.2], [0.5, 0.8, -1.2], [-0.8, 0.8, 0.4], [0.8, 0.8, 0.4]], maxSpeed: 25.8, accel: 10, turn: 1.4, health: 1500, len: 9, wid: 2.4, hgt: 2.8, air: true },
};

export interface Vehicle {
  id: number; type: VehicleType;
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  px: number; py: number; pz: number; pyaw: number;
  vx: number; vy: number; vz: number; speed: number;
  health: number; alive: boolean; burnT: number;
  seats: number[]; rotor: number;
}

export function makeVehicle(id: number, type: VehicleType, x: number, y: number, z: number, yaw: number): Vehicle {
  const d = VEHICLES[type];
  return { id, type, x, y, z, yaw, pitch: 0, roll: 0, px: x, py: y, pz: z, pyaw: yaw, vx: 0, vy: 0, vz: 0, speed: 0, health: d.health, alive: true, burnT: 0, seats: d.seats.map(() => -1), rotor: 0 };
}

export function seatWorld(v: Vehicle, i: number): [number, number, number] {
  const [sx, sy, sz] = VEHICLES[v.type].seats[i];
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  return [v.x + sx * c + sz * s, v.y + sy, v.z - sx * s + sz * c];
}

export function enterVehicle(sim: Sim, p: Player, v: Vehicle): boolean {
  if (!v.alive) return false;
  const free = v.seats.findIndex((s) => s < 0);
  if (free < 0) return false;
  v.seats[free] = p.id; (p as any).vehicle = v.id; (p as any).seat = free;
  p.stance = 0; p.sprinting = false; p.ads = 0; p.reloadT = 0; p.plateT = 0;
  sim.emit({ t: 'announce', text: `__enter__${v.id}`, squad: p.squad });
  return true;
}
export function exitVehicle(sim: Sim, p: Player) {
  const v = sim.vehicles.find((q) => q.id === (p as any).vehicle); (p as any).vehicle = undefined;
  if (!v) return;
  const seat = (p as any).seat as number; v.seats[seat] = -1;
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw), side = VEHICLES[v.type].seats[seat][0] < 0 ? -1 : 1;
  const ox = side * (VEHICLES[v.type].wid / 2 + 0.8);
  p.x = v.x + ox * c; p.z = v.z - ox * s;
  const g = sim.world.col.groundAt(p.x, p.z, v.y + 3);
  p.y = Math.max(g, VEHICLES[v.type].air ? g : p.y);
  p.vx = v.vx * 0.5; p.vz = v.vz * 0.5; p.vy = 0; p.fallStartY = VEHICLES[v.type].air ? v.y : p.y; p.onGround = false;
  if (VEHICLES[v.type].air && v.y - g > 15) { p.phase = Phase.Freefall; p.y = v.y - 2; }
}

export function vehicleOf(sim: Sim, p: Player): Vehicle | null { const id = (p as any).vehicle; return id === undefined ? null : sim.vehicles.find((v) => v.id === id) ?? null; }

const push = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

export function updateVehicles(sim: Sim, dt: number) {
  const col = sim.world.col;
  for (const v of sim.vehicles) {
    v.px = v.x; v.py = v.y; v.pz = v.z; v.pyaw = v.yaw;
    const d = VEHICLES[v.type];
    if (!v.alive) { v.burnT -= dt; continue; }
    // clear seats of players who left or died
    for (let i = 0; i < v.seats.length; i++) { const id = v.seats[i]; if (id >= 0) { const p = sim.players[id]; if (!p.alive || p.phase !== Phase.Alive || (p as any).vehicle !== v.id) v.seats[i] = -1; } }
    const driver = v.seats[0] >= 0 ? sim.players[v.seats[0]] : null;
    const it = driver?.intent;
    if (d.air) heli(sim, v, d, driver, dt);
    else {
      const throttle = it ? it.mz : 0, steer = it ? -it.mx : 0, brake = !!(it as any)?.up;
      // forward speed
      const fwdX = -Math.sin(v.yaw), fwdZ = -Math.cos(v.yaw);
      let sp = v.vx * fwdX + v.vz * fwdZ;
      const target = throttle > 0 ? d.maxSpeed * throttle : throttle < 0 ? -d.maxSpeed * 0.35 : 0;
      // engine pull fades toward top speed (full at launch, ~35 % near the top); braking against motion is twice as strong
      const pull = 1 - 0.65 * Math.min(1, Math.abs(sp) / d.maxSpeed) ** 2;
      const acc = throttle !== 0 ? d.accel * (Math.sign(target - sp) !== Math.sign(sp) && sp !== 0 ? 2 : pull) : 4;
      sp += clamp(target - sp, -acc * dt * (brake ? 3 : 1), acc * dt);
      if (brake) sp *= Math.exp(-dt * 2.5);
      const onGround = v.y - col.groundAt(v.x, v.z, v.y + 1.5, 1) < 0.4;
      if (onGround) v.yaw += steer * d.turn * clamp(Math.abs(sp) / 8, 0, 1) * Math.sign(sp || 1) * dt * (brake ? 1.6 : 1);
      // velocity follows heading on the ground (a little drift), coasts in the air
      const nvx = -Math.sin(v.yaw) * sp, nvz = -Math.cos(v.yaw) * sp;
      const grip = onGround ? (brake ? 0.2 : 0.85) : 0.02;
      v.vx += (nvx - v.vx) * Math.min(1, grip * dt * 10); v.vz += (nvz - v.vz) * Math.min(1, grip * dt * 10);
      v.speed = Math.hypot(v.vx, v.vz);
      v.x += v.vx * dt; v.z += v.vz * dt;
      // collisions: circles along the body
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      let hitAny = false;
      for (const off of [-d.len * 0.3, d.len * 0.3]) {
        const cx = v.x + off * s, cz = v.z + off * c;
        col.pushOut(cx, v.y + 0.3, cz, d.hgt, d.wid * 0.55, 0.6, push);
        if (push.hit) { v.x += push.x - cx; v.z += push.z - cz; hitAny = true; }
      }
      if (hitAny && v.speed > 6) {
        const impact = v.speed;
        v.health -= impact * impact * 0.9;
        v.vx *= -0.25; v.vz *= -0.25;
        for (const id of v.seats) if (id >= 0 && impact > 18) sim.damage(sim.players[id], (impact - 18) * 6, -1, 'crash', false, true);
      }
      // suspension: sample 4 wheels
      const hw = d.wid * 0.45, hl = d.len * 0.38;
      const wh = (lx: number, lz: number) => col.groundAt(v.x + lx * c + lz * s, v.z - lx * s + lz * c, v.y + 1.2, 0.3);
      const fl = wh(-hw, -hl), fr = wh(hw, -hl), bl = wh(-hw, hl), br = wh(hw, hl);
      const gy = (fl + fr + bl + br) / 4;
      if (v.y > gy + 0.05) { v.vy -= 20 * dt; v.y += v.vy * dt; if (v.y < gy) { if (v.vy < -14) v.health -= (-v.vy - 14) * 40; v.y = gy; v.vy = 0; } }
      else { v.y = gy; v.vy = Math.max(0, (gy - v.py) / dt) * 0.5; }
      v.pitch += (Math.atan2(((fl + fr) - (bl + br)) / 2, hl * 2) - v.pitch) * Math.min(1, dt * 8);
      v.roll += (Math.atan2(((fr + br) - (fl + bl)) / 2, hw * 2) - v.roll) * Math.min(1, dt * 8);
      // sinking
      if (col.waterAt(v.x, v.z) > v.y + 1.2) { v.health -= 400 * dt; v.vx *= 0.9; v.vz *= 0.9; }
    }
    v.x = clamp(v.x, 20, sim.world.hf.size - 20); v.z = clamp(v.z, 20, sim.world.hf.size - 20);
    // run over players
    if (v.speed > 6) {
      for (const q of sim.playersNear(v.x, v.z, d.len)) {
        if ((q as any).vehicle === v.id || !q.alive || q.phase === Phase.Freefall || q.phase === Phase.Chute) continue;
        if (Math.abs(q.y - v.y) > 2.5) continue;
        const [lx, lz] = toLocal({ x: v.x, z: v.z, cos: Math.cos(v.yaw), sin: Math.sin(v.yaw) } as any, q.x, q.z);
        if (Math.abs(lx) < d.wid / 2 + 0.3 && Math.abs(lz) < d.len / 2 + 0.3) {
          const drv = driver ? driver.id : -1;
          sim.damage(q, v.speed * 9, drv, 'vehicle', false, false);
          q.vx += v.vx * 0.5; q.vz += v.vz * 0.5;
        }
      }
    }
    // position occupants
    for (let i = 0; i < v.seats.length; i++) {
      const id = v.seats[i]; if (id < 0) continue;
      const p = sim.players[id], [sx, sy, sz] = seatWorld(v, i);
      p.x = sx; p.y = sy - 0.9; p.z = sz; p.vx = v.vx; p.vy = 0; p.vz = v.vz; p.onGround = true; p.fallStartY = p.y;
    }
    if (v.health <= 0) destroy(sim, v);
  }
}

function heli(sim: Sim, v: Vehicle, d: VehicleDef, driver: Player | null, dt: number) {
  const col = sim.world.col, it = driver?.intent;
  const g = col.groundAt(v.x, v.z, v.y + 1, 2);
  const agl = v.y - g;
  v.rotor = clamp(v.rotor + (driver ? dt * 0.8 : -dt * 0.3), 0, 1);
  const lift = it ? ((it.jump || (it as any).up ? 1 : 0) - (it.crouch || (it as any).down ? 1 : 0)) : -0.3;
  // keep altitude input held (jump/crouch are one-shots for infantry; the client sets up/down for helis)
  const tvy = v.rotor > 0.6 ? lift * 12 : -9;
  v.vy += (tvy - v.vy) * Math.min(1, dt * 2);
  if (agl > 320 && v.vy > 0) v.vy = 0;
  // yaw from mouse (driver faces where they look), tilt from WASD
  if (driver && v.rotor > 0.6) v.yaw += wrapAngle(driver.yaw - v.yaw) * Math.min(1, dt * d.turn);
  const fwd = it ? it.mz : 0, side = it ? it.mx : 0;
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const tx = (-s * fwd + c * side) * d.maxSpeed * (agl > 2 ? 1 : 0), tz = (-c * fwd - s * side) * d.maxSpeed * (agl > 2 ? 1 : 0);
  v.vx += (tx - v.vx) * Math.min(1, dt * 0.9); v.vz += (tz - v.vz) * Math.min(1, dt * 0.9);
  v.pitch += (-fwd * 0.25 - v.pitch) * Math.min(1, dt * 3); v.roll += (-side * 0.3 - v.roll) * Math.min(1, dt * 3);
  v.x += v.vx * dt; v.y += v.vy * dt; v.z += v.vz * dt;
  v.speed = Math.hypot(v.vx, v.vz);
  const g2 = col.groundAt(v.x, v.z, v.y + 2, 2);
  if (v.y < g2) { if (v.vy < -10 || v.speed > 20) v.health -= (Math.abs(v.vy) + v.speed) * 30; v.y = g2; v.vy = 0; v.vx *= 0.5; v.vz *= 0.5; }
  // rotor strikes on structures
  // rotor / body strikes on buildings: pushed clear, damage only from a real impact (not brushing a tree or landing by a wall)
  col.pushOut(v.x, v.y + 0.3, v.z, d.hgt - 0.3, 3.2, 0.2, push);
  if (push.hit) { if (v.speed > 6) v.health -= v.speed * 25 * dt; v.x = push.x; v.z = push.z; v.vx *= 0.5; v.vz *= 0.5; }
}

function destroy(sim: Sim, v: Vehicle) {
  v.alive = false; v.burnT = 30;
  for (const id of v.seats) if (id >= 0) { const p = sim.players[id]; (p as any).vehicle = undefined; sim.damage(p, 400, -1, 'vehicle', false, true); }
  v.seats = v.seats.map(() => -1);
  sim.explode(v.x, v.y + 1, v.z, 9, 200, -1, 'vehicle');
}

/** Bullet hit test against a vehicle's oriented box. Returns distance or -1. */
export function segHitVehicle(v: Vehicle, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): number {
  const d = VEHICLES[v.type];
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const rx = ox - v.x, rz = oz - v.z;
  const lox = rx * c - rz * s, loz = rx * s + rz * c, loy = oy - v.y;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  let t0 = 0, t1 = len;
  const slab = (o: number, dd: number, lo: number, hi: number) => {
    if (Math.abs(dd) < 1e-9) return o >= lo && o <= hi;
    let a = (lo - o) / dd, b = (hi - o) / dd; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
  };
  if (!slab(lox, ldx, -d.wid / 2, d.wid / 2) || !slab(loy, dy, 0.2, d.hgt) || !slab(loz, ldz, -d.len / 2, d.len / 2)) return -1;
  return t0;
}
