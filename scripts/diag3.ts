import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
const sim = new Sim(generateWorld(loadMasksNode(), 1), 7, { humans: 0 });
const last = new Map<number, { x: number; z: number; t: number }[]>();
while (!sim.over && sim.time < 1700) {
  sim.tick(1 / 60);
  if (Math.floor(sim.time * 2) !== Math.floor((sim.time - 1 / 60) * 2)) for (const p of sim.players) { if (!p.alive) continue; const a = last.get(p.id) ?? []; a.push({ x: p.x, z: p.z, t: sim.time }); if (a.length > 40) a.shift(); last.set(p.id, a); }
  for (const e of sim.events) if (e.t === 'kill' && e.w === 'gas') {
    const p = sim.players[e.victim], b = sim.brains[p.id], c = sim.circle, h = last.get(p.id) ?? [];
    const L = h[h.length - 1] ?? { x: p.x, z: p.z }, F = h[Math.max(0, h.length - 21)] ?? L; const moved = Math.hypot(L.x - F.x, L.z - F.z); const px = L.x, pz = L.z;
    console.log(`t=${sim.time.toFixed(0)} p${p.id} goal=${b.goal} tgt=${b.target} veh=${(p as any).vehicle !== undefined} out=${(Math.hypot(px - c.cx, pz - c.cz) - c.r).toFixed(0)}m moved10s=${moved.toFixed(0)}m pos=${px.toFixed(0)},${pz.toFixed(0)} terrain=${sim.world.hf.at(px, pz).toFixed(0)} water=${sim.world.col.waterAt(px, pz) > sim.world.hf.at(px, pz)} tx=${b.tx.toFixed(0)},${b.tz.toFixed(0)} phase=${p.phase}`);
  }
  sim.events.length = 0;
}
