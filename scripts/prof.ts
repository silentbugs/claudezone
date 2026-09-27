import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
const world = generateWorld(loadMasksNode(), 1);
const sim = new Sim(world, 7, { humans: 0 });
const t0 = Date.now();
while (sim.time < +(process.env.T || 150)) { sim.tick(1 / 60); sim.events.length = 0; }
console.log('sim', sim.time.toFixed(0), 'wall', Date.now() - t0);
