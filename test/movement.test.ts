import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { toWorld } from '../src/world/collision';

const world = generateWorld(loadMasksNode(), 1);

function freshPlayer(sim: Sim) {
  const p = sim.players[0];
  p.phase = 4; p.bot = false; p.vx = p.vy = p.vz = 0; p.onGround = true;
  for (const q of sim.players) if (q.id !== 0) { q.phase = 6; q.alive = false; }
  // keep one idle enemy alive far away, or the match ends (last squad standing) and the sim stops
  const e = sim.players[149]; Object.assign(e, { phase: 4, alive: true, bot: false, x: 3000, z: 300, y: 300 });
  return p;
}
function walk(sim: Sim, p: any, tx: number, tz: number, maxT = 20) {
  const t0 = sim.time;
  while (sim.time - t0 < maxT) {
    const dx = tx - p.x, dz = tz - p.z; if (Math.hypot(dx, dz) < 0.5) return true;
    p.intent.yaw = Math.atan2(-dx, -dz); p.intent.mz = 1; p.intent.mx = 0;
    sim.tick(1 / 60); sim.events.length = 0;
  }
  return false;
}

test('climb an apartment stair core to the roof', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const s = world.col.structures.find((q) => q.kind === 'block' && q.ramps.length >= 6 && Math.abs(q.by1 - 13) < 4)!;
  assert.ok(s, 'found a 3-4 floor block');
  const p = freshPlayer(sim);
  // stand at the foot of the first flight
  const r0 = s.ramps[0];
  const [sx, sz] = toWorld(s, (r0.x0 + r0.x1) / 2, r0.z0 - 0.6);
  p.x = sx; p.z = sz; p.y = s.y + 0.1; p.fallStartY = p.y;
  const heights: number[] = [];
  for (let i = 0; i < s.ramps.length; i++) {
    const r = s.ramps[i];
    const lx = (r.x0 + r.x1) / 2;
    const lo = r.dir === 1 ? r.z0 + 0.3 : r.z1 - 0.3, hi = r.dir === 1 ? r.z1 - 0.3 : r.z0 + 0.3;
    const [ax, az] = toWorld(s, lx, lo), [bx, bz] = toWorld(s, lx, hi);
    walk(sim, p, ax, az, 6); walk(sim, p, bx, bz, 8);
    heights.push(+(p.y - s.y).toFixed(2));
  }
  console.log('stair heights', heights.join(' '), 'roof at', (s.by1).toFixed(1));
  const roof = Math.max(...s.ramps.map((r) => r.y1));
  assert.ok(Math.max(...heights) > roof - 0.5, 'reached the roof');
  assert.ok(p.health >= 100, 'no fall damage on the stairs');
});

test('walk in through a house front door', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const s = world.col.structures.find((q) => q.kind === 'house' && q.parts.length > 20)!;
  const p = freshPlayer(sim);
  // front wall is at local z = bz0 + 0.1; door centred at x = 0
  const [ox, oz] = toWorld(s, 0, s.bz0 - 3), [ix, iz] = toWorld(s, 0, s.bz0 + 2.5);
  p.x = ox; p.z = oz; p.y = world.col.groundAt(ox, oz, s.y + 1); p.fallStartY = p.y;
  const ok = walk(sim, p, ix, iz, 8);
  console.log('door walk', ok, 'end local', (p.x - s.x).toFixed(1), (p.z - s.z).toFixed(1));
  assert.ok(ok, 'got inside through the doorway');
});

test('mantle onto a crate-height ledge', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  const s = world.col.structures.find((q) => q.kind === 'prop' && q.parts.length === 1 && q.parts[0].y1 > 2)!; // container (2.6 m)
  const [ox, oz] = toWorld(s, 0, -2.5);
  p.x = ox; p.z = oz; p.y = world.col.groundAt(ox, oz, s.y + 1); p.fallStartY = p.y;
  p.intent.yaw = Math.atan2(-(s.x - p.x), -(s.z - p.z)); p.intent.mz = 1;
  for (let i = 0; i < 90; i++) { if (i === 20) p.intent.jump = true; sim.tick(1 / 60); sim.events.length = 0; }
  console.log('mantle y', (p.y - s.y).toFixed(2));
  assert.ok(p.y - s.y > 2.2, 'on top of the container');
});

test('slide carries sprint momentum, slide-cancel pops back up', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  // flat open ground: the airport runway
  p.x = 900; p.z = 1302; p.y = world.col.groundAt(p.x, p.z, 200); p.fallStartY = p.y;
  p.intent.yaw = Math.PI / 2; p.intent.mz = 1; p.intent.sprint = true;
  for (let i = 0; i < 90; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  const x0 = p.x, sprintV = Math.hypot(p.vx, p.vz);
  p.intent.crouch = true;
  let peak = 0, t = 0;
  while (t < 1.5) { sim.tick(1 / 60); sim.events.length = 0; t += 1 / 60; peak = Math.max(peak, Math.hypot(p.vx, p.vz)); if (p.slideT <= 0 && t > 0.1) break; }
  const slideDist = Math.abs(p.x - x0);
  console.log('sprint', sprintV.toFixed(2), 'slide peak', peak.toFixed(2), 'slide time', t.toFixed(2), 'distance', slideDist.toFixed(1), 'stance', p.stance);
  assert.ok(peak > sprintV * 1.1, 'slide boosts speed');
  assert.ok(slideDist > 5 && slideDist < 12, 'slide covers ~5-12 m');
  // slide cancel
  for (let i = 0; i < 90; i++) { p.intent.crouch = false; sim.tick(1 / 60); sim.events.length = 0; }
  p.intent.crouch = true; sim.tick(1 / 60); sim.events.length = 0; // slide again
  for (let i = 0; i < 12; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  assert.ok(p.slideT > 0, 'second slide started');
  p.intent.crouch = true; sim.tick(1 / 60); sim.events.length = 0;
  assert.equal(p.stance, 0, 'slide cancel stands up');
});
