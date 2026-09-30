/**
 * Hand-built Verdansk centrepieces, positioned from the traced 2020 map. Everything is made of
 * boxes/ramps in local space, placed through the generator context (which flattens terrain and
 * reserves the ground).
 */
import { Mat } from './collision';
import { Builder, apartment, warehouse, garageRow, house, shop, FLOOR_H } from './builder';
import { poi } from './mapdata';
import { tvStation2020, trainStation2020, hospital2020, controlTower2020, superstore2020, terminal2020, prison2020, barracksCompound, grassHangar, fireStation, gasStation, placeNear, sub } from './landmarks2020';
import type { GenContext } from './mapgen';
import { Rng } from '../core/rng';

const W = (nx: number, ny: number): [number, number] => [((nx + 0.02788) / 0.0009839) * 3, ((ny + 0.03887) / 0.0009903) * 3];

export function buildLandmarks(ctx: GenContext) {
  dam(ctx);
  airport(ctx);
  stadium(ctx);
  tvStation2020(ctx);
  prison(ctx);
  superstore2020(ctx);
  prefabs2020(ctx);
  hospital2020(ctx);
  trainStation(ctx);
  port(ctx);
  boneyard(ctx);
  storageTown(ctx);
  quarry(ctx);
  farmland(ctx);
  lumber(ctx);
  militaryBase(ctx);
  promenade(ctx);
  services(ctx);
  buildGulag(ctx);
  bridges(ctx);
  balloons(ctx);
}

/** Redeploy balloons (Season 5, 2020): tethered balloons that launch you back into the sky. */
function balloons(ctx: GenContext) {
  const ids = ['superstore', 'train_station', 'downtown', 'tv_station', 'hills', 'farmland', 'quarry', 'boneyard', 'promenade_east', 'lumber', 'port', 'military_base', 'storage_town', 'airport'];
  for (const id of ids) {
    const p = poi(id);
    for (let k = 0; k < 20; k++) {
      const a = ctx.rng.range(0, 6.28), d = ctx.rng.range(20, 70);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (ctx.occ.at(x, z) !== 0 || ctx.hf.at(x, z) < 1) continue;
      ctx.balloons.push({ x, y: ctx.hf.at(x, z), z });
      ctx.occ.markCircle(x, z, 3, 4);
      break;
    }
  }
}

/** Road bridges over the Gora and Karst canals, with ramps down to the banks. */
function bridges(ctx: GenContext) {
  for (const br of ctx.extra.bridges) {
    const b = new Builder(), L = br.len, W = br.w;
    // local x runs along the road (across the river)
    b.box(-L / 2, -0.8, -W / 2, L / 2, 0, W / 2, Mat.Concrete, { color: 0x9c988e });
    b.box(-L / 2, 0, -W / 2, L / 2, 1.0, -W / 2 + 0.35, Mat.Concrete, { color: 0xb0aca2 });
    b.box(-L / 2, 0, W / 2 - 0.35, L / 2, 1.0, W / 2, Mat.Concrete, { color: 0xb0aca2 });
    for (const px of [-L / 4, 0, L / 4]) b.box(px - 1, -30, -W / 2 + 1, px + 1, -0.8, W / 2 - 1, Mat.Concrete, { color: 0x8a8680 });
    // approach ramps so the deck meets the banks smoothly
    const ga = ctx.hf.at(br.x + Math.cos(br.a) * (L / 2 + 6), br.z - Math.sin(br.a) * (L / 2 + 6)) - br.y, gb = ctx.hf.at(br.x - Math.cos(br.a) * (L / 2 + 6), br.z + Math.sin(br.a) * (L / 2 + 6)) - br.y;
    if (ga < -0.3) b.ramp(L / 2, ga, -W / 2 + 0.4, L / 2 + 12, 0, W / 2 - 0.4, 0, -1);
    if (gb < -0.3) b.ramp(-L / 2 - 12, gb, -W / 2 + 0.4, -L / 2, 0, W / 2 - 0.4, 0, 1);
    ctx.place(b, 'bridge', br.x, br.z, br.a, { y: br.y, flatten: false, mark: false, lodColor: 0x9c988e });
  }
}

/** Climbable tower with a switchback stair core; returns builder. */
function stairTower(b: Builder, cx: number, cz: number, w: number, d: number, floors: number, mat: Mat, color: number, fh = FLOOR_H) {
  const hw = w / 2, hd = d / 2;
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    const ops = f === 0 ? [{ u0: w / 2 - 0.6, u1: w / 2 + 0.6, v0: 0, v1: 2.3 }] : [{ u0: 0.5, u1: w - 0.5, v0: 1, v1: fh - 0.4, glass: false }];
    b.wall(0, cx - hw, cx + hw, cz - hd, y, fh, 0.3, mat, ops, color);
    b.wall(0, cx - hw, cx + hw, cz + hd, y, fh, 0.3, mat, f === 0 ? [] : [{ u0: 0.5, u1: w - 0.5, v0: 1, v1: fh - 0.4 }], color);
    b.wall(1, cz - hd, cz + hd, cx - hw, y, fh, 0.3, mat, [], color);
    b.wall(1, cz - hd, cz + hd, cx + hw, y, fh, 0.3, mat, [], color);
    const mid = y + fh / 2;
    b.ramp(cx - hw + 0.2, y, cz - hd + 1.3, cx - 0.05, mid, cz + hd - 0.2, 1, 1);
    b.ramp(cx + 0.05, mid, cz - hd + 1.3, cx + hw - 0.2, y + fh, cz + hd - 0.2, 1, -1);
    b.slab(cx - hw, cz - hd, cx + hw, cz + hd, y + fh, 0.25, Mat.Concrete, [[cx - hw + 0.15, cz - hd + 1.2, cx + hw - 0.15, cz + hd - 0.15]]);
  }
}

function dam(ctx: GenContext) {
  const [ax, az] = W(0.181, 0.203), [bx, bz] = W(0.262, 0.159);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az) + 40;
  // local x along the wall; local -z faces the reservoir (north-west side)
  const ang = Math.atan2(-(bz - az), bx - ax);
  const b = new Builder();
  const crest = 95, t = 14;
  b.box(-len / 2, -40, -t / 2, len / 2, crest, t / 2, Mat.Concrete, { color: 0xa8a49a }); // gravity wall
  // stepped spillway face downstream (+z)
  for (let i = 0; i < 6; i++) b.box(-len * 0.18, -40, t / 2, len * 0.18, crest - 6 - i * 4.5, t / 2 + 4 + i * 4, Mat.Concrete, { color: 0x9c988f });
  // crest road parapets
  b.box(-len / 2, crest, -t / 2, len / 2, crest + 1.1, -t / 2 + 0.5, Mat.Concrete, { color: 0xb8b4aa });
  b.box(-len / 2, crest, t / 2 - 0.5, len / 2, crest + 1.1, t / 2, Mat.Concrete, { color: 0xb8b4aa });
  // 2020: eight sluice-gate towers along the reservoir side of the road deck (gate houses with a door)
  for (let k = 0; k < 8; k++) {
    const u = -len * 0.3 + k * (len * 0.6 / 7);
    b.box(u - 3, 60, -t / 2 - 5, u + 3, crest, -t / 2, Mat.Concrete, { color: 0xb0aca2 }); // gate pier in the water
    const gh = new Builder();
    gh.wall(0, -3, 3, -2.5, 0, 5, 0.3, Mat.Concrete, [], 0xbab6ac); gh.wall(0, -3, 3, 2.5, 0, 5, 0.3, Mat.Concrete, [{ u0: 2.4, u1: 3.6, v0: 0, v1: 2.3 }], 0xbab6ac);
    gh.wall(1, -2.35, 2.35, -3, 0, 5, 0.3, Mat.Concrete, [{ u0: 1.6, u1: 3.1, v0: 1.4, v1: 2.6, glass: true }], 0xbab6ac); gh.wall(1, -2.35, 2.35, 3, 0, 5, 0.3, Mat.Concrete, [{ u0: 1.6, u1: 3.1, v0: 1.4, v1: 2.6, glass: true }], 0xbab6ac);
    gh.box(-3.3, 5, -2.8, 3.3, 5.35, 2.8, Mat.Roof, { color: 0x5a5d62 });
    gh.box(-1.2, 0, -1.6, 1.2, 1.4, -0.4, Mat.Metal, { color: 0x6a7278 }); // gate winch
    gh.light(0, 4.8, 0); if (k % 2 === 0) gh.addLoot(1.5, 0, 1);
    for (const p of gh.parts) b.parts.push({ ...p, x0: p.x0 + u, x1: p.x1 + u, y0: p.y0 + crest, y1: p.y1 + crest, z0: p.z0 - t / 2 + 3, z1: p.z1 - t / 2 + 3 });
    for (const d of gh.doors) b.doors.push({ ...d, x: d.x + u, y: d.y + crest, z: d.z - t / 2 + 3 });
    for (const l of gh.lights) b.lights.push([l[0] + u, l[1] + crest, l[2] - t / 2 + 3]);
    for (const l of gh.loot) b.addLoot(l[0] + u, l[1] + crest - 0.05, l[2] - t / 2 + 3);
  }
  // control house on top
  const hb = apartment(ctx.rng, 18, 9, 2, { wall: Mat.Concrete, wallColor: 0xc7c1b3, trim: 0, roof: Mat.Roof, roofColor: 0x555 });
  for (const p of hb.parts) b.parts.push({ ...p, x0: p.x0 + len * 0.3, x1: p.x1 + len * 0.3, y0: p.y0 + crest, y1: p.y1 + crest, z0: p.z0 + t / 2 + 6, z1: p.z1 + t / 2 + 6 });
  for (const r of hb.ramps) b.ramps.push({ ...r, x0: r.x0 + len * 0.3, x1: r.x1 + len * 0.3, y0: r.y0 + crest, y1: r.y1 + crest, z0: r.z0 + t / 2 + 6, z1: r.z1 + t / 2 + 6 });
  b.box(len * 0.3 - 10, crest - 30, t / 2, len * 0.3 + 10, crest, t / 2 + 11, Mat.Concrete, { color: 0xa8a49a }); // plinth for the house
  for (const l of hb.loot) b.addLoot(l[0] + len * 0.3, l[1] + crest, l[2] + t / 2 + 6);
  b.addLoot(-len * 0.3, crest, 0); b.addLoot(0, crest, 0); b.addLoot(len * 0.1, crest, 0);
  ctx.place(b, 'dam', cx, cz, ang, { y: 0, flatten: false, poi: 'dam', lodColor: 0xa8a49a });
  // road ramps up to the crest at both ends: flatten terrain toward the crest height
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (const s of [-1, 1]) {
    const ex = cx + s * (len / 2 + 10) * ca, ez = cz - s * (len / 2 + 10) * sa;
    ctx.flatten(ex, ez, ang, 30, 18, crest, 40);
  }
  ctx.buyStations.push({ x: cx + 40 * sa, y: 0, z: cz + 40 * ca, a: ang });
  damBase(ctx, cx, cz, ang, crest, t, len);
}

/**
 * Gora Dam base (2020 atlas, Zone 1A): a tailrace yard in the gorge below the spillway with the main generator
 * hall (turbines, control mezzanine, gantry stair to a roof helipad), three red penstock pipes you can walk
 * along from the dam face into the hall, a transformer yard and walkways up to the spillway ledge; at the east
 * end of the crest road a sentry hut, two office sheds and two transformer cylinders with ladders.
 */
function damBase(ctx: GenContext, cx: number, cz: number, ang: number, crest: number, t: number, len: number) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const Wd = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const floor = 74;
  { const [fx, fz] = Wd(0, 62); ctx.flatten(fx, fz, ang, 90, 96, floor, 22); ctx.occ.mark(fx, fz, ang, 96, 100, 0, 1); }
  const b = new Builder(), steel = 0x6d7378, red = 0xa8342a, wall = 0xb8b2a4;
  // generator hall: x -15..15, z 53..87 (local to the dam, +z downstream), floor at the yard
  const X0 = -15, X1 = 15, Z0 = 53, Z1 = 87, H = 12, M = 4.6;
  b.box(X0 - 0.2, -1.5, Z0 - 0.2, X1 + 0.2, 0.05, Z1 + 0.2, Mat.Concrete, { color: 0x9a968f });
  const pipeX = [-9, 0, 9];
  b.wall(0, X0, X1, Z0, 0.05, H, 0.4, Mat.Concrete, pipeX.map((px) => ({ u0: px - X0 - 1.6, u1: px - X0 + 1.6, v0: 4.3, v1: 7.7, open: true })), wall); // pipes come through the back wall
  b.wall(0, X0, X1, Z1, 0.05, H, 0.4, Mat.Concrete, [{ u0: 12.1, u1: 13.9, v0: 0, v1: 2.3 }, { u0: 16.1, u1: 17.9, v0: 0, v1: 2.3 }, { u0: 2, u1: 10, v0: 6, v1: 10, glass: true }, { u0: 20, u1: 28, v0: 6, v1: 10, glass: true }], wall, 1);
  b.wall(1, Z0 + 0.2, Z1 - 0.2, X0, 0.05, H, 0.4, Mat.Concrete, [{ u0: 6, u1: 7, v0: 0, v1: 2.3 }, { u0: 10, u1: 28, v0: 7, v1: 10, glass: true }], wall, -1);
  b.wall(1, Z0 + 0.2, Z1 - 0.2, X1, 0.05, H, 0.4, Mat.Concrete, [{ u0: 26, u1: 27, v0: 0, v1: 2.3 }, { u0: 4, u1: 20, v0: 7, v1: 10, glass: true }], wall, 1);
  b.slab(X0 - 0.2, Z0 - 0.2, X1 + 0.2, Z1 + 0.2, H, 0.4, Mat.Roof);
  for (const px of pipeX) { b.box(px - 2.4, 0.05, 60.6, px + 2.4, 4.9, 65.4, Mat.Metal, { color: 0x4f6a7a, shape: 'cyl' }); b.box(px - 1.2, 4.9, 61.8, px + 1.2, 5.6, 64.2, Mat.Metal, { color: 0x3a3e42 }); } // turbines
  // control room mezzanine along the front with a stair
  b.box(X0 + 0.2, M - 0.3, 79, X1 - 0.2, M, Z1 - 0.2, Mat.Concrete, { color: 0x9a968f });
  b.box(X0 + 4.2, M, 78.95, X1 - 0.2, M + 1, 79.05, Mat.Metal, { color: steel });
  b.ramp(X0 + 0.4, 0.05, 70.5, X0 + 1.9, M, 79, 1, 1, Mat.Metal);
  b.box(-6, M, 83, 6, M + 1.1, 85.5, Mat.Metal, { color: 0x3a4250 }); // control desks
  for (let lx = -10; lx <= 10; lx += 10) { b.light(lx, H - 0.6, 64); b.light(lx, M + 2.8, 83); }
  b.addLoot(-8, 0.05, 72); b.addLoot(8, 0.05, 72); b.addLoot(0, M, 82); b.addLoot(10, M, 84);
  // gantry stair up the east wall to the roof, helipad on the roof
  b.ramp(X1 + 0.3, 0.05, 60, X1 + 1.8, H, 84, 1, 1, Mat.Metal);
  b.box(X1 + 0.3, H - 0.2, 84, X1 + 1.8, H, 87.2, Mat.Metal, { color: steel });
  b.box(-6, H, 64, 6, H + 0.02, 76, Mat.Trim, { color: 0x3a3e42, noCollide: true }); b.box(-1.2, H + 0.02, 66, 1.2, H + 0.04, 74, Mat.Trim, { color: 0xe8e8e0, noCollide: true }); b.box(-3.5, H + 0.02, 69.4, 3.5, H + 0.04, 70.6, Mat.Trim, { color: 0xe8e8e0, noCollide: true });
  b.addLoot(8, H, 60);
  // penstock pipes: from the dam face (spillway) down to the hall, walkable on top, on piers
  const pTop = 7.6;
  for (const px of pipeX) {
    b.box(px - 1.6, pTop - 3.2, 18, px + 1.6, pTop, Z0 + 0.3, Mat.Metal, { color: red, shape: 'cyl' });
    for (let z = 22; z < Z0; z += 8) b.box(px - 1.1, 0.05, z - 0.5, px + 1.1, pTop - 2.8, z + 0.5, Mat.Concrete, { color: 0x9a968f });
  }
  // walkways from the hall roof up onto the spillway ledge
  const ledge = crest - 6 - 4.5 - floor; // step 1 of the spillway, relative to the yard
  for (const wx of [-13, 13]) {
    b.ramp(wx - 1, ledge, 14.5, wx + 1, H, Z0 - 0.2, 1, 1, Mat.Metal);
    b.box(wx - 1.1, ledge, 14.5, wx - 1, H + 1, Z0, Mat.Metal, { color: steel }); b.box(wx + 1, ledge, 14.5, wx + 1.1, H + 1, Z0, Mat.Metal, { color: steel }); // solid side rails
  }
  // transformer yard (16) beside the hall
  for (let i = 0; i < 16; i++) { const tx = -34 + (i % 4) * 4.5, tz = 60 + Math.floor(i / 4) * 6; b.box(tx - 1.2, 0.05, tz - 1, tx + 1.2, 2.6, tz + 1, Mat.Metal, { color: 0x7a7e76 }); b.box(tx - 0.3, 2.6, tz - 0.3, tx + 0.3, 3.4, tz + 0.3, Mat.Metal, { color: 0x8a6a4a }); }
  b.addLoot(-28, 0.05, 72);
  const [hx, hz] = Wd(0, 0);
  ctx.place(b, 'damhall', hx, hz, ang, { y: floor, flatten: false, poi: 'dam', lodColor: wall });
  // east entrance: sentry hut, office sheds, transformer cylinders with ladders
  const e = new Builder();
  e.wall(0, -1.5, 1.5, -1.5, 0.05, 2.8, 0.2, Mat.Concrete, [{ u0: 0.3, u1: 2.7, v0: 1.1, v1: 2.2, glass: true }], 0xc8c2b4); e.wall(0, -1.5, 1.5, 1.5, 0.05, 2.8, 0.2, Mat.Concrete, [{ u0: 1, u1: 2, v0: 0, v1: 2.2 }], 0xc8c2b4);
  e.wall(1, -1.4, 1.4, -1.5, 0.05, 2.8, 0.2, Mat.Concrete, [], 0xc8c2b4); e.wall(1, -1.4, 1.4, 1.5, 0.05, 2.8, 0.2, Mat.Concrete, [], 0xc8c2b4);
  e.box(-1.8, 2.85, -1.8, 1.8, 3.05, 1.8, Mat.Roof, { color: 0x5a5d62 }); e.addLoot(0, 0.05, 0);
  for (const [ox, oz] of [[8, 10], [8, 22]]) {
    e.wall(0, ox - 4, ox + 4, oz - 3, 0.05, 3, 0.2, Mat.Metal, [{ u0: 3.5, u1: 4.5, v0: 0, v1: 2.2 }], 0x8a8f94); e.wall(0, ox - 4, ox + 4, oz + 3, 0.05, 3, 0.2, Mat.Metal, [{ u0: 1, u1: 3, v0: 1, v1: 2, glass: true }], 0x8a8f94);
    e.wall(1, oz - 2.9, oz + 2.9, ox - 4, 0.05, 3, 0.2, Mat.Metal, [], 0x8a8f94); e.wall(1, oz - 2.9, oz + 2.9, ox + 4, 0.05, 3, 0.2, Mat.Metal, [], 0x8a8f94);
    e.box(ox - 4.2, 3.05, oz - 3.2, ox + 4.2, 3.25, oz + 3.2, Mat.Roof, { color: 0x5a5d62 }); e.light(ox, 2.8, oz); e.addLoot(ox, 0.05, oz);
  }
  for (const oz of [34, 42]) { e.box(4, 0.05, oz - 2.5, 9, 7, oz + 2.5, Mat.Metal, { color: 0x9a9c96, shape: 'cyl' }); e.ladder(3.85, oz, -1, 0, 0.05, 7); e.addLoot(6.5, 7, oz); }
  const [ex, ez] = Wd(len / 2 + 30, 18);
  ctx.place(e, 'damentry', ex, ez, ang, { poi: 'dam', lodColor: 0xc8c2b4 });
}

function airport(ctx: GenContext) {
  const rng = ctx.rng;
  // runway (a thin asphalt slab so it reads as tarmac and stays flat)
  const rx = 933, rz = 1302, rl = 640, rw = 46;
  ctx.flatten(rx, rz, 0, rl, rw + 70, ctx.footprintHeights(rx, rz, 0, rl, rw).avg, 30);
  const ry = ctx.hf.at(rx, rz);
  const r = new Builder();
  r.box(-rl / 2, -0.6, -rw / 2, rl / 2, 0.08, rw / 2, Mat.Asphalt, { color: 0x77787a });
  r.box(-rl / 2, -0.6, rw / 2 + 12, rl / 2 - 60, 0.06, rw / 2 + 32, Mat.Asphalt, { color: 0x6e6f72 }); // taxiway
  for (let x = -rl / 2 + 20; x < rl / 2 - 20; x += 30) r.box(x, 0.08, -0.6, x + 14, 0.1, 0.6, Mat.Trim, { color: 0xe8e8e0, noCollide: true });
  ctx.place(r, 'runway', rx, rz, 0, { y: ry, flatten: false, pad: 4, lodColor: 0x3a3b3d });
  // crashed plane on the runway edge
  plane(ctx, rx + 150, rz - 10, 0.35, 1.0);
  // main terminal (2020 atlas layout), runway side north
  const tx = 800, tz = 1440;
  terminal2020(ctx, tx, tz + 6);
  // control tower: horseshoe admin building round the base, ascender up the shaft, open-air cab
  controlTower2020(ctx, 880, 1395);
  // hangars east of the terminal along the apron
  for (let i = 0; i < 4; i++) {
    const hb = warehouse(rng, 42, 34, 12, { wall: Mat.Metal, wallColor: rng.pick([0x8a8f94, 0x7d8388, 0x9a9da0]), trim: 0, roof: Mat.Roof, roofColor: 0x5d6166 }, { hangar: true });
    ctx.place(hb, 'hangar', 990 + i * 52, 1395, Math.PI, { poi: 'airport', lodColor: 0x8a8f94 });
  }
  // radar dome north of the runway: dome visual on a drum
  const rd = new Builder();
  rd.box(-10, 0, -10, 10, 8, 10, Mat.Concrete, { color: 0xb8b4aa, shape: 'cyl' });
  rd.box(-11, 8, -11, 11, 22, 11, Mat.Metal, { color: 0xe6e6e0, shape: 'cyl', noCollide: false });
  ctx.place(rd, 'radar', 810, 1218, 0, { poi: 'airport', lodColor: 0xe6e6e0 });
  ctx.buyStations.push({ x: 760, y: 0, z: 1500, a: 0 });
  ctx.contracts.push({ x: 1000, y: 0, z: 1450 });
}

function plane(ctx: GenContext, x: number, z: number, ang: number, scale: number, broken = false) {
  const b = new Builder(), s = scale, c = 0xd8d8d4;
  b.box(-18 * s, 1.2, -2.2 * s, 18 * s, 1.2 + 4.4 * s, 2.2 * s, Mat.Metal, { color: c, shape: 'cyl' }); // fuselage
  if (!broken) {
    b.box(-3 * s, 2.2 * s, -16 * s, 4 * s, 2.7 * s, 16 * s, Mat.Metal, { color: 0xc8c8c4 }); // wings
    b.box(13 * s, 3 * s, -0.25, 17.5 * s, 9 * s, 0.25, Mat.Metal, { color: 0xb03a2e }); // tail fin
    b.box(13.5 * s, 4 * s, -5 * s, 17 * s, 4.5 * s, 5 * s, Mat.Metal, { color: c });
    for (const zz of [-8, 8]) b.box(-2 * s, 0.4 * s, zz * s - 1.2 * s, 2.5 * s, 2.2 * s, zz * s + 1.2 * s, Mat.Metal, { color: 0x707478, shape: 'cyl' }); // engines
  } else {
    b.box(-3 * s, 0, 3 * s, 3 * s, 0.6 * s, 14 * s, Mat.Metal, { color: 0xb8b8b4 });
  }
  b.addLoot(0, 1.2, 3.2 * s);
  ctx.place(b, 'plane', x, z, ang, { flatten: false, y: ctx.hf.at(x, z), lodColor: c });
}

function stadium(ctx: GenContext) {
  const p = poi('stadium');
  const cx = p.x, cz = p.z;
  const A = 112, B = 126; // outer semi-axes (x, z)
  const inner = 0.56; // pitch opening fraction
  const H = 32;
  const base = ctx.footprintHeights(cx, cz, 0, A * 2, B * 2).max;
  ctx.flatten(cx, cz, 0, A * 2 + 10, B * 2 + 10, base - 0.2, 30);
  const N = 36;
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2, tm = (t0 + t1) / 2;
    // superellipse for the rounded-rectangle look
    const se = (t: number, a: number, bb: number): [number, number] => { const c = Math.cos(t), s = Math.sin(t); return [a * Math.sign(c) * Math.abs(c) ** 0.6, bb * Math.sign(s) * Math.abs(s) ** 0.6]; };
    const [x0, z0] = se(t0, A, B), [x1, z1] = se(t1, A, B), [xm, zm] = se(tm, A, B);
    const segLen = Math.hypot(x1 - x0, z1 - z0) + 1.2;
    const ang = Math.atan2(-(z1 - z0), x1 - x0); // local x along tangent
    // local +z points inward? compute: local z axis world dir = (sin a, cos a)
    const inx = -xm, inz = -zm, zin = Math.sin(ang) * inx + Math.cos(ang) * inz > 0 ? 1 : -1;
    const depth = Math.hypot(xm, zm) * (1 - inner);
    const b = new Builder();
    const gate = i % 9 === 0;
    b.wall(0, -segLen / 2, segLen / 2, 0, 0, H, 1.5, Mat.Concrete, gate ? [{ u0: segLen / 2 - 5, u1: segLen / 2 + 5, v0: 0, v1: 6 }] : [{ u0: 2, u1: segLen - 2, v0: 12, v1: 14.5 }], 0xd6d2c8);
    // roof ring slab
    b.box(-segLen / 2 - 0.3, H, zin > 0 ? 0 : -depth, segLen / 2 + 0.3, H + 1.2, zin > 0 ? depth : 0, Mat.Roof, { color: 0xeeeeea });
    // stands: a ramp from the pitch edge up to the concourse ledge
    const standD = depth * 0.8;
    if (zin > 0) b.ramp(-segLen / 2, 1, 1.5, segLen / 2, 20, standD, 1, -1, Mat.Concrete);
    else b.ramp(-segLen / 2, 1, -standD, segLen / 2, 20, -1.5, 1, 1, Mat.Concrete);
    // walkway at the top of the stands + concourse floor under
    b.box(-segLen / 2, 19.6, zin > 0 ? 0.75 : -2.5, segLen / 2, 20, zin > 0 ? 2.5 : -0.75, Mat.Concrete, { color: 0xb8b4aa });
    b.box(-segLen / 2, 0, zin > 0 ? 0.75 : -standD, segLen / 2, 0.15, zin > 0 ? standD : -0.75, Mat.Concrete, { color: 0x8a8884, noCollide: false });
    // stair up inside the gate segments to the walkway
    if (gate) {
      if (zin > 0) b.ramp(-segLen / 2 + 1, 0.15, 3, -segLen / 2 + 3, 19.6, 14, 1, 1);
      else b.ramp(-segLen / 2 + 1, 0.15, -14, -segLen / 2 + 3, 19.6, -3, 1, -1);
      b.addLoot(0, 0.15, zin * 4);
      b.addLoot(0, 20, zin * 1.6);
    }
    // roof access ladder-ish ramp from walkway to roof on a few segments
    if (i % 12 === 6) {
      if (zin > 0) b.ramp(-2, 20, 2.6, 0, H + 1.2, 12, 1, -1); else b.ramp(-2, 20, -12, 0, H + 1.2, -2.6, 1, 1);
      b.addLoot(0, H + 1.2, zin * depth * 0.5);
    }
    ctx.place(b, 'stadium', cx + xm, cz + zm, ang, { y: base, flatten: false, poi: 'stadium', lodColor: 0xe6e4de });
  }
  // glass roof over the centre + pitch
  const g = new Builder();
  g.box(-A * inner * 1.02, H + 3, -B * inner * 1.02, A * inner * 1.02, H + 3.3, B * inner * 1.02, Mat.Glass, { color: 0x9ec3c6 });
  g.box(-A * 0.35, 0, -B * 0.4, A * 0.35, 0.12, B * 0.4, Mat.Trim, { color: 0x3f7a3a, noCollide: true }); // pitch
  g.addLoot(0, 0.12, 0); g.addLoot(10, 0.12, 20);
  ctx.place(g, 'stadium-roof', cx, cz, 0, { y: base, flatten: false, mark: false, poi: 'stadium', lodColor: 0x9ec3c6 });
  ctx.occ.markCircle(cx, cz, B + 4, 1);
  ctx.buyStations.push({ x: cx - A - 20, y: 0, z: cz + 30, a: 0 });
}

function tvStation(ctx: GenContext) {
  const p = poi('tv_station');
  const rng = ctx.rng;
  const main = apartment(rng, 40, 22, 5, { wall: Mat.Concrete, wallColor: 0xb9b2a4, trim: 0, roof: Mat.Roof, roofColor: 0x4a4d52 }, { glassBands: true });
  ctx.place(main, 'tvstation', p.x - 10, p.z + 8, 0.3, { poi: 'tv_station', lodColor: 0xb9b2a4 });
  // broadcast lattice tower (legs + braces), climbable low platform
  const b = new Builder(), h = 90;
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.box(x - 0.4, 0, z - 0.4, x + 0.4, h, z + 0.4, Mat.Metal, { color: 0xb33a2a });
  for (let y = 10; y < h; y += 10) { b.box(-4.4, y, -4.4, 4.4, y + 0.4, -3.6, Mat.Metal, { color: 0xd8d8d8, noCollide: true }); b.box(-4.4, y, 3.6, 4.4, y + 0.4, 4.4, Mat.Metal, { color: 0xd8d8d8, noCollide: true }); }
  b.box(-0.3, h, -0.3, 0.3, h + 12, 0.3, Mat.Metal, { color: 0xd8d8d8 });
  ctx.place(b, 'lattice', p.x + 28, p.z - 22, 0, { poi: 'tv_station', lodColor: 0xb33a2a });
  ctx.buyStations.push({ x: p.x - 30, y: 0, z: p.z + 35, a: 0 });
  ctx.contracts.push({ x: p.x + 10, y: 0, z: p.z + 40 });
}

function prison(ctx: GenContext) {
  const p = poi('prison');
  const cx = p.x, cz = p.z - 10, R = 70;
  prison2020(ctx, cx, cz);
  ctx.occ.markCircle(cx, cz, R + 10, 1);
  ctx.contracts.push({ x: cx + 30, y: 0, z: cz - R - 45 });
}

function superstore(ctx: GenContext) {
  const p = poi('superstore');
  const rng = ctx.rng;
  const w = 120, d = 70, h = 10;
  const b = warehouse(rng, w, d, h, { wall: Mat.Concrete, wallColor: 0xd7d3c9, trim: 0, roof: Mat.Roof, roofColor: 0x6a6d72 });
  // replace crates with long aisles of shelves
  b.parts = b.parts.filter((pp) => !(pp.mat === Mat.Wood || pp.mat === Mat.Container));
  for (let x = -w / 2 + 10; x < w / 2 - 10; x += 7) b.block(x, -3, 1.2, d - 26, 0.1, 2.4, Mat.Metal, { color: 0x3c6aa0 });
  for (let i = 0; i < 8; i++) b.addLoot(-w / 2 + 8 + i * 14, 0.1, -d / 2 + 6);
  // roof access stairs on the side wall (outside)
  b.ramp(w / 2 + 0.3, 0.1, -d / 2 + 4, w / 2 + 2.3, h + 0.4, -d / 2 + 20, 1, 1, Mat.Metal);
  b.box(-w / 2 + 2, h + 0.4, -d / 2 - 0.4, w / 2 - 2, h + 2.5, -d / 2 + 0.3, Mat.Trim, { color: 0x2d5a9a, noCollide: true });
  ctx.place(b, 'superstore', p.x, p.z - 10, 0, { poi: 'superstore', lodColor: 0xd7d3c9 });
  ctx.buyStations.push({ x: p.x, y: 0, z: p.z + 40, a: 0 });
  ctx.contracts.push({ x: p.x + 70, y: 0, z: p.z + 30 });
}

function hospital(ctx: GenContext) {
  const p = poi('hospital');
  const rng = ctx.rng;
  const st = { wall: Mat.Concrete, wallColor: 0xe0ddd4, trim: 0, roof: Mat.Roof, roofColor: 0x4a4d52 };
  ctx.place(apartment(rng, 56, 16, 6, st), 'hospital', p.x, p.z - 14, 0, { poi: 'hospital', lodColor: 0xe0ddd4 });
  ctx.place(apartment(rng, 36, 16, 5, st), 'hospital', p.x + 20, p.z + 18, Math.PI / 2, { poi: 'hospital', lodColor: 0xe0ddd4 });
  // helipad on the ground + aid tents
  for (let i = 0; i < 5; i++) {
    const tb = new Builder();
    tb.box(-3, 0, -2.5, 3, 2.6, 2.5, Mat.Plaster, { color: 0xe8e4d8, shape: 'gable', noCollide: false });
    tb.addLoot(0, 0.05, 0);
    ctx.place(tb, 'tent', p.x - 40 + i * 8, p.z + 30, 0, { poi: 'hospital', lodColor: 0xe8e4d8 });
  }
  ctx.buyStations.push({ x: p.x - 45, y: 0, z: p.z, a: 0 });
}

function trainStation(ctx: GenContext) {
  const p0 = poi('train_station');
  const rng = ctx.rng;
  // align with the freight line: long axis along the track, the live line in the slot between the platforms (local z = 31)
  let ang = -0.52, p = { ...p0 };
  const rp = ctx.extra.railPath;
  if (rp && rp.length > 6) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rp.length; i += 3) { const d = (rp[i] - p0.x) ** 2 + (rp[i + 2] - p0.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const j = (bi + 3 * 8) % rp.length, k = (bi - 3 * 8 + rp.length) % rp.length;
    const tx = rp[j] - rp[k], tz = rp[j + 2] - rp[k + 2], tl = Math.hypot(tx, tz);
    ang = Math.atan2(-tz / tl, tx / tl);
    const nx = Math.sin(ang), nz = Math.cos(ang);
    p = { ...p0, x: rp[bi] - nx * 31, z: rp[bi + 2] - nz * 31 };
  }
  const st = { wall: Mat.Concrete, wallColor: 0xcfc6b2, trim: 0, roof: Mat.Roof, roofColor: 0x5a5048 };
  const sf = trainStation2020(ctx, p.x, p.z, ang); void st;
  // platforms + canopy + parked trains
  const b = new Builder();
  for (const zz of [22, 40]) {
    b.box(-80, 0, zz - 4, 80, 1.1, zz + 4, Mat.Concrete, { color: 0xa6a298 });
    for (let x = -76; x <= 76; x += 12) b.box(x - 0.2, 1.1, zz - 0.2, x + 0.2, 6, zz + 0.2, Mat.Metal, { color: 0x5c6166 });
    b.box(-80, 6, zz - 5, 80, 6.3, zz + 5, Mat.Metal, { color: 0x6c7176 });
    b.addLoot(-40, 1.1, zz); b.addLoot(30, 1.1, zz);
  }
  for (const zz of [49]) for (let k = 0; k < 4; k++) { // a parked train on the far track (the near one is the live line)
    const x0 = -70 + k * 24;
    b.box(x0, 0.4, zz - 1.6, x0 + 22, 4.4, zz + 1.6, Mat.Metal, { color: k === 0 ? 0x8a3a2a : 0x4f6a5a });
  }
  sub(ctx, sf, 0, 0, 0, b, 'platforms');
  ctx.buyStations.push({ x: p.x - 30, y: 0, z: p.z - 30, a: 0 });
  ctx.contracts.push({ x: p.x + 40, y: 0, z: p.z - 40 });
}

function port(ctx: GenContext) {
  const p = poi('port');
  const rng = ctx.rng;
  // gantry cranes along the basin
  for (let i = 0; i < 3; i++) {
    const b = new Builder(), h = 38;
    for (const [x, z] of [[-9, -6], [9, -6], [-9, 6], [9, 6]]) b.box(x - 0.8, 0, z - 0.8, x + 0.8, h, z + 0.8, Mat.Metal, { color: 0xd89a1e });
    b.box(-10, h, -8, 10, h + 3, 8, Mat.Metal, { color: 0xd89a1e });
    b.box(-3, h + 3, -30, 3, h + 5, 18, Mat.Metal, { color: 0xd89a1e }); // boom
    b.box(-2.5, h - 5, -3, 2.5, h, 3, Mat.Metal, { color: 0x3a3d40 }); // cab
    b.ramp(-9.6, 0, -4, -8.4, h, 4, 1, 1, Mat.Metal);
    b.addLoot(0, h + 3, 0);
    ctx.place(b, 'crane', p.x - 30 + i * 32, p.z - 30, 0.1, { poi: 'port', lodColor: 0xd89a1e });
  }
  // container stacks
  for (let i = 0; i < 26; i++) {
    const b = new Builder();
    const nx = rng.int(1, 3), ny = rng.int(1, 3);
    for (let k = 0; k < nx; k++) for (let l = 0; l < ny; l++) b.box(-6, l * 2.6, -1.25 + k * 2.55, 6, (l + 1) * 2.6, 1.25 + k * 2.55, Mat.Container, { color: rng.pick([0x8a2b20, 0x2b5a8a, 0x2d6a3a, 0xa87a20, 0x6a6a6a, 0x5a3a6a, 0xb04a1a]) });
    if (rng.chance(0.4)) b.addLoot(0, ny * 2.6, 0);
    const x = p.x + rng.range(-110, 110), z = p.z + rng.range(-20, 110);
    if (!ctx.occ.free(x, z, 0.1, 13, nx * 2.6, 1)) continue;
    ctx.place(b, 'containers', x, z, 0.1 + (rng.chance(0.3) ? Math.PI / 2 : 0), { poi: 'port', lodColor: 0x7a4a3a });
  }
  ctx.buyStations.push({ x: p.x + 60, y: 0, z: p.z + 80, a: 0 });
}

function boneyard(ctx: GenContext) {
  const p = poi('boneyard');
  const rng = ctx.rng;
  for (let i = 0; i < 18; i++) {
    const x = p.x + rng.range(-110, 110), z = p.z + rng.range(-100, 100);
    if (!ctx.occ.free(x, z, 0, 36, 32, 2)) continue;
    const s = rng.range(0.7, 1.1);
    plane(ctx, x, z, rng.range(0, Math.PI * 2), s, rng.chance(0.4));
    ctx.occ.mark(x, z, 0, 36 * s, 32 * s, 1, 1);
  }
  ctx.buyStations.push({ x: p.x + 40, y: 0, z: p.z - 80, a: 0 });
  ctx.contracts.push({ x: p.x - 50, y: 0, z: p.z + 60 });
}

function storageTown(ctx: GenContext) {
  const p = poi('storage_town');
  const rng = ctx.rng;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
    const x = p.x - 70 + r * 28, z = p.z - 50 + c * 42;
    if (!ctx.occ.free(x, z, 0, 10, 34, 0.5)) continue;
    const b = garageRow(rng, 34, 7, { wall: Mat.Concrete, wallColor: rng.pick([0xb0a898, 0xa8a090, 0xbab2a0]), trim: 0, roof: Mat.Roof, roofColor: 0x555 });
    ctx.place(b, 'garages', x, z, Math.PI / 2, { poi: 'storage_town', lodColor: 0xb0a898, pad: 0.5 });
  }
  // two red silos at the old farmstead
  for (const dx of [0, 9]) {
    const b = new Builder();
    b.box(-3.5, 0, -3.5, 3.5, 22, 3.5, Mat.Metal, { color: 0x8e3a2c, shape: 'cyl' });
    ctx.place(b, 'silo', p.x + 95 + dx, p.z - 60, 0, { poi: 'storage_town', lodColor: 0x8e3a2c });
  }
  ctx.buyStations.push({ x: p.x + 20, y: 0, z: p.z + 80, a: 0 });
}

function quarry(ctx: GenContext) {
  const p = poi('quarry');
  const hf = ctx.hf;
  // terraced open pit: concentric benches stepping down to the floor
  const R = 150, floorH = 38, rim = ctx.footprintHeights(p.x, p.z, 0, 40, 40).avg + 12;
  const steps = 6;
  for (let j = 0; j < hf.res; j++) for (let i = 0; i < hf.res; i++) {
    const x = i * hf.step, z = j * hf.step;
    const d = Math.hypot((x - p.x) / 1.15, z - p.z);
    if (d > R + 20) continue;
    const k = j * hf.res + i;
    const t = Math.min(1, d / R);
    const stepped = Math.floor(t * steps + 0.25) / steps;
    const target = floorH + (rim - floorH) * stepped;
    const w = d > R ? 1 - (d - R) / 20 : 1;
    hf.h[k] = hf.h[k] + (Math.min(hf.h[k], target) - hf.h[k]) * w;
  }
  const rng = ctx.rng;
  for (let i = 0; i < 4; i++) {
    const b = warehouse(rng, 24, 14, 7, { wall: Mat.Metal, wallColor: 0x8a7f70, trim: 0, roof: Mat.Roof, roofColor: 0x5d6166 });
    const a = i * 1.5 + 0.3;
    ctx.place(b, 'quarryshed', p.x + Math.cos(a) * (R + 40), p.z + Math.sin(a) * (R + 30), a, { poi: 'quarry', lodColor: 0x8a7f70 });
  }
  // conveyor on the pit floor
  const cb = new Builder();
  cb.box(-40, 6, -1.5, 40, 7, 1.5, Mat.Metal, { color: 0x6a6048 });
  for (let x = -38; x <= 38; x += 10) cb.box(x - 0.4, 0, -0.4, x + 0.4, 6, 0.4, Mat.Metal, { color: 0x5a5040 });
  ctx.place(cb, 'conveyor', p.x, p.z, 0.4, { y: floorH, flatten: false, poi: 'quarry', lodColor: 0x6a6048 });
  ctx.buyStations.push({ x: p.x - R - 40, y: 0, z: p.z + 40, a: 0 });
  ctx.contracts.push({ x: p.x, y: 0, z: p.z });
}

function farmland(ctx: GenContext) {
  const p = poi('farmland');
  const rng = ctx.rng;
  for (let i = 0; i < 7; i++) {
    const x = p.x + rng.range(-200, 200), z = p.z + rng.range(-180, 180);
    const a = rng.range(0, Math.PI);
    if (!ctx.occ.free(x, z, a, 24, 16, 2)) continue;
    const b = warehouse(rng, 22, 14, 7, { wall: Mat.Wood, wallColor: rng.pick([0x8e3a2c, 0x7a5a3a, 0x9a6040]), trim: 0, roof: Mat.Roof, roofColor: 0x4a4f55 });
    ctx.place(b, 'barn', x, z, a, { poi: 'farmland', lodColor: 0x8e3a2c });
    const sb = new Builder();
    sb.box(-3, 0, -3, 3, 16, 3, Mat.Metal, { color: 0xb8b8b0, shape: 'cyl' });
    const [sx, sz] = [x + Math.cos(a) * 16, z - Math.sin(a) * 16];
    if (ctx.occ.free(sx, sz, 0, 7, 7, 0)) ctx.place(sb, 'silo', sx, sz, 0, { poi: 'farmland', lodColor: 0xb8b8b0 });
  }
  ctx.buyStations.push({ x: p.x - 60, y: 0, z: p.z - 100, a: 0 });
  ctx.contracts.push({ x: p.x + 120, y: 0, z: p.z + 60 });
}

function lumber(ctx: GenContext) {
  const p = poi('lumber');
  const rng = ctx.rng;
  const mill = warehouse(rng, 50, 24, 10, { wall: Mat.Wood, wallColor: 0x7a5e44, trim: 0, roof: Mat.Roof, roofColor: 0x4a4f55 });
  ctx.place(mill, 'mill', p.x, p.z, 0.2, { poi: 'lumber', lodColor: 0x7a5e44 });
  for (let i = 0; i < 10; i++) {
    const b = new Builder();
    const n = rng.int(3, 5);
    for (let k = 0; k < n; k++) for (let l = 0; l < 3 - (k > 1 ? 1 : 0); l++) b.box(-6, l * 0.8, -2 + k * 0.8, 6, l * 0.8 + 0.8, -1.2 + k * 0.8, Mat.Wood, { color: 0x8a6a48, shape: 'cyl' });
    const x = p.x + rng.range(-90, 90), z = p.z + rng.range(-70, 70);
    if (!ctx.occ.free(x, z, 0, 13, 5, 1)) continue;
    ctx.place(b, 'logs', x, z, rng.range(0, Math.PI), { poi: 'lumber', lodColor: 0x8a6a48 });
  }
  // water tower
  const wt = new Builder();
  for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) wt.box(x - 0.3, 0, z - 0.3, x + 0.3, 16, z + 0.3, Mat.Metal, { color: 0x6a6a64 });
  wt.box(-4, 16, -4, 4, 22, 4, Mat.Metal, { color: 0x8a8a84, shape: 'cyl' });
  ctx.place(wt, 'watertower', p.x + 60, p.z - 50, 0, { poi: 'lumber', lodColor: 0x8a8a84 });
  ctx.buyStations.push({ x: p.x - 50, y: 0, z: p.z + 70, a: 0 });
}

function militaryBase(ctx: GenContext) {
  const p = poi('military_base');
  // 2020: barracks tent compound and earth-covered grass-roof hangars
  placeNear(ctx, barracksCompound, 'barracks', p.x - 70, p.z + 50, 90, 62, 0x5a6238, 200, 8, 'military_base');
  for (let i = 0; i < 3; i++) placeNear(ctx, grassHangar, 'hangar', p.x + 40 + i * 54, p.z - 10, 54, 38, 0x5e6e3c, 160, 8, 'military_base');
  for (let i = 0; i < 2; i++) {
    const b = new Builder(), h = 40;
    b.box(-1, 0, -1, 1, h, 1, Mat.Metal, { color: 0x9a9a94 });
    for (let y = 8; y < h; y += 8) b.box(-2.5, y, -0.15, 2.5, y + 0.3, 0.15, Mat.Metal, { color: 0x9a9a94, noCollide: true });
    ctx.place(b, 'comms', p.x - 60 + i * 120, p.z - 70, 0, { poi: 'military_base', lodColor: 0x9a9a94 });
  }
  // dolosse / concrete blocks on the apron
  for (let i = 0; i < 20; i++) {
    const b = new Builder();
    b.box(-1, 0, -1, 1, 1.4, 1, Mat.Concrete, { color: 0xb2ada4 });
    const x = p.x + ctx.rng.range(-80, 80), z = p.z + ctx.rng.range(-60, 60);
    if (ctx.occ.free(x, z, 0, 2, 2, 0.5)) ctx.place(b, 'block', x, z, ctx.rng.range(0, 3), { poi: 'military_base', lodColor: 0xb2ada4 });
  }
  ctx.buyStations.push({ x: p.x + 50, y: 0, z: p.z + 90, a: 0 });
  ctx.contracts.push({ x: p.x - 40, y: 0, z: p.z + 40 });
}

function promenade(ctx: GenContext) {
  const p = poi('promenade_east');
  // ferris wheel: a vertical ring of boxes (visual) with a solid base
  const b = new Builder(), R = 22, cy = R + 4;
  b.box(-3, 0, -2, 3, 4, 2, Mat.Concrete, { color: 0x999 });
  for (const zz of [-1.6, 1.6]) { b.box(-0.4, 0, zz - 0.2, 0.4, cy, zz + 0.2, Mat.Metal, { color: 0xd8d8d8 }); }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, x = Math.cos(a) * R, y = cy + Math.sin(a) * R;
    b.box(x - 1.4, y - 0.3, -1.3, x + 1.4, y + 0.3, 1.3, Mat.Metal, { color: 0xd8d8d8, noCollide: true });
    if (i % 3 === 0) b.box(x - 1, y - 2.4, -0.9, x + 1, y - 0.6, 0.9, Mat.Metal, { color: [0xc0392b, 0x2e86c1, 0xf1c40f][i % 3 === 0 ? (i / 3) % 3 : 0], noCollide: true });
  }
  ctx.place(b, 'ferris', p.x + 90, p.z + 20, 0.4, { poi: 'promenade_east', lodColor: 0xd8d8d8 });
  ctx.buyStations.push({ x: p.x - 20, y: 0, z: p.z + 30, a: 0 });
  ctx.contracts.push({ x: p.x + 40, y: 0, z: p.z - 30 });
  const pw = poi('promenade_west'); ctx.buyStations.push({ x: pw.x + 10, y: 0, z: pw.z - 20, a: 0 }); ctx.contracts.push({ x: pw.x - 30, y: 0, z: pw.z + 20 });
}

/** Buy stations / contracts / vehicle spawns at the remaining POIs. */
function services(ctx: GenContext) {
  const rng = new Rng(77);
  for (const id of ['downtown', 'park', 'hills', 'stadium', 'lozoff_pass', 'bloc_18', 'riverside', 'bloc_16', 'junkyard', 'graveyard', 'torsk_bloc', 'bloc_6', 'jarvdinsk_spomenik', 'airport_maintenance', 'prison']) {
    const p = poi(id);
    if (id === 'downtown') { ctx.buyStations.push({ x: p.x - 60, y: 0, z: p.z + 20, a: 0 }, { x: p.x + 70, y: 0, z: p.z - 60, a: 0 }); }
    else if (['park', 'hills', 'lozoff_pass', 'bloc_18', 'junkyard', 'graveyard'].includes(id)) ctx.buyStations.push({ x: p.x + rng.range(-30, 30), y: 0, z: p.z + rng.range(-30, 30), a: 0 });
    ctx.contracts.push({ x: p.x + rng.range(-60, 60), y: 0, z: p.z + rng.range(-60, 60) });
  }
  // extra contracts spread over the map
  for (let i = 0; i < 30; i++) ctx.contracts.push({ x: rng.range(400, 2900), y: 0, z: rng.range(500, 2900) });
  for (let i = 0; i < 90; i++) ctx.vehicleSpawns.push({ x: rng.range(300, 3000), y: 0, z: rng.range(400, 2950), a: rng.range(0, 6.28) });
  void house; void shop;
}

/** The Gulag: a shower-block arena floating out of bounds over the NW mountains. */
export const GULAG_POS = { x: 260, y: 900, z: 260 };
export const GULAG_ARENAS = 8;
/** Arena i is offset along +x; arena 0 hosts the spectator balcony view. */
export const gulagArena = (i: number) => ({ x: GULAG_POS.x + i * 70, y: GULAG_POS.y, z: GULAG_POS.z });
export const GULAG_SPAWNS: [number, number, number][] = [[-17, 0.1, 0], [17, 0.1, 0]];
export const GULAG_BALCONY_Z = 12.5;
export function buildGulag(ctx: GenContext) {
  const b = new Builder(), W = 44, D = 22, H = 9;
  const hw = W / 2, hd = D / 2;
  b.box(-hw - 6, -1, -hd - 6, hw + 6, 0.1, hd + 6, Mat.Tile, { color: 0xb8b8b0 }); // floor (incl. balcony area below)
  b.box(-hw - 6, H + 4, -hd - 6, hw + 6, H + 5, hd + 6, Mat.Concrete, { color: 0x8a8a84 }); // ceiling
  for (const z of [-hd - 6, hd + 6]) b.box(-hw - 6, 0, z - 0.5, hw + 6, H + 4, z + 0.5, Mat.Tile, { color: 0xc8c6bc });
  for (const x of [-hw - 6, hw + 6]) b.box(x - 0.5, 0, -hd - 6, x + 0.5, H + 4, hd + 6, Mat.Tile, { color: 0xc8c6bc });
  // arena walls with barred windows the spectators look through
  for (const s of [-1, 1]) {
    b.wall(0, -hw, hw, s * hd, 0, 4.5, 0.3, Mat.Tile, [], 0xd0cec4);
    for (let x = -hw; x < hw; x += 1.2) b.box(x, 4.5, s * hd - 0.08, x + 0.12, H, s * hd + 0.08, Mat.Metal, { color: 0x333333 }); // bars
    // balcony walkway for spectators
    b.box(-hw, 4.3, s * (hd + 0.2), hw, 4.5, s * (hd + 5.5), Mat.Concrete, { color: 0x9a968e });
  }
  for (const x of [-hw, hw]) b.wall(1, -hd, hd, x, 0, H, 0.3, Mat.Tile, [], 0xd0cec4);
  // cover: centre divider + shower stalls, symmetric
  b.block(0, 0, 1.2, 6, 0.1, 1.6, Mat.Concrete, { color: 0x9a9890 });
  for (const s of [-1, 1]) {
    b.block(s * 8, -5, 3, 0.4, 0.1, 2.2, Mat.Tile, { color: 0xd8d6cc });
    b.block(s * 8, 5, 3, 0.4, 0.1, 2.2, Mat.Tile, { color: 0xd8d6cc });
    b.block(s * 12, 0, 0.4, 5, 0.1, 2.2, Mat.Tile, { color: 0xd8d6cc });
    b.block(s * 4.5, -7.5, 1.4, 1.4, 0.1, 1.1, Mat.Wood, { color: 0x6a4a30 });
    b.block(s * 4.5, 7.5, 1.4, 1.4, 0.1, 1.1, Mat.Wood, { color: 0x6a4a30 });
    b.block(s * 16, -7, 0.4, 3, 0.1, 2.2, Mat.Tile, { color: 0xd8d6cc });
    b.block(s * 16, 7, 0.4, 3, 0.1, 2.2, Mat.Tile, { color: 0xd8d6cc });
  }
  for (let i = 0; i < GULAG_ARENAS; i++) { const a = gulagArena(i); const bb = new Builder(); bb.parts = b.parts.map((p) => ({ ...p })); ctx.place(bb, 'gulag', a.x, a.z, 0, { y: a.y, flatten: false, mark: false, lodColor: 0xc8c6bc }); }
}

/** Fire stations and gas stations where 2020 Verdansk had them (approximate, near the named places). */
function prefabs2020(ctx: GenContext) {
  for (const id of ['stadium', 'promenade_west', 'downtown', 'hills', 'lumber', 'military_base']) { const p = poi(id); placeNear(ctx, fireStation, 'firestation', p.x + p.r * 0.6, p.z + p.r * 0.4, 20, 19, 0x9a5a44); }
  for (const id of ['bloc_18', 'lozoff_pass', 'farmland', 'riverside', 'junkyard', 'airport_maintenance', 'bloc_16', 'port']) { const p = poi(id); placeNear(ctx, gasStation, 'gasstation', p.x - p.r * 0.5, p.z + p.r * 0.5, 13, 18, 0xd8d4ca); }
}
