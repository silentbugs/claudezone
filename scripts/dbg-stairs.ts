import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { toWorld, toLocal } from '../src/world/collision';
const world = generateWorld(loadMasksNode(), 1);
const sim = new Sim(world, 1, { humans: 1 });
const s = world.col.structures.find((q) => q.kind === 'block' && q.ramps.length >= 6 && Math.abs(q.by1 - 13) < 4)!;
const p = sim.players[0]; p.phase = 4; for (const q of sim.players) if (q.id) { q.phase = 6; q.alive = false; }
const r = s.ramps[5];
console.log('ramp5', JSON.stringify(r));
const lx = (r.x0 + r.x1) / 2;
const [ax, az] = toWorld(s, -0.65, 5.11), [bx, bz] = toWorld(s, lx, r.z0 + 0.3);
const [lox, loz] = toWorld(s, lx, r.z1 - 0.3);
p.x = ax; p.z = az; p.y = s.y + 7.74; p.fallStartY = p.y; p.onGround = true;
for (let i = 0; i < 400; i++) {
    const phase2 = (globalThis as any).__p2 || Math.hypot(lox - p.x, loz - p.z) < 0.5; (globalThis as any).__p2 = phase2;
  const tgtx = !phase2 ? lox : bx, tgtz = !phase2 ? loz : bz;
  const dx = tgtx - p.x, dz = tgtz - p.z; p.intent.yaw = Math.atan2(-dx, -dz); p.intent.mz = 1;
  sim.tick(1 / 60); sim.events.length = 0;
  if (i % 20 === 0) {
    const [px, pz] = toLocal(s, p.x, p.z);
    const out = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
    world.col.pushOut(p.x, p.y, p.z, 1.8, 0.34, 0.55, out);
    const ceil = world.col.ceilingAt(p.x, p.z, p.y + 0.3, 0.24);
    const blockers = s.parts.filter((q) => !q.noCollide && s.y + q.y1 > p.y + 0.55 && s.y + q.y0 < p.y + 1.8 && px > q.x0 - 0.34 && px < q.x1 + 0.34 && pz > q.z0 - 0.34 && pz < q.z1 + 0.34).map((q) => `[${q.x0.toFixed(2)},${q.y0.toFixed(2)},${q.z0.toFixed(2)} .. ${q.x1.toFixed(2)},${q.y1.toFixed(2)},${q.z1.toFixed(2)} m${q.mat}]`);
    console.log(i, 'local', px.toFixed(2), (p.y - s.y).toFixed(2), pz.toFixed(2), 'ceil', (ceil - s.y).toFixed(2), 'push', out.hit, blockers.join(' '));
  }
}
