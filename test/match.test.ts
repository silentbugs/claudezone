import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';


test('150-bot match plays out', () => {
  const world = generateWorld(loadMasksNode(), 1);
  const sim = new Sim(world, 7, { humans: 0 });
  const dt = 1 / 60;
  const t0 = Date.now();
  const marks: Record<number, number> = {};
  const causes: Record<string, number> = {};
  const contracts: Record<string, number> = {};
  let kills = 0, downs = 0, gulags = 0, redeploys = 0, chests = 0, pickups = 0, shots = 0;
  let lastLog = 0;
  while (!sim.over && sim.time < 1800) {
    sim.tick(dt);
    for (const e of sim.events) {
      if (e.t === 'kill') { kills++; causes[e.w] = (causes[e.w] ?? 0) + 1; } else if (e.t === 'down') downs++; else if (e.t === 'gulag' && e.msg === 'fight') gulags++; else if (e.t === 'redeploy') redeploys++; else if (e.t === 'chest') chests++; else if (e.t === 'pickup') pickups++; else if (e.t === 'shot') shots++; else if (e.t === 'contract') contracts[e.kind + ':' + e.msg] = (contracts[e.kind + ':' + e.msg] ?? 0) + 1;
    }
    sim.events.length = 0;
    for (const m of [60, 150, 300, 600, 900, 1200]) if (sim.time >= m && marks[m] === undefined) marks[m] = sim.aliveCount;
    if (sim.time - lastLog > 120) {
      lastLog = sim.time;
      const ph: Record<string, number> = {};
      for (const p of sim.players) ph[p.phase] = (ph[p.phase] ?? 0) + 1;
      console.log(`t=${sim.time.toFixed(0)} alive=${sim.aliveCount} squads=${sim.squadsLeft()} circle=${sim.circle.phase}${sim.circle.closing ? 'c' : 'w'} r=${sim.circle.r.toFixed(0)} phases=${JSON.stringify(ph)} kills=${kills} downs=${downs} shots=${shots} wallms=${Date.now() - t0}`);
    }
  }
  const ms = Date.now() - t0;
  console.log('causes', JSON.stringify(causes));
  console.log('match', sim.time.toFixed(0), 's sim in', ms, 'ms; winner squad', sim.winner, 'alive', JSON.stringify(marks), { kills, downs, gulags, redeploys, chests, pickups, shots });
  console.log('bot contracts', JSON.stringify(contracts));
  assert.ok(Object.keys(contracts).some((k) => k.endsWith(':start')), 'bot squads take contracts');
  assert.ok(Object.keys(contracts).some((k) => k.endsWith(':done')), 'bot squads complete contracts');
  assert.ok(kills > 50, 'players should fight');
  assert.ok(sim.over || sim.time >= 1800);

});
