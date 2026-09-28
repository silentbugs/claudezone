import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { TRAIN_SPEED } from '../src/sim/train';

const world = generateWorld(loadMasksNode(), 1);

test('freight train loops the south-west line and carries a rider', () => {
  const sim = new Sim(world, 7, { humans: 1 });
  const tr = sim.train!;
  assert.ok(tr, 'train exists');
  console.log('loop length', Math.round(tr.len), 'm, lap', (tr.len / TRAIN_SPEED / 60).toFixed(1), 'min, cars', tr.cars.length);
  assert.ok(tr.len > 3000 && tr.len < 9000);
  // track stays on/near the ground and above the sea
  let maxGap = 0, minY = 1e9;
  for (let s = 0; s < tr.len; s += 10) { const [x, y, z] = tr.at(s); maxGap = Math.max(maxGap, Math.abs(y - 0.35 - world.hf.at(x, z))); minY = Math.min(minY, y); }
  console.log('max bed/terrain gap', maxGap.toFixed(2), 'min rail y', minY.toFixed(2));
  assert.ok(maxGap < 1.0, 'terrain flattened under the track');
  assert.ok(minY > 1.5, 'above the sea');
  // stand a player on the middle of car 2 (a gondola floor) and ride for 20 s
  const p = sim.players[0];
  for (const q of sim.players) if (q.id !== 0) { q.phase = 6; q.alive = false; }
  const e = sim.players[149]; Object.assign(e, { phase: 4, alive: true, bot: false, x: 3000, z: 300, y: 300 });
  sim.time = 200; // past warm-up / plane
  const c = tr.cars[2], st = c.st;
  Object.assign(p, { phase: 4, alive: true, bot: false, x: st.x, z: st.z, y: st.y + 1.3, vx: 0, vy: 0, vz: 0, onGround: true, fallStartY: st.y + 1.3 });
  p.px = p.x; p.py = p.y; p.pz = p.z;
  const x0 = p.x, z0 = p.z;
  let off = 0;
  for (let t = 0; t < 20 * 60; t++) {
    p.intent.mx = 0; p.intent.mz = 0; sim.tick(1 / 60); sim.events.length = 0;
    const dx = p.x - c.st.x, dz = p.z - c.st.z; off = Math.max(off, Math.hypot(dx, dz), Math.abs(p.y - (c.st.y + 1.3)));
  }
  const moved = Math.hypot(p.x - x0, p.z - z0);
  console.log('rider moved', moved.toFixed(0), 'm, max offset from car centre', off.toFixed(2), 'hp', p.health);
  assert.ok(moved > 150, 'carried along');
  assert.ok(off < 1.0, 'stayed on the car');
  assert.ok(p.health >= 100, 'no fall damage');
});

test('parachute onto the moving train', () => {
  const sim = new Sim(world, 9, { humans: 1 });
  const tr = sim.train!;
  for (const q of sim.players) if (q.id !== 0) { q.phase = 6; q.alive = false; }
  const e = sim.players[149]; Object.assign(e, { phase: 4, alive: true, bot: false, x: 3000, z: 300, y: 300 });
  sim.time = 200;
  const p = sim.players[0];
  // aim for car 3, leading it by the train's travel during the descent (~40 m of fall at chute speed)
  const c = tr.cars[3];
  const fall = 40, tFall = fall / 5.2, [lx, , lz] = tr.at(tr.s - c.offset + 10 * tFall);
  Object.assign(p, { phase: 3, alive: true, bot: false, x: lx, z: lz, y: c.st.y + 1.3 + fall, vx: 0, vy: -5, vz: 0 });
  p.px = p.x; p.py = p.y; p.pz = p.z; p.intent.mx = 0; p.intent.mz = 0;
  let landedOn: any = null;
  for (let t = 0; t < 20 * 60 && !landedOn; t++) {
    // steer toward the car like a player would
    const dx = c.st.x - p.x, dz = c.st.z - p.z; p.yaw = p.intent.yaw = Math.atan2(-dx, -dz); p.intent.mz = Math.hypot(dx, dz) > 2 ? 1 : 0;
    sim.tick(1 / 60); sim.events.length = 0;
    if (p.phase === 4) landedOn = tr.carUnder(p.x, p.y, p.z);
  }
  for (let t = 0; t < 120; t++) { p.intent.mz = 0; sim.tick(1 / 60); sim.events.length = 0; }
  console.log('landed on car', landedOn ? tr.cars.indexOf(landedOn) : 'none', 'still on train', !!tr.carUnder(p.x, p.y, p.z), 'hp', p.health);
  assert.ok(landedOn, 'landed on a car');
  assert.ok(tr.carUnder(p.x, p.y, p.z), 'riding afterwards');
});
