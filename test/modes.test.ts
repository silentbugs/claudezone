import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';

const world = generateWorld(loadMasksNode(), 1);

test('Solos / Duos / Trios squad sizes and down rules', () => {
  for (const size of [1, 2, 3]) {
    const sim = new Sim(world, 5, { humans: 0, squadSize: size });
    const squads = new Set(sim.players.map((p) => p.squad));
    assert.equal(squads.size, Math.ceil(150 / size), `${size}: squad count`);
    assert.ok([...squads].every((s) => sim.players.filter((p) => p.squad === s).length <= size));
    // put two enemies on the ground and shoot one to 0: downed only when a teammate is still up
    for (const p of sim.players) { p.phase = 4; p.alive = true; p.health = 100; p.armor = 0; }
    const v = sim.players[0], a = sim.players[149];
    sim.damage(v, 500, a.id, 'm4', false, true);
    assert.equal(v.phase, size === 1 ? 8 /* straight to the Gulag queue */ : 5 /* downed */, `${size}: phase after lethal damage`);
    if (size === 1) assert.ok(sim.buy(v, 'buyback') !== null && sim.buy(v, 'selfRevive') !== null, 'no buyback / self-revive in Solos');
  }
});

test('backpack drops: weapon, ammo stack, plate, cash, equipment; not re-collected by the dropper at once', () => {
  const sim = new Sim(world, 5, { humans: 1 });
  const p = sim.players[0];
  for (const q of sim.players) if (q.id !== 0) { q.phase = 6; q.alive = false; }
  Object.assign(sim.players[149], { phase: 4, alive: true, bot: false, x: 3000, z: 300, y: 300 });
  sim.time = 200;
  Object.assign(p, { phase: 4, alive: true, x: 1470, z: 2330, vx: 0, vz: 0, vy: 0, onGround: true, cash: 2500, plates: 3 });
  p.y = world.col.groundAt(p.x, p.z, 300); p.fallStartY = p.y;
  p.weapons = [{ id: 'm4', rarity: 1, mag: 30 }, { id: 'mp5', rarity: 1, mag: 30 }]; p.cur = 0; p.ammo.heavy = 100;
  p.lethal = { type: 'frag', n: 2 };
  const before = sim.items.length;
  assert.ok(sim.dropFromBackpack(p, 'weapon', 0));
  assert.equal(p.weapons[0], null); assert.equal(p.cur, 1, 'switched to the other gun');
  assert.ok(sim.dropFromBackpack(p, 'ammo', 'heavy')); assert.equal(p.ammo.heavy, 70);
  assert.ok(sim.dropFromBackpack(p, 'plate')); assert.equal(p.plates, 2);
  assert.ok(sim.dropFromBackpack(p, 'cash', 1000)); assert.equal(p.cash, 1500);
  assert.ok(sim.dropFromBackpack(p, 'lethal')); assert.equal(p.lethal, null);
  assert.ok(!sim.dropFromBackpack(p, 'killstreak'), 'nothing to drop');
  assert.equal(sim.items.length - before, 6, '6 items on the ground (2 frags)');
  // walk over them: the dropper doesn't vacuum them straight back up
  for (let t = 0; t < 60; t++) { p.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; }
  assert.equal(p.cash, 1500, 'cash left for the squad');
});

test('contracts (2020): objectives inside the circle, scavenger timer extends per box, recon flare + capture, most wanted payout, bounty pays on any kill', () => {
  const mk = () => { const s = new Sim(world, 1, { humans: 1 }); s.time = 120; const p: any = s.players[0]; Object.assign(p, { phase: 4, alive: true, bot: false }); const c = s.circle; p.x = c.cx + 50; p.z = c.cz; p.y = world.hf.at(p.x, p.z); return { s, p }; };
  const accept = (s: any, p: any, kind: string) => { const c = s.contracts.find((k: any) => !k.taken); c.kind = kind; (s as any).acceptContract(p, c.id); return s.active.find((a: any) => a.squad === p.squad); };
  // recon
  { const { s, p } = mk(); const a = accept(s, p, 'recon'); assert.ok(a, 'recon accepted');
    assert.ok(Math.hypot(a.zx - s.circle.cx, a.zz - s.circle.cz) < s.circle.r, 'recon zone inside the circle');
    p.x = a.zx; p.z = a.zz; p.y = a.zy; let flare = false, done = false;
    for (let i = 0; i < 60 * 30; i++) { s.tick(1 / 60); for (const e of s.events) { if (e.t === 'flare') flare = true; if (e.t === 'contract' && e.msg === 'done') done = true; } s.events.length = 0; p.x = a.zx; p.z = a.zz; if (done) break; }
    assert.ok(flare && done, 'recon: flare went up and the capture completed'); }
  // scavenger: opening a box adds time
  { const { s, p } = mk(); const a = accept(s, p, 'scavenger'); const t0 = a.t; const ch = s.chests.find((c: any) => c.id === a.chest);
    assert.ok(Math.hypot(ch!.x - s.circle.cx, ch!.z - s.circle.cz) < s.circle.r, 'box inside the circle');
    ch!.opened = true; s.tick(1 / 60); assert.ok(a.t > t0 + 60, 'timer extended after the first box'); assert.equal(a.step, 1); }
  // most wanted: survive the timer
  { const { s, p } = mk(); const a = accept(s, p, 'mostwanted'); const cash = p.cash; a.t = 0.05; for (let i = 0; i < 6; i++) s.tick(1 / 60); assert.ok(p.cash >= cash + 3000, 'most wanted payout'); }
  // bounty: another squad's kill still pays
  { const { s, p } = mk(); const e: any = s.players.find((q: any) => q.squad !== p.squad); Object.assign(e, { phase: 4, alive: true, x: p.x + 200, z: p.z, y: world.hf.at(p.x + 200, p.z) });
    const a = accept(s, p, 'bounty'); assert.ok(a, 'bounty accepted'); const tgt = s.players[a.target]; const cash = p.cash;
    const other: any = s.players.find((q: any) => q.squad !== p.squad && q.squad !== tgt.squad); (s as any).kill(tgt, other.id, 'm4', false, false);
    assert.ok(p.cash >= cash + 1000, 'bounty paid when someone else killed the target'); }
});

test('heartbeat sensor: held up while the key is down (no firing), never runs out, lowered on release', () => {
  const s = new Sim(world, 1, { humans: 1 }); s.time = 120;
  const p: any = s.players[0]; Object.assign(p, { phase: 4, alive: true, bot: false }); p.x = s.circle.cx; p.z = s.circle.cz; p.y = world.hf.at(p.x, p.z);
  p.tactical = { type: 'heartbeat', n: 1 }; p.weapons = [{ id: 'm4', rarity: 0, mag: 30 }, null]; p.cur = 0;
  let shots = 0;
  for (let i = 0; i < 120; i++) { p.intent.tacHeld = true; p.intent.fire = true; s.tick(1 / 60); shots += s.events.filter((e: any) => e.t === 'shot').length; s.events.length = 0; }
  assert.ok(p.hbOn, 'sensor up while held'); assert.equal(shots, 0, 'no firing with the sensor up'); assert.ok(p.tactical, 'never runs out');
  p.intent.tacHeld = false; s.tick(1 / 60); assert.ok(!p.hbOn, 'lowered on release'); assert.ok(p.tactical, 'still carried');
});

test('helicopter: bail out mid-air and it drops, crashes and explodes on the players below (kill credited to the pilot)', async () => {
  const { enterVehicle, exitVehicle } = await import('../src/sim/vehicles');
  const s = new Sim(world, 1, { humans: 1 }); s.time = 120;
  const v = s.vehicles.find((q: any) => q.type === 'heli')!;
  const pilot: any = s.players[0], e: any = s.players.find((q: any) => q.squad !== pilot.squad)!, other: any = s.players.find((q: any) => q.squad !== pilot.squad && q.squad !== e.squad)!;
  for (const q of [pilot, e, other]) Object.assign(q, { phase: 4, alive: true, bot: false });
  const gx = s.circle.cx, gz = s.circle.cz, gy = world.col.groundAt(gx, gz, 500);
  Object.assign(e, { x: gx, z: gz, y: gy, health: 100, armor: 0 }); Object.assign(other, { x: gx + 400, z: gz, y: world.hf.at(gx + 400, gz) });
  Object.assign(v, { x: gx, z: gz + 6, y: gy + 70, vx: 0, vy: 0, vz: -3, rotor: 1 });
  Object.assign(pilot, { x: v.x, z: v.z, y: v.y });
  enterVehicle(s, pilot, v); s.tick(1 / 60); exitVehicle(s, pilot);
  let exploded = false, credited = false;
  for (let i = 0; i < 60 * 8 && !exploded; i++) { s.tick(1 / 60); for (const ev of s.events as any[]) { if (ev.t === 'explosion' && ev.kind === 'vehicle' && Math.hypot(ev.x - v.x, ev.z - v.z) < 5) exploded = true; if ((ev.t === 'down' || ev.t === 'kill') && ev.victim === e.id && ev.attacker === pilot.id) credited = true; } s.events.length = 0; }
  assert.ok(exploded && !v.alive, 'the helicopter crashed and exploded');
  assert.ok(e.phase === 5 || !e.alive, 'the player below went down');
  assert.ok(credited, 'the pilot gets the credit');
  assert.ok(pilot.alive && (pilot.phase === 2 || pilot.phase === 3), 'the pilot is skydiving / parachuting');
});

test('vehicles (2020): ATV / Rover / SUV hit top speed in ~1 s, the Cargo Truck takes several seconds', async () => {
  const { updateVehicles, makeVehicle, VEHICLES } = await import('../src/sim/vehicles');
  // flat, empty stub world: measures the drive model alone
  const col = { groundAt: () => 0, pushOut: (_x: number, _y: number, _z: number, _h: number, _r: number, _s: number, out: any) => { out.hit = false; }, waterAt: () => -99 };
  const times: Record<string, number> = {};
  for (const type of ['atv', 'rover', 'suv', 'truck'] as const) {
    const v: any = makeVehicle(0, type, 1000, 0, 1000, 0);
    const p: any = { id: 0, alive: true, phase: 4, vehicle: 0, intent: { mz: 1, mx: 0 } };
    v.seats[0] = 0;
    const sim: any = { vehicles: [v], players: [p], world: { col, hf: { size: 4000 } }, playersNear: () => [], damage() {}, emit() {} };
    let t = 0; while (t < 10 && v.speed < VEHICLES[type].maxSpeed * 0.9) { updateVehicles(sim, 1 / 60); t += 1 / 60; }
    times[type] = +t.toFixed(2);
    // bail out at speed: the empty vehicle scrubs its speed within about a second (2020)
    p.vehicle = undefined; for (let i = 0; i < 72; i++) updateVehicles(sim, 1 / 60);
    assert.ok(v.speed < 1.5, `${type} stops quickly once nobody drives it (${v.speed.toFixed(1)} m/s after 1.2 s)`);
  }
  console.log('0 -> 90% top speed (s)', JSON.stringify(times));
  for (const k of ['atv', 'rover', 'suv']) assert.ok(times[k] < 1.6, `${k} reaches top speed fast (${times[k]} s)`);
  assert.ok(times.truck > 2.5, `the Cargo Truck is slow to get going (${times.truck} s)`);
});

test('recon (2020): each completed recon reveals one more future circle; untaken tablets in the gas burn out after a few seconds', () => {
  const s: any = new Sim(world, 3, { humans: 1 }); s.time = 120;
  const me = s.players[0];
  assert.equal(s.revealedCircles(me.squad).length, 0);
  for (let n = 1; n <= 3; n++) {
    s.active.push({ kind: 'recon', squad: me.squad, t: 100, zx: me.x, zz: me.z, zy: me.y, progress: 999, flare: true });
    Object.assign(me, { phase: 4, alive: true });
    s.updateContracts(1 / 60);
    assert.equal(s.revealedCircles(me.squad).length, n, `recon #${n} shows ${n} circle(s) ahead`);
  }
  const [a, b] = s.revealedCircles(me.squad);
  assert.ok(Math.hypot(a.x - s.circle.nx, a.z - s.circle.nz) + a.r <= s.circle.nr + 0.01, 'each revealed circle sits inside the one before');
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) + b.r <= a.r + 0.01);
  // shrink the circle so a tablet ends up in the gas
  const k = s.contracts.find((c: any) => !c.taken);
  Object.assign(s.circle, { cx: k.x + 900, cz: k.z, r: 300 });
  s.updateContracts(1 / 60); assert.ok(!k.taken, 'not instantly');
  s.time += 7; s.events.length = 0; s.updateContracts(1 / 60);
  assert.ok(k.taken && k.gone, 'destroyed a few seconds later');
  assert.ok(s.events.some((e: any) => e.t === 'contractGone'));
});
