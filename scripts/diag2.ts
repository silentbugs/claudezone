import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { WEAPON } from '../src/data/weapons';
const sim = new Sim(generateWorld(loadMasksNode(), 1), 7, { humans: 0 });
while (sim.time < 300) { sim.tick(1 / 60); sim.events.length = 0; }
let n = 0;
for (const p of sim.players) {
  if (!p.alive || p.phase !== 4) continue;
  if (p.weapons.some((w) => w && WEAPON[w.id].cls !== 'pistol')) continue;
  const b = sim.brains[p.id];
  let wd = 1e9; for (const it of sim.items) if (it.alive && it.kind === 0 && WEAPON[it.weapon!].cls !== 'pistol') wd = Math.min(wd, Math.hypot(it.x - p.x, it.z - p.z));
  let cd = 1e9; for (const c of sim.chests) if (!c.opened) cd = Math.min(cd, Math.hypot(c.x - p.x, c.z - p.z));
  const x0 = p.x, z0 = p.z;
  console.log(p.id, 'goal', b.goal, 'target', b.target, 'item', b.itemId, 'itemT', b.itemT.toFixed(1), 'tgtDist', Math.hypot(b.tx - p.x, b.tz - p.z).toFixed(0), 'nearestWeapon', wd.toFixed(0), 'nearestChest', cd.toFixed(0), 'y-ground', (p.y - sim.world.hf.at(p.x, p.z)).toFixed(1), 'gulagUsed', p.gulagUsed, 'cash', p.cash);
  if (++n > 14) break;
  void x0; void z0;
}
