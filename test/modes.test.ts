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
