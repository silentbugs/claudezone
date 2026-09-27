import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';

test('warm-up respawns then loads everyone into the plane', () => {
  const sim = new Sim(generateWorld(loadMasksNode(), 1), 3, { humans: 0, warmup: 30 });
  let kills = 0, infil = false;
  while (sim.time < 31) { sim.tick(1 / 60); for (const e of sim.events) { if (e.t === 'kill') kills++; if (e.t === 'announce' && e.text === '__infil__') infil = true; } sim.events.length = 0; }
  console.log('warmup kills', kills);
  assert.ok(infil);
  assert.equal(sim.players.filter((p) => p.phase === 1).length, 150);
  assert.ok(sim.players.every((p) => p.kills === 0 && p.cash === 0));
  while (sim.time < 120) { sim.tick(1 / 60); sim.events.length = 0; }
  assert.ok(sim.players.filter((p) => p.phase === 4).length > 100, 'most have landed by 90 s after infil');
});
