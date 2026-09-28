/**
 * The Verdansk freight train (Season 4-5 2020): a locomotive and seven freight cars running non-stop
 * around the south-west loop (Train Station → Promenade West → the coast → Hills → Promenade East →
 * Hospital → back). Every car is a moving collision structure, so players can land on it by chute, stand
 * on it and ride, take cover behind containers, and bullets hit it. Players standing on a car are carried.
 */
import type { Sim } from './sim';
import { Phase } from './types';
import { makeStructure, Part, Structure, Mat } from '../world/collision';

export type CarKind = 'loco' | 'container' | 'gondola' | 'flat';
export interface TrainCar { kind: CarKind; len: number; offset: number; st: Structure; px: number; py: number; pz: number; pa: number }

/** m/s: faster than tactical sprint, slower than vehicles (a lap of the 3.6 km loop takes ~6 minutes) */
export const TRAIN_SPEED = 10;
const DECK = 1.3; // deck height above the rail
const W = 3.0;

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, color: number): Part { return { x0, y0, z0, x1, y1, z1, mat, color }; }

/** Car geometry in car-local space: long axis along z, -z is the front. */
function carParts(kind: CarKind, len: number): Part[] {
  const h = len / 2, w = W / 2;
  const deck = box(-w, 0.6, -h, w, DECK, h, Mat.Metal, 0x2e2f30);
  switch (kind) {
    case 'loco': return [
      deck,
      box(-w * 0.8, DECK, -h + 0.5, w * 0.8, DECK + 2.3, h - 4.8, Mat.Metal, 0x6b7a4a), // long hood
      box(-w, DECK, h - 4.6, w, DECK + 3.1, h - 0.4, Mat.Metal, 0x6b7a4a), // cab
      box(-w * 1.02, DECK + 3.1, h - 4.8, w * 1.02, DECK + 3.3, h - 0.2, Mat.Metal, 0x3a3d33), // cab roof
    ];
    case 'container': return [
      deck,
      box(-1.22, DECK, -h + 0.6, 1.22, DECK + 2.6, -0.3, Mat.Container, 0x7a2a22), // two 20 ft containers with a gap to stand in
      box(-1.22, DECK, 0.3, 1.22, DECK + 2.6, h - 0.6, Mat.Container, 0x2f5a3a),
    ];
    case 'gondola': return [
      deck,
      box(-w, DECK, -h, -w + 0.12, DECK + 1.1, h, Mat.Metal, 0x4a3b30), box(w - 0.12, DECK, -h, w, DECK + 1.1, h, Mat.Metal, 0x4a3b30),
      box(-w, DECK, -h, w, DECK + 1.1, -h + 0.12, Mat.Metal, 0x4a3b30), box(-w, DECK, h - 0.12, w, DECK + 1.1, h, Mat.Metal, 0x4a3b30),
    ];
    case 'flat': return [deck, box(-0.9, DECK, -1.5, 0.9, DECK + 1.2, 1.5, Mat.Wood, 0x7a5a3a)]; // a crate lashed to the deck
  }
}

export class Train {
  cars: TrainCar[] = [];
  s = 0; // arc position of the locomotive's front, metres
  private path: Float32Array; private cum: Float32Array; readonly len: number;
  /** cars that carry loot caches: [car index, local x, local z, legendary] */
  static CACHES: [number, number, number, boolean][] = [[1, 0, 0, true], [3, 0, 0, true], [4, 0, 2.5, false], [5, 0, 0, true], [6, 0, -2.5, false], [7, 0, 0, true]];

  constructor(private sim: Sim, path: Float32Array, start: number) {
    this.path = path;
    const n = path.length / 3; this.cum = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.cum[i + 1] = this.cum[i] + Math.hypot(path[j * 3] - path[i * 3], path[j * 3 + 2] - path[i * 3 + 2]); }
    this.len = this.cum[n];
    this.s = start % this.len;
    const kinds: [CarKind, number][] = [['loco', 17], ['container', 14], ['gondola', 13], ['container', 14], ['flat', 12], ['gondola', 13], ['container', 14], ['gondola', 13]];
    let off = 0;
    kinds.forEach(([kind, len], i) => {
      off += len / 2;
      const st = makeStructure(200000 + i, 'train', 0, 0, 0, 0, carParts(kind, len));
      this.cars.push({ kind, len, offset: off, st, px: 0, py: 0, pz: 0, pa: 0 });
      off += len / 2 + 1.2; // couplers
      sim.world.col.dyn.push(st);
    });
    this.place(0);
  }

  /** Point on the loop at arc length s. */
  at(s: number): [number, number, number] {
    s = ((s % this.len) + this.len) % this.len;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const n = this.path.length / 3, i = lo % n, j = (lo + 1) % n, t = (s - this.cum[lo]) / Math.max(1e-6, this.cum[lo + 1] - this.cum[lo]);
    const P = this.path;
    return [P[i * 3] + (P[j * 3] - P[i * 3]) * t, P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * t, P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * t];
  }

  /** Pose every car from its two bogies (front/back), so cars follow curves. */
  private place(dt: number) {
    for (const c of this.cars) {
      const st = c.st; c.px = st.x; c.py = st.y; c.pz = st.z; c.pa = st.angle;
      const sc = this.s - c.offset, a = this.at(sc + c.len * 0.35), b = this.at(sc - c.len * 0.35);
      st.x = (a[0] + b[0]) / 2; st.y = (a[1] + b[1]) / 2; st.z = (a[2] + b[2]) / 2;
      // local -z points along travel (towards a)
      st.angle = Math.atan2(-(a[0] - b[0]), -(a[2] - b[2])); st.cos = Math.cos(st.angle); st.sin = Math.sin(st.angle);
      if (dt === 0) { c.px = st.x; c.py = st.y; c.pz = st.z; c.pa = st.angle; }
    }
  }

  /** The car a player is standing on (feet on its top surface), if any. */
  carUnder(x: number, y: number, z: number): TrainCar | null {
    for (const c of this.cars) {
      const st = c.st, dx = x - st.x, dz = z - st.z;
      if (dx * dx + dz * dz > (c.len / 2 + 1) ** 2) continue;
      const lx = dx * st.cos - dz * st.sin, lz = dx * st.sin + dz * st.cos, ly = y - st.y;
      for (const p of st.parts) if (lx >= p.x0 - 0.4 && lx <= p.x1 + 0.4 && lz >= p.z0 - 0.4 && lz <= p.z1 + 0.4 && ly > p.y1 - 0.15 && ly < p.y1 + 0.45) return c; // within a body radius of the edge
    }
    return null;
  }

  update(dt: number) {
    // who is riding (before we move)
    const riders: [any, TrainCar][] = [];
    for (const p of this.sim.players) {
      if (!p.alive || (p.phase !== Phase.Alive && p.phase !== Phase.Downed)) continue;
      const c = this.carUnder(p.x, p.y, p.z); if (c) riders.push([p, c]);
    }
    this.s = (this.s + TRAIN_SPEED * dt) % this.len;
    this.place(dt);
    // carry riders with their car: rotate about the car's old centre, then translate
    for (const [p, c] of riders) {
      const st = c.st, da = st.angle - c.pa;
      const rx = p.x - c.px, rz = p.z - c.pz, co = Math.cos(da), si = Math.sin(da);
      const nx = rx * co + rz * si, nz = -rx * si + rz * co;
      const ddx = st.x + nx - p.x, ddz = st.z + nz - p.z, ddy = st.y - c.py;
      p.x += ddx; p.z += ddz; p.y += ddy; p.px += ddx; p.pz += ddz; p.py += ddy; p.fallStartY = p.y;
      if (p.bot) { p.yaw += da; p.intent.yaw += da; }
      else p.trainYaw = (p.trainYaw ?? 0) + da; // client applies this to the camera
    }
    // loot caches ride along
    for (const ch of this.sim.chests) {
      const tc = (ch as any).train as [number, number, number] | undefined; if (!tc) continue;
      const c = this.cars[tc[0]], st = c.st;
      ch.x = st.x + tc[1] * st.cos + tc[2] * st.sin; ch.z = st.z - tc[1] * st.sin + tc[2] * st.cos; ch.y = st.y + DECK;
    }
  }
}
