import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { Mat } from '../src/world/collision';

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
  // doors start closed (their random open state shifts whenever the map gains a door); routes push them open
  const d: any = sim.doors; d.open.fill(0); d.target.fill(0); for (let i = 0; i < d.count; i++) d.apply(i);
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
  // one on level ground (the exterior gantry foot sits outside the flattened footprint)
  const level = (q: any) => { const e = q.ramps.reduce((m: any, r: any) => (r.x0 > m.x0 ? r : m)); const [wx, wz] = [q.x + e.x0 * q.cos + (e.z0 - 1) * q.sin, q.z - e.x0 * q.sin + (e.z0 - 1) * q.cos]; return Math.abs(world.hf.at(wx, wz) - q.y) < 0.15; };
  const s = ws.find(level) ?? ws[0], f = { x: s.x, z: s.z, y: s.y, a: s.angle };
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

test('Military base: tent compound (through a wall gap into a tent, up to the upper container); hangar grass slope to the roof, rear corridor', () => {
  const sim = newSim();
  const bs = world.col.structures.find((q) => q.kind === 'barracks' && q.radius > 40)!;
  assert.ok(bs, 'barracks compound placed');
  const f = { x: bs.x, z: bs.z, y: bs.y, a: bs.angle };
  const r1 = walkRoute(sim, f, [-47, 0], [[-45, 0.2], [-41.5, 0.2], [-41.5, 4], [-38, 4], [-34, 4]]);
  console.log('wall gap -> tent', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - 0.2) < 0.4, 'inside a tent');
  const r2 = walkRoute(sim, f, [18, 18], [[20, 21.2], [23, 21.2], [26.5, 21.1], [32, 21.1]]);
  console.log('stair -> container walkway', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - 2.65) < 0.4, 'on the container walkway');
  const hs = world.col.structures.filter((q) => q.kind === 'hangar' && q.ramps.length === 2);
  assert.ok(hs.length >= 2, 'grass hangars placed');
  // a hangar whose grass ramp starts at ground level (placement on slopes varies with the map)
  const lvlOf = (q: any) => { const c = Math.cos(q.angle), sn = Math.sin(q.angle), x = q.x - 29 * c, z = q.z + 29 * sn; return Math.abs(world.col.groundAt(x, z, q.y + 3) - q.y); };
  const hh = [...hs].sort((u, v) => lvlOf(u) - lvlOf(v))[0];
  const h = { x: hh.x, z: hh.z, y: hh.y, a: hh.angle };
  const r3 = walkRoute(sim, h, [-29, 0], [[-26.3, 0], [-22, 0], [-2, 0]]);
  console.log('grass slope -> hangar roof', r3);
  assert.ok(typeof r3 === 'number' && Math.abs(r3 - 12.93) < 0.4, 'up the arched grass roof');
  const r4 = walkRoute(sim, h, [1, -20], [[1, -12], [1, 12], [1, 14.4], [1, 16], [1, 19.5], [1, 22]]);
  console.log('front -> rear corridor -> out', r4);
  assert.ok(typeof r4 === 'number', 'out through the rear door (the ground behind may be lower)');
});

test('Tenement (2020 D): front door -> west stairwell -> up 3 floors -> roof hut -> roof; 1F zig-zag corridor to the east stairwell', () => {
  const sim = newSim();
  const flatFront = (q: any) => { const hw = q.parts[0].x1 - 0.1, hd = q.parts[0].z1 - 0.1, lx = -hw + 5.3, lz = -hd - 2.5; return Math.abs(world.hf.at(q.x + lx * q.cos + lz * q.sin, q.z - lx * q.sin + lz * q.cos) - q.y) < 0.25; };
  const s = world.col.structures.find((q) => q.kind === 'tenement' && flatFront(q)) ?? world.col.structures.find((q) => q.kind === 'tenement')!;
  assert.ok(s, 'tenements placed');
  const f = { x: s.x, z: s.z, y: s.y, a: s.angle };
  const hw = s.parts[0].x1 - 0.1, hd = s.parts[0].z1 - 0.1, c = -hw + 4.5, ce = hw - 4.5, E = 0.45, H = 3.2, zc = -hd + 0.15 + 7.2;
  const up: number[][] = [];
  for (let k = 0; k < 3; k++) up.push([c - 0.75, -hd + 0.9], [c - 0.75, zc - 0.6], [c + 0.75, zc - 0.6], [c + 0.75, -hd + 0.9]);
  const r1 = walkRoute(sim, f, [c + 0.8, -hd - 2.5], [[c + 0.8, -hd - 0.6], [c + 0.8, -hd + 0.9], ...up, [c + 1.2, -hd + 0.9], [c + 3, -hd + 0.9], [c + 5, -hd + 1.5]]);
  console.log('stairwell -> roof', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - (E + 3 * H)) < 0.4, 'on the roof');
  const r2 = walkRoute(sim, f, [c + 0.8, -hd - 2.5], [[c + 0.8, -hd - 0.6], [c + 0.8, -hd + 0.9], [c + 3, -hd + 0.9], [c + 6.5, -hd + 0.9], [c + 6.5, 0], [0, 0], [ce - 6.5, 0], [ce - 6.5, -hd + 0.9], [ce - 1, -hd + 0.9]]);
  console.log('1F corridor W -> E stairwell', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - E) < 0.3, 'reached the east stairwell landing');
});

test('Prison: bridge -> barbican tunnel -> gate -> courtyard; arcade -> turret stairwell -> rampart -> turret top', () => {
  const sim = newSim();
  const bb = world.col.structures.find((q) => q.kind === 'barbican')!;
  assert.ok(bb, 'barbican');
  const fb = { x: bb.x, z: bb.z, y: bb.y, a: bb.angle };
  const r1 = walkRoute(sim, fb, [0, 34], [[0, 20], [0, 0], [0, -8], [0, -18.5], [0, -26]]);
  console.log('bridge -> courtyard', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1) < 0.4, 'in the courtyard');
  const tu = world.col.structures.find((q) => q.kind === 'prisonturret')!;
  const f = { x: tu.x, z: tu.z, y: tu.y, a: tu.angle };
  const L = 2 * 70 * Math.sin(Math.PI / 48) + 0.3, x0 = -L / 2;
  const up: number[][] = [];
  for (let k = 0; k < 3; k++) up.push([x0 + 0.8, 0.4], [-x0 - 0.7, 0.4], [-x0 - 0.7, 3.4], [x0 + 0.7, 3.4]);
  const r2 = walkRoute(sim, f, [0, -12], [[0.8, -7], [0.8, -3], [x0 + 1.2, -3], [x0 + 1.2, -0.5], [x0 + 0.8, -0.3], ...up, [x0 + 0.7, 4.6]]);
  console.log('arcade -> rampart', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - 15) < 0.4, 'on the rampart');
  const p: any = sim.players[0];
  p.yaw = p.intent.yaw = f.a + Math.PI; // face local +z (outward, the turret ladder)
  for (let t = 0; t < 6 * 60; t++) { p.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; if (p.y - f.y > 19.8 && p.onGround && p.mantleT <= 0) break; }
  p.intent.mz = 0;
  console.log('turret top', (p.y - f.y).toFixed(2));
  assert.ok(Math.abs(p.y - f.y - 20) < 0.4, 'on the turret top');
});

test('Gora Dam base: front doors -> control mezzanine; gantry stair -> roof helipad -> walkway -> spillway ledge', () => {
  const sim = newSim();
  const s = world.col.structures.find((q) => q.kind === 'damhall')!;
  assert.ok(s, 'generator hall placed');
  const f = { x: s.x, z: s.z, y: s.y, a: s.angle };
  const r1 = walkRoute(sim, f, [-2, 91], [[-2, 89], [-2, 86], [-2, 77], [-13.9, 72], [-13.9, 70.2], [-13.9, 79.5], [-13.9, 81], [-8, 82]]);
  console.log('front doors -> mezzanine', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - 4.6) < 0.4, 'on the control mezzanine');
  const r2 = walkRoute(sim, f, [17, 57], [[16.05, 59], [16.05, 84.5], [15, 85.5], [8, 80], [0, 70], [-13, 54], [-13, 30], [-13, 15.5]]);
  console.log('gantry -> roof -> walkway -> ledge', r2);
  assert.ok(typeof r2 === 'number' && Math.abs(r2 - 10.5) < 0.5, 'on the spillway ledge');
});

test('Killhouse: corner door into the maze; watchtower ladders to the top deck', () => {
  const sim = newSim();
  const s = world.col.structures.find((q) => q.kind === 'killhouse')!;
  assert.ok(s, 'killhouse placed');
  const f = { x: s.x, z: s.z, y: s.y, a: s.angle };
  const r1 = walkRoute(sim, f, [-13.45, -13], [[-13.45, -11], [-13.45, -8.5], [-11, -6.5], [-10.5, -4]]);
  console.log('corner door -> maze', r1);
  assert.ok(typeof r1 === 'number' && Math.abs(r1 - 0.05) < 0.4, 'inside the killhouse');
  const tx = -21, tz = -6, p: any = sim.players[0];
  walkRoute(sim, f, [tx - 3.5, tz - 1.2], [[tx - 2.6, tz - 1.2]]);
  const climb = (yaw: number, want: number) => { p.yaw = p.intent.yaw = yaw; for (let t = 0; t < 6 * 60; t++) { p.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; if (p.y - f.y > want - 0.2 && p.onGround && p.mantleT <= 0) break; } p.intent.mz = 0; return p.y - f.y; };
  const h1 = climb(f.a - Math.PI / 2, 3.6); // face local +x (the ladder on the west side)
  console.log('first deck', h1.toFixed(2));
  assert.ok(Math.abs(h1 - 3.6) < 0.4, 'on the first deck');
  walkRoute(sim, f, [tx + 1.2, tz - 0.6, 3.6], [[tx + 1.2, tz - 1.2]]);
  const h2 = climb(f.a, 7.2); // face local -z (the hatch ladder)
  console.log('top deck', h2.toFixed(2));
  assert.ok(Math.abs(h2 - 7.2) < 0.4, 'on the top deck');
});

test('two-storey house (2020 layout): front door -> through the room wall -> up the stair to the upper floor', () => {
  const sim = newSim();
  // houses with an inside stair and the front/back cross wall, standing on level ground
  const cands = world.col.structures.filter((q) => q.kind === 'house' && q.ramps.some((r) => r.mat !== Mat.Roof && r.y0 < 1 && r.y1 - r.y0 > 2.5));
  let ok = 0, tried = 0;
  for (const s of cands) {
    const r = s.ramps.find((q) => q.mat !== Mat.Roof && q.y0 < 1)!, hd = r.z1 + 0.2;
    const cross = s.parts.find((p) => p.mat === Mat.Plaster && p.y0 < 1.5 && p.z1 - p.z0 < 0.2 && Math.abs((p.z0 + p.z1) / 2 + hd * 0.12) < 0.1);
    if (!cross) continue;
    const f = { x: s.x, z: s.z, y: s.y, a: s.angle };
    const c = Math.cos(f.a), sn = Math.sin(f.a), gx = f.x + 0 * c + (-hd - 2.5) * sn, gz = f.z - 0 * sn + (-hd - 2.5) * c;
    if (Math.abs(world.col.groundAt(gx, gz, f.y + 2) - f.y) > 0.3) continue;
    if (tried >= 4) break; tried++;
    const zc = -hd * 0.12, zs = (r.z0 + r.z1) / 2;
    const res = walkRoute(sim, f, [0, -hd - 2.5], [[0, -hd + 0.8], [0, zc + 1.2], [r.x0 + 0.5, r.z0 - 0.6], [r.x0 + 0.4, zs], [r.x1 - 0.4, zs], [r.x1 + 0.9, zs]]);
    console.log('house stair walk', res);
    if (typeof res === 'number' && Math.abs(res - r.y1) < 0.4) ok++;
  }
  assert.ok(tried >= 2, 'found level two-storey houses');
  assert.equal(ok, tried, 'walked in and up the stair in every house tried');
});
