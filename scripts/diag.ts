import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { WEAPON } from '../src/data/weapons';
const sim = new Sim(generateWorld(loadMasksNode(), 1), 7, { humans: 0 });
const goals: Record<string, number> = {};
for (const T of [90, 180, 300, 450]) {
  while (sim.time < T) { sim.tick(1 / 60); sim.events.length = 0; }
  const cls: Record<string, number> = {}; let armor = 0, n = 0, items = 0;
  for (const p of sim.players) if (p.alive && p.phase === 4) { n++; armor += p.armor; const best = p.weapons.filter(Boolean).map((w) => WEAPON[w!.id].cls).sort().join('+'); cls[best] = (cls[best] ?? 0) + 1; }
  for (const b of sim.brains) if (sim.players[b.id].phase === 4) goals[b.goal] = (goals[b.goal] ?? 0) + 1;
  items = sim.items.filter((i) => i.alive && i.kind === 0).length;
  console.log(T, 'alive', n, 'avgArmor', (armor / n).toFixed(0), 'weaponsOnGround', items, JSON.stringify(cls), JSON.stringify(goals));
  for (const k in goals) delete goals[k];
}
