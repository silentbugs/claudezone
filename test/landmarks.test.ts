import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';

const world = generateWorld(loadMasksNode(), 1);

/** Walk a player through waypoints given in a landmark's local frame; returns the final height above its base, or null if stuck. */
export function walkRoute(sim: Sim, f: { x: number; z: number; y: number; a: number }, start: number[], pts: number[][]): number | string {
  const c = Math.cos(f.a), s = Math.sin(f.a);
  const W = (lx: number, lz: number) => [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
  const L = (x: number, z: number) => { const dx = x - f.x, dz = z - f.z; return [dx * c - dz * s, dx * s + dz * c]; };
  const p: any = sim.players[0];
  const [sx, sz] = W(start[0], start[1]);
  Object.assign(p, { phase: 4, alive: true, x: sx, z: sz, y: world.col.groundAt(sx, sz, f.y + (start[2] ?? 0) + 1), vx: 0, vy: 0, vz: 0, onGround: true, mantleT: 0, stance: 0, health: 100 }); p.fallStartY = p.y;
  for (const [lx, lz] of pts) {
    const [tx, tz] = W(lx, lz);
    for (let t = 0; t < 600; t++) { const dx = tx - p.x, dz = tz - p.z; if (Math.hypot(dx, dz) < 0.35) break; p.intent.yaw = Math.atan2(-dx, -dz); p.intent.mz = 1; p.intent.mx = 0; sim.tick(1 / 60); sim.events.length = 0; }
    const [lx2, lz2] = L(p.x, p.z);
    if (Math.hypot(lx2 - lx, lz2 - lz) > 0.6) return `stuck before ${lx},${lz} at ${lx2.toFixed(1)},${lz2.toFixed(1)} y ${(p.y - f.y).toFixed(2)}`;
  }
  return +(p.y - f.y).toFixed(2);
}
function newSim() {
  const sim = new Sim(world, 1, { humans: 1 });
  for (const q of sim.players) if (q.id !== 0) { q.phase = 6; q.alive = false; }
  Object.assign(sim.players[149], { phase: 4, alive: true, bot: false, x: 3000, z: 300, y: 300 });
  sim.time = 200;
  return sim;
}
const frameOf = (kind: string, minR: number) => { const s = world.col.structures.find((q) => q.kind === kind && q.radius > minR)!; return { x: s.x, z: s.z, y: s.y, a: s.angle }; };

test('TV Station: foyer stairs, mezzanine, 2F, maintenance stair to roof, SW steps', () => {
  const sim = newSim(), f = frameOf('tvstation', 50);
  const routes: [string, number[], number[][], number][] = [
    ['foyer->mezzanine', [-40, 0], [[-32, 0], [-28, 0], [-21, 3.8], [-15, 3.8], [-13, 1.2], [-13, 8.3], [-13, 10.2], [-10, 11.5], [-8, 11.5]], 4.5],
    ['mezzanine->2F', [-8, 11.5, 4.5], [[-7, 6.2], [-4, 6.2], [0, 7], [20, 7]], 4.5],
    ['maintenance stair->roof', [50, -13], [[45, -13], [43, -13], [43.1, -13.2], [41.5, -12], [41.5, -6.5], [44.5, -6.5], [44.5, -13.5], [42, -14.3], [41.5, -12], [41.5, -6.5], [44.5, -6.5], [44.5, -13.5], [39, -14.3], [30, -14]], 9],
    ['SW steps->low roof', [-10, 26], [[-7, 26], [-5.6, 24.9], [8, 24.9], [10, 23]], 4.5],
  ];
  for (const [name, st, pts, want] of routes) {
    const r = walkRoute(sim, f, st, pts);
    console.log(name, r);
    assert.ok(typeof r === 'number' && Math.abs(r - want) < 0.5, name);
  }
});

test('Train Station: hall stairwell to the dome roof, pavilion stairs, back doors to the platform', () => {
  const sim = newSim(), f = frameOf('station', 60);
  const up = (xL: number, xR: number, zF: number, zB: number, n: number) => { const r: number[][] = []; for (let k = 0; k < n; k++) r.push([xL, zF + 0.1], [xL, zB - 0.4], [xR, zB - 0.4], [xR, zF + 0.1]); return r; };
  const routes: [string, number[], number[][], number][] = [
    ['front doors -> NE stair -> roof', [0, -16], [[0, -13], [0, -10], [6, 1.9], [9.7, 1.9], ...up(9.7, 13.1, 2, 10.8, 4), [9.5, 1.9], [6, 1.9]], 20],
    ['wing -> pavilion -> roof', [28, -12], [[28, -10], [28, -6], [29, -0.2], [46, -0.2], [58, 1.6], [62, 1.6], [66, -10.8], [70.5, -10.8], ...up(70.5, 73.4, -10.9, -2, 3), [70.4, -10.8], [66, -10.8]], 13.5],
    ['back doors -> platform', [-5, 8], [[-5, 11], [-5, 13], [-5, 18.5], [-5, 20]], 1.1],
  ];
  for (const [name, st, pts, want] of routes) {
    const r = walkRoute(sim, f, st, pts);
    console.log(name, r);
    assert.ok(typeof r === 'number' && Math.abs(r - want) < 0.6, name);
  }
});
