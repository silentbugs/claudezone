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
