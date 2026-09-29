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
  for (const [lx, lz, jump] of pts) {
    const [tx, tz] = W(lx, lz);
    // a third value on a waypoint = keep jumping on the way (mantle up crates / ledges)
    for (let t = 0; t < 600; t++) { const dx = tx - p.x, dz = tz - p.z; if (Math.hypot(dx, dz) < 0.35) break; p.intent.yaw = Math.atan2(-dx, -dz); p.intent.mz = 1; p.intent.mx = 0; if (jump && t % 15 === 0) p.intent.jump = true; sim.tick(1 / 60); sim.events.length = 0; }
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

test('Hospital: foyer -> west stair -> 3F -> skybridge -> tower ascender to the roof; cafeteria -> east stair -> roof', () => {
  const sim = newSim(), f = frameOf('hospital', 60);
  const up = (xL: number, xR: number, zF: number, zB: number, n: number) => { const r: number[][] = []; for (let k = 0; k < n; k++) r.push([xL, zF + 0.1], [xL, zB - 0.4], [xR, zB - 0.4], [xR, zF + 0.1]); return r; };
  const r1 = walkRoute(sim, f, [-4, 28], [[-4, 25], [-4, 22], [-8, 2.7], [-11, 2.7], [-14.5, 2.7], ...up(-14.5, -11.5, 2.6, 13.6, 1), [-11.4, 2.7], [-9, 2.7], [-9, 15], [-17, 15], [-20, 12], [-33, 12], [-33, 9], [-33, 4], [-32.5, 1], [-32.5, -1], [-32.5, -7], [-32.5, -13], [-32.8, -15.5], [-33.5, -19], [-33.5, -22.5], [-31.6, -24], [-31.6, -28.2], [-32.3, -28.2]]);
  console.log('foyer -> tower 3F lift door', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - 7) < 0.5, 'reached the tower 3F');
  // ride the tower ascender
  const p: any = sim.players[0];
  const c = Math.cos(f.a), s = Math.sin(f.a);
  const a = sim.world.ascenders.reduce((m, q) => (Math.hypot(q.x - (f.x + -33.8 * c + -28.2 * s), q.z - (f.z - -33.8 * s + -28.2 * c)) < Math.hypot(m.x - (f.x + -33.8 * c + -28.2 * s), m.z - (f.z - -33.8 * s + -28.2 * c)) ? q : m));
  p.yaw = p.intent.yaw = Math.atan2(a.nx, a.nz);
  const t = sim.interactTarget(p);
  assert.equal(t?.kind, 'ascender', 'ascender in reach');
  p.intent.mz = 0; p.intent.mx = 0;
  p.intent.interact = true; sim.tick(1 / 60); p.intent.interact = false; sim.events.length = 0;
  for (let i = 0; i < 12 * 60; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  console.log('tower roof', (p.y - f.y).toFixed(2));
  assert.ok(Math.abs(p.y - f.y - 35) < 0.5 && p.onGround, 'on the tower roof');
  const r2 = walkRoute(sim, f, [17, -28], [[20, -28], [23, -28], [30, -27], [33.9, -17], [33.9, -13], [36, -14.1], [39.5, -14.1], ...up(40.3, 43.3, -14.8, -2.6, 2), [39.3, -14.1], [37, -14.1]]);
  console.log('cafeteria -> east stair -> roof', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - 12) < 0.5, 'reached the roof');
});

test('Airport control tower: courtyard door, ascender to the office level, stairs into the cab', () => {
  const sim = newSim(), f = frameOf('ctower', 8);
  const r1 = walkRoute(sim, f, [0, 18], [[0, 12], [0, 7], [0, 5.9], [0, 4.6], [0, 1.9]]);
  console.log('into the tower base', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1) < 0.3, 'inside the base');
  const p: any = sim.players[0];
  p.intent.mz = 0; p.yaw = p.intent.yaw = 0; // face the lift (north, -z)
  const t = sim.interactTarget(p);
  assert.equal(t?.kind, 'ascender');
  p.intent.interact = true; sim.tick(1 / 60); p.intent.interact = false; sim.events.length = 0;
  for (let i = 0; i < 10 * 60; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  console.log('office level', (p.y - f.y).toFixed(2));
  assert.ok(Math.abs(p.y - f.y - 42) < 0.4, 'at the office level');
  const r2 = walkRoute(sim, f, [0, 1.8, 42], [[2.5, 2.5], [2.5, -5.2], [4.4, -5.2], [4.4, 3.8], [4.4, 5.5], [0, 6.5]]);
  console.log('into the cab', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - 46) < 0.4, 'in the cab');
});

test('Superstore: front doors, SW stairwell to the 2F offices and out onto the annex roof; east gantry, balcony ladder to the roof', () => {
  const sim = newSim(), f = frameOf('superstore', 60);
  const up1 = (xL: number, xR: number, zF: number, zB: number) => [[xL, zF + 0.1], [xL, zB - 0.4], [xR, zB - 0.4], [xR, zF + 0.1]];
  const r1 = walkRoute(sim, f, [-20, 42], [[-20, 38], [-20, 33], [-17.5, 32], [-17.5, 17.2], [-38, 17.2], [-38, 16.5], [-42, 16.5], [-50, 21.6], [-53, 21.6], [-56.3, 21.8], ...up1(-56.3, -53.3, 21, 36.8), [-50, 21.7], [-47.3, 21.8], [-47.3, 14.5], [-57.5, 14.5], [-60, 14.5], [-65, 14.5]]);
  console.log('front -> SW stair -> annex roof', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - 4.2) < 0.4, 'on the annex roof');
  const r2 = walkRoute(sim, f, [62, -10], [[59.2, -7], [59.2, 14], [59.7, 20], [59.7, 33.2]]);
  console.log('east gantry -> balcony', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - 4.2) < 0.4, 'on the balcony');
});

test('Fire station: garage, stair to the crew quarters, hose tower ladder to the lookout; gas station roof and canopy', () => {
  const sim = newSim(), f = frameOf('firestation', 5);
  const r = walkRoute(sim, f, [-10, 7], [[-8, 7], [-4, 7], [6.2, 7], [6.2, 0.9], [3.5, 0.9], [3.5, -2.5], [-5.8, -2.5], [-5.8, -0.9], [2.8, -0.9], [4.5, -2], [6.5, -5], [8.2, -5], [10, -6.3]]);
  console.log('fire station -> tower base (2F)', r);
  assert.ok(typeof r === 'number' && Math.abs(r - 3.25) < 0.4, 'in the tower at 2F');
  const p: any = sim.players[0];
  const c = Math.cos(f.a), s = Math.sin(f.a);
  p.yaw = p.intent.yaw = f.a - Math.PI / 2; // face +x (the ladder's wall)
  for (let t = 0; t < 6 * 60; t++) { p.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; if (p.y - f.y > 10.8 && p.onGround && p.mantleT <= 0) break; }
  p.intent.mz = 0;
  console.log('after ladder', (p.y - f.y).toFixed(2)); void c; void s;
  assert.ok(Math.abs(p.y - f.y - 11) < 0.5, 'in the lookout room');
  const g = frameOf('gasstation', 5);
  const r2 = walkRoute(sim, g, [3.5, 9], [[3.5, 8.2], [3.5, 7.6]]);
  void r2;
  const q: any = sim.players[0];
  q.yaw = q.intent.yaw = g.a; // face local -z (the rear wall and its ladder)
  for (let t = 0; t < 5 * 60; t++) { q.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; if (q.y - g.y > 3.5 && q.onGround && q.mantleT <= 0) break; }
  q.intent.mz = 0;
  console.log('gas station roof', (q.y - g.y).toFixed(2));
  assert.ok(q.y - g.y > 3.5, 'up the rear ladder');
});

test('Warehouse (2020 K): side door -> west gantry stair -> mezzanine office; exterior gantry -> upper door', () => {
  const sim = newSim();
  const ws = world.col.structures.filter((q) => q.kind === 'warehouse' && q.ramps.length >= 3);
  assert.ok(ws.length > 0, 'warehouses with gantries exist');
  const s = ws[0], f = { x: s.x, z: s.z, y: s.y, a: s.angle };
  const ext = s.ramps.reduce((m, r) => (r.x0 > m.x0 ? r : m));
  const hw = ext.x0 - 0.2, hd = ext.z1 + 4.4, mz = hd - 5, run = 5.2, my = 3.6;
  const ow = Math.min(10, hw * 2 - 8) / 2, oz = mz + 0.6;
  const r1 = walkRoute(sim, f, [-hw - 2.5, -hd + 2.25], [[-hw - 0.8, -hd + 2.25], [-hw + 1, -hd + 2.25], [-hw + 1.05, -hd + 4], [-hw + 1.05, mz - run - 0.8], [-hw + 1.05, mz + 0.6], [-ow - 0.8, mz + 0.6], [-ow - 0.8, oz + 1.1], [-ow + 1, oz + 1.1]]);
  console.log('side door -> gantry -> office', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - my) < 0.4, 'reached the mezzanine office');
  const dz = hd - 3.7;
  const r2 = walkRoute(sim, f, [hw + 3, mz - run - 3], [[hw + 0.85, mz - run - 1], [hw + 0.85, dz], [hw - 1, dz], [hw - 3, dz]]);
  console.log('exterior gantry -> upper door', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - my) < 0.4, 'through the upper door onto the mezzanine');
});

test('Airport terminal: Departures -> check-in -> double stairs -> checkpoint -> crate stack -> mezzanine -> 3F road; east stairs to the café; maintenance stairs', () => {
  const sim = newSim(), f = frameOf('terminal', 60);
  const T = (pts: number[][]) => pts.map(([x, z, j]) => (j ? [x - 20, z - 4, j] : [x - 20, z - 4]));
  const S = (x: number, z: number, y = 0) => [x - 20, z - 4, y];
  const routes: [string, number[], number[][], number][] = [
    ['departures -> stairs -> crates -> mezzanine -> 3F road', S(-26, 31), T([[-26, 27], [-26, 22], [1, 20], [1, 19], [1, 5], [1, 3], [5, 3], [5, -16], [0.3, -16.5], [0.3, -14.2, 1], [0.3, -12.7, 1], [0.3, -11.2, 1], [0.3, -9.2, 1], [0.3, -7], [4, -6], [4, 4], [12, 4], [12, 8], [12, 24], [12, 26], [12, 28]]), 10.5],
    ['2F concourse -> east double stairs -> café', S(45, -20, 5.5), T([[50, -20], [50, -16], [50, -2], [50, 4], [48.5, 4], [44, 4]]), 0.05],
    ['maintenance stairs -> 2F', S(-56.5, -28), T([[-56.5, -26], [-56.5, -24], [-56.5, -23], [-56.5, -14.8], [-56.5, -13.7], [-53.6, -13.7], [-53.6, -23.6], [-53.6, -24.3], [-50, -24.3]]), 5.5],
  ];
  for (const [name, st, pts, want] of routes) {
    const r = walkRoute(sim, f, st, pts);
    console.log(name, r);
    assert.ok(typeof r === 'number' && Math.abs(r - want) < 0.5, name);
  }
});
