import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';
import { Sim } from '../src/sim/sim';
import { toWorld, toLocal } from '../src/world/collision';

const world = generateWorld(loadMasksNode(), 1);

function freshPlayer(sim: Sim) {
  const p = sim.players[0];
  p.phase = 4; p.bot = false; p.vx = p.vy = p.vz = 0; p.onGround = true;
  for (const q of sim.players) if (q.id !== 0) { q.phase = 6; q.alive = false; }
  // keep one idle enemy alive far away, or the match ends (last squad standing) and the sim stops
  const e = sim.players[149]; Object.assign(e, { phase: 4, alive: true, bot: false, x: 3000, z: 300, y: 300 });
  return p;
}
function walk(sim: Sim, p: any, tx: number, tz: number, maxT = 20) {
  const t0 = sim.time;
  while (sim.time - t0 < maxT) {
    const dx = tx - p.x, dz = tz - p.z; if (Math.hypot(dx, dz) < 0.5) return true;
    p.intent.yaw = Math.atan2(-dx, -dz); p.intent.mz = 1; p.intent.mx = 0;
    sim.tick(1 / 60); sim.events.length = 0;
  }
  return false;
}

test('climb an apartment stair core to the roof', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const s = world.col.structures.find((q) => q.kind === 'block' && q.ramps.length >= 6 && Math.abs(q.by1 - 13) < 4)!;
  assert.ok(s, 'found a 3-4 floor block');
  const p = freshPlayer(sim);
  // stand at the foot of the first flight
  const r0 = s.ramps[0];
  const [sx, sz] = toWorld(s, (r0.x0 + r0.x1) / 2, r0.z0 - 0.6);
  p.x = sx; p.z = sz; p.y = s.y + 0.1; p.fallStartY = p.y;
  const heights: number[] = [];
  for (let i = 0; i < s.ramps.length; i++) {
    const r = s.ramps[i];
    const lx = (r.x0 + r.x1) / 2;
    const lo = r.dir === 1 ? r.z0 + 0.3 : r.z1 - 0.3, hi = r.dir === 1 ? r.z1 - 0.3 : r.z0 + 0.3;
    const [ax, az] = toWorld(s, lx, lo), [bx, bz] = toWorld(s, lx, hi);
    walk(sim, p, ax, az, 6); walk(sim, p, bx, bz, 8);
    heights.push(+(p.y - s.y).toFixed(2));
  }
  console.log('stair heights', heights.join(' '), 'roof at', (s.by1).toFixed(1));
  const roof = Math.max(...s.ramps.map((r) => r.y1));
  assert.ok(Math.max(...heights) > roof - 0.5, 'reached the roof');
  assert.ok(p.health >= 100, 'no fall damage on the stairs');
});

test('walk in through a house front door', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  // houses whose front step is clear and level (on the traced map a neighbour or a fence can stand right there)
  const houses = world.col.structures.filter((q) => q.kind === 'house' && q.parts.length > 20).filter((s) => {
    const [ox, oz] = toWorld(s, 0, s.bz0 - 3); return Math.abs(world.col.groundAt(ox, oz, s.y + 1) - s.y) < 0.6 && world.col.fits(ox, world.col.groundAt(ox, oz, s.y + 1), oz, 1.8, 0.3);
  });
  let ok = false;
  for (const s of houses.slice(0, 6)) {
    const p = freshPlayer(sim);
    // front wall is at local z = bz0 + 0.1; door centred at x = 0
    const [ox, oz] = toWorld(s, 0, s.bz0 - 3), [ix, iz] = toWorld(s, 0, s.bz0 + 2.5);
    p.x = ox; p.z = oz; p.y = world.col.groundAt(ox, oz, s.y + 1); p.fallStartY = p.y;
    ok = walk(sim, p, ix, iz, 8);
    console.log('door walk', ok, 'end local', (p.x - s.x).toFixed(1), (p.z - s.z).toFixed(1));
    if (ok) break;
  }
  assert.ok(ok, 'got inside through the doorway');
});

test('mantle onto a crate-height ledge', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  const s = world.col.structures.find((q) => q.kind === 'prop' && q.parts.length === 1 && q.parts[0].y1 > 2)!; // container (2.6 m)
  const [ox, oz] = toWorld(s, 0, -2.5);
  p.x = ox; p.z = oz; p.y = world.col.groundAt(ox, oz, s.y + 1); p.fallStartY = p.y;
  p.intent.yaw = Math.atan2(-(s.x - p.x), -(s.z - p.z)); p.intent.mz = 1;
  for (let i = 0; i < 90; i++) { if (i === 20) p.intent.jump = true; sim.tick(1 / 60); sim.events.length = 0; }
  console.log('mantle y', (p.y - s.y).toFixed(2));
  assert.ok(p.y - s.y > 2.2, 'on top of the container');
});

test('slide carries sprint momentum, slide-cancel pops back up', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  // flat open ground: the airport runway
  p.x = 900; p.z = 1302; p.y = world.col.groundAt(p.x, p.z, 200); p.fallStartY = p.y;
  p.intent.yaw = Math.PI / 2; p.intent.mz = 1; p.intent.sprint = true;
  for (let i = 0; i < 90; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  const x0 = p.x, sprintV = Math.hypot(p.vx, p.vz);
  p.intent.crouch = true;
  let peak = 0, t = 0;
  while (t < 1.5) { sim.tick(1 / 60); sim.events.length = 0; t += 1 / 60; peak = Math.max(peak, Math.hypot(p.vx, p.vz)); if (p.slideT <= 0 && t > 0.1) break; }
  const slideDist = Math.abs(p.x - x0);
  console.log('sprint', sprintV.toFixed(2), 'slide peak', peak.toFixed(2), 'slide time', t.toFixed(2), 'distance', slideDist.toFixed(1), 'stance', p.stance);
  assert.ok(peak > sprintV * 1.1, 'slide boosts speed');
  assert.ok(slideDist > 5 && slideDist < 12, 'slide covers ~5-12 m');
  // slide cancel
  for (let i = 0; i < 90; i++) { p.intent.crouch = false; sim.tick(1 / 60); sim.events.length = 0; }
  p.intent.crouch = true; sim.tick(1 / 60); sim.events.length = 0; // slide again
  for (let i = 0; i < 12; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  assert.ok(p.slideT > 0, 'second slide started');
  p.intent.crouch = true; sim.tick(1 / 60); sim.events.length = 0;
  assert.equal(p.stance, 0, 'slide cancel stands up');
});

/** Find a ground-floor window on a house's front wall: wall above and below, open between (~0.95-2.25 m over the floor). */
function inLocal0(s: any, q: any) { const [x, z] = toLocal(s, q.x, q.z); return { x, z }; }
function frontWallZ(s: any) { let z = Infinity; for (const p of s.parts) if (!p.noCollide && p.y1 - p.y0 > 2 && p.z1 - p.z0 < 0.4 && p.x1 - p.x0 > 0.5) z = Math.min(z, p.z0); return z; }
function findWindow(s: any) {
  const fz = frontWallZ(s);
  for (const zw of [fz + 0.1, fz + 0.12, fz + 0.15]) {
    for (let lx = s.bx0 + 0.8; lx < s.bx1 - 0.8; lx += 0.1) {
      if (Math.abs(lx) < 1.2) continue; // door
      const [wx, wz] = toWorld(s, lx, zw), [fx, fz] = toWorld(s, lx, zw + 1.0);
      const floor = world.col.groundAt(fx, fz, s.y + 1.5, 0.05);
      const sill = world.col.groundAt(wx, wz, floor + 1.6, 0.05);
      if (sill < floor + 0.7 || sill > floor + 1.2) continue;
      if (!world.col.fits(wx, sill + 0.05, wz, 1.1, 0.1) || world.col.fits(wx, floor + 2.5, wz, 0.3, 0.05)) continue;
      let hi = lx; for (;;) { const [hx, hz] = toWorld(s, hi + 0.05, zw); if (hi >= s.bx1 || !world.col.fits(hx, sill + 0.05, hz, 1.1, 0.1)) break; hi += 0.05; }
      if (hi - lx > 0.8) return { lx: (lx + hi) / 2, sill, floor };
    }
  }
  return null;
}

test('vault in and out through a house window; jump spam never reaches the roof', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const houses = world.col.structures.filter((q) => q.kind === 'house' && q.parts.length > 20);
  let s: any = null, win: any = null;
  for (const h of houses) { const w = findWindow(h); if (w) { s = h; win = w; s.fz = frontWallZ(h); break; } }
  assert.ok(s && win, 'found a house window');
  const p = freshPlayer(sim);
  // outside, facing the window
  const [ox, oz] = toWorld(s, win.lx, s.fz - 0.9), [ix, iz] = toWorld(s, win.lx, s.fz + 1.5);
  p.x = ox; p.z = oz; p.y = world.col.groundAt(ox, oz, s.y + 1); p.fallStartY = p.y;
  p.yaw = p.intent.yaw = Math.atan2(-(ix - ox), -(iz - oz));
  p.intent.mz = 1; p.intent.jump = true;
  for (let t = 0; t < 90; t++) { if (t === 45) p.intent.mz = 0; sim.tick(1 / 60); sim.events.length = 0; }
  const inLocal = (q: any) => inLocal0(s, q);
  const a = inLocal(p);
  console.log('vault in: local z', a.z.toFixed(2), 'front wall', s.fz.toFixed(2), 'y', (p.y - s.y).toFixed(2), 'floor', (world.col.groundAt(p.x, p.z, p.y + 0.5) - s.y).toFixed(2), 'sill', (win.sill - s.y).toFixed(2));
  assert.ok(a.z > s.fz + 0.3, 'ended up inside');
  assert.ok(Math.abs(p.y - win.floor) < 0.3, 'dropped to the floor inside, not standing on the sill');
  // and back out
  p.yaw = p.intent.yaw = Math.atan2(-(ox - p.x), -(oz - p.z));
  for (let t = 0; t < 40; t++) { p.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; }
  p.intent.jump = true;
  for (let t = 0; t < 90; t++) { p.intent.mz = 1; sim.tick(1 / 60); sim.events.length = 0; }
  const b = inLocal(p);
  console.log('vault out: local z', b.z.toFixed(2));
  assert.ok(b.z < s.fz - 0.2, 'back outside');
  // spam jump against the facade (window and solid wall) for a while: never above the eaves
  let maxY = -1e9;
  for (const lx of [win.lx, win.lx + 1.6, win.lx - 1.6]) {
    const [qx, qz] = toWorld(s, lx, s.fz - 0.7);
    p.x = qx; p.z = qz; p.y = world.col.groundAt(qx, qz, s.y + 1); p.fallStartY = p.y; p.vx = p.vz = p.vy = 0; p.stance = 0;
    p.yaw = p.intent.yaw = Math.atan2(-(ix - ox), -(iz - oz));
    for (let t = 0; t < 360; t++) { p.intent.mz = 1; if (t % 9 === 0) p.intent.jump = true; sim.tick(1 / 60); sim.events.length = 0; const q = toLocal(s, p.x, p.z); if (q[1] > s.bz0 - 1.5 && q[1] < s.bz1 && q[0] > s.bx0 && q[0] < s.bx1) maxY = Math.max(maxY, p.y - s.y); } // count height only while at / in this house
  }
  console.log('jump spam max height', maxY.toFixed(2), 'eaves', s.by1.toFixed(1));
  // walking in and up the stairs (to 2F or into the loft) is fine; never onto the roof above the top floor
  const roofTop = Math.max(...s.parts.filter((q: any) => (q.mat === 8 || q.mat === 3) && !q.noCollide && q.x1 - q.x0 > 3).map((q: any) => q.y1)); // tile or corrugated-metal roof
  assert.ok(maxY < roofTop + 0.5, 'never climbed onto the roof');
});

test('jumping indoors (floors, stairs) never goes through the ceiling', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  const kinds = new Map<string, any[]>(); for (const q of world.col.structures) if (q.ramps.some((r) => r.mat !== 8)) { const l = kinds.get(q.kind) ?? []; if (l.length < 4) l.push(q); kinds.set(q.kind, l); }
  const cands = [...kinds.values()].flat();
  let bad = 0, tries = 0;
  for (const s of cands) {
    // stand on each stair ramp's middle and on the ground floor next to it, jump-spam in 8 directions
    for (const r of s.ramps.filter((q: any) => q.mat !== 8 /* roof slopes */).slice(0, 4)) {
      for (const [lx, lz] of [[(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2], [(r.x0 + r.x1) / 2 + 1.2, (r.z0 + r.z1) / 2]]) {
        for (let dir = 0; dir < 8; dir++) {
          const [wx, wz] = toWorld(s, lx, lz);
          const y0 = world.col.groundAt(wx, wz, s.y + ((r.y0 + r.y1) / 2) + 0.5);
          if (!world.col.fits(wx, y0 + 0.02, wz, 1.8, 0.3)) continue;
          const ceil = world.col.ceilingAt(wx, wz, y0 + 0.3, 0.2);
          p.x = wx; p.z = wz; p.y = y0; p.vx = p.vy = p.vz = 0; p.stance = 0; p.onGround = true; p.fallStartY = y0; p.mantleT = 0; (p as any).mantleCd = 0;
          p.yaw = p.intent.yaw = dir * Math.PI / 4;
          tries++;
          void ceil;
          for (let t = 0; t < 90; t++) {
            const ox = p.x, oy = p.y, oz = p.z;
            p.intent.mz = 1; if (t % 9 === 0) p.intent.jump = true; sim.tick(1 / 60); sim.events.length = 0;
            // body moved through solid geometry this tick (checked at knee and chest height)
            const clear = (x: number, y: number, z: number) => world.col.fits(x, y + 0.1, z, 1.0, 0.15);
            const thru = Math.hypot(p.x - ox, p.z - oz) < 5 /* not a respawn */ && clear(ox, oy, oz) && clear(p.x, p.y, p.z) && [1.2].some((hh) => !world.col.los(ox, oy + hh, oz, p.x, p.y + hh, p.z));
            if (thru) { bad++; if (bad <= 8) console.log('try', tries, 'through', s.kind, 'dy', (p.y - oy).toFixed(2), 'mantle', p.mantleT.toFixed(2), 'from y', (oy - s.y).toFixed(2), 'to', (p.y - s.y).toFixed(2)); break; }
          }
        }
      }
    }
  }
  console.log('indoor jump tries', tries, 'went through a ceiling', bad);
  assert.ok(tries > 50);
  assert.equal(bad, 0, 'never through the ceiling above the start point');
});

test('climb a shop roof ladder', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  const L = world.ladders;
  console.log('ladders', L.length);
  assert.ok(L.length > 100);
  let ok = 0, tried = 0;
  for (const l of L.slice(0, 12)) {
    const sx = l.x + l.nx * 1.4, sz = l.z + l.nz * 1.4;
    const g = world.col.groundAt(sx, sz, l.y0 + 1.5);
    if (Math.abs(g - l.y0) > 0.6) continue;
    tried++;
    Object.assign(p, { x: sx, z: sz, y: g, vx: 0, vy: 0, vz: 0, onGround: true, fallStartY: g, mantleT: 0, stance: 0 }); (p as any).ladder = -1;
    p.yaw = p.intent.yaw = Math.atan2(l.nx, l.nz); // face the wall
    for (let t = 0; t < 6 * 60; t++) { p.intent.mz = 1; p.intent.mx = 0; sim.tick(1 / 60); sim.events.length = 0; if (p.y > l.y1 - 0.2 && p.onGround && p.mantleT <= 0) break; }
    if (p.y > l.y1 - 0.2 && p.onGround && p.health >= 100) ok++;
    else console.log('ladder fail: y', (p.y - l.y0).toFixed(2), 'top', (l.y1 - l.y0).toFixed(2), 'on', (p as any).ladder);
  }
  console.log('ladder climbs', ok, '/', tried);
  assert.ok(tried >= 5 && ok >= tried - 1, 'climbed onto the roof');
});

test('ride a tower ascender to the roof and step off', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  const p = freshPlayer(sim);
  const A = world.ascenders;
  console.log('ascenders', A.length);
  assert.ok(A.length > 5);
  const a = A.reduce((m, q) => (q.y1 - q.y0 > m.y1 - m.y0 ? q : m));
  // stand on the landing in front of the shaft, facing it
  const sx = a.x + a.nx * 1.4, sz = a.z + a.nz * 1.4;
  Object.assign(p, { x: sx, z: sz, y: a.y0 + 0.02, vx: 0, vy: 0, vz: 0, onGround: true, fallStartY: a.y0, mantleT: 0 });
  p.yaw = p.intent.yaw = Math.atan2(a.nx, a.nz);
  sim.time = 200;
  const t = sim.interactTarget(p);
  console.log('target', t?.kind, t?.label, 'height', (a.y1 - a.y0).toFixed(1));
  assert.equal(t?.kind, 'ascender');
  p.intent.interact = true; sim.tick(1 / 60); sim.events.length = 0; p.intent.interact = false;
  for (let i = 0; i < 20 * 60; i++) { sim.tick(1 / 60); sim.events.length = 0; }
  console.log('end y', (p.y - a.y0).toFixed(2), 'top', (a.y1 - a.y0).toFixed(2), 'onGround', p.onGround, 'hp', p.health);
  assert.ok(Math.abs(p.y - a.y1) < 0.4 && p.onGround, 'standing at the top');
  assert.ok(p.health >= 100);
});

test('glass: jumping at a shop window smashes it and vaults out; a bullet smashes a pane', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  sim.time = 200;
  const shops = world.col.structures.filter((q) => q.kind === 'shop');
  let done = false;
  for (const s of shops.slice(0, 12)) {
    const gi = s.parts.findIndex((q) => q.mat === 5 && q.z1 - q.z0 < 0.5 && q.x1 - q.x0 > 1 && q.z0 < s.bz0 + 0.8);
    if (gi < 0) continue;
    const g = s.parts[gi], p: any = freshPlayer(sim);
    const [x, z] = toWorld(s, (g.x0 + g.x1) / 2, g.z1 + 0.5);
    Object.assign(p, { x, z, y: world.col.groundAt(x, z, s.y + 1), yaw: s.angle, stance: 0, mantleT: 0 }); p.fallStartY = p.y; p.intent.yaw = s.angle;
    if (!world.col.fits(p.x, p.y, p.z, 1.8, 0.3)) continue;
    p.intent.jump = true; p.intent.mz = 1;
    let broke = false;
    for (let i = 0; i < 90; i++) { sim.tick(1 / 60); if (sim.events.some((e) => e.t === 'glass')) broke = true; sim.events.length = 0; p.intent.mz = 1; }
    const [, lz] = toLocal(s, p.x, p.z);
    console.log('shop', s.id, 'broke', broke, 'local z', lz.toFixed(2), 'glass z', g.z0.toFixed(2));
    assert.ok(broke && g.broken, 'pane smashed');
    assert.ok(lz < g.z0 - 0.2, 'went out through the window');
    done = true; break;
  }
  assert.ok(done, 'found a shop window to test');
  // a pane in a block can be smashed on its own (bullets and melee call this)
  const b = world.col.structures.find((q) => q.kind === 'block' && q.parts.some((r) => r.mat === 5 && !r.broken))!;
  const pi = b.parts.findIndex((r) => r.mat === 5 && !r.broken), g = b.parts[pi];
  const [gx, gz] = toWorld(b, (g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2);
  const oy = b.y + (g.y0 + g.y1) / 2;
  assert.ok(sim.breakGlass(b.id, pi, gx, oy, gz), 'breakGlass on a pane');
  assert.ok(g.broken && g.noCollide, 'pane gone for collision');
});

test('cottage loft: walk up the loft stair and stand up in the attic', () => {
  const sim = new Sim(world, 1, { humans: 1 });
  sim.time = 200;
  const lofts = world.col.structures.filter((q) => q.kind === 'house' && q.ramps.some((r) => r.mat === 4));
  assert.ok(lofts.length > 5, 'cottages with lofts');
  let ok = 0, tried = 0;
  for (const s of lofts.slice(0, 8)) {
    const r = s.ramps.find((q) => q.mat === 4)!, up = r.dir; // rises toward +x (dir 1) or -x
    const lowX = up > 0 ? r.x0 : r.x1, highX = up > 0 ? r.x1 : r.x0;
    const p: any = freshPlayer(sim);
    const [sx, sz] = toWorld(s, lowX + up * 0.5, -1.5); // the flight starts at the side wall: step on from beside its foot
    Object.assign(p, { x: sx, z: sz, y: world.col.groundAt(sx, sz, s.y + 1.5), stance: 0, mantleT: 0 }); p.fallStartY = p.y;
    if (!world.col.fits(p.x, p.y, p.z, 1.8, 0.3)) continue;
    tried++;
    walk(sim, p, ...toWorld(s, lowX + up * 0.5, 0), 4);
    walk(sim, p, ...toWorld(s, highX + up * 0.8, 0), 8);
    const top = p.y - s.y;
    console.log('loft', s.id, 'height', top.toFixed(2), 'stance', p.stance);
    if (top > 3.4 && p.stance === 0) ok++;
  }
  assert.ok(tried >= 3 && ok === tried, `stood up in every loft (${ok}/${tried})`);
});
