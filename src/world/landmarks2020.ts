/**
 * Landmark rebuilds following the 2020 Tac Map Atlas (see .harness/ref/interiors/spec.md §4). Curved
 * parts (drums, rings, domes) are built from small rotated sub-structures, since a Builder only makes
 * axis-aligned boxes in its own frame.
 */
import { Mat } from './collision';
import { Builder } from './builder';
import { poi } from './mapdata';
import type { GenContext } from './mapgen';

export interface Frame { x: number; z: number; y: number; a: number; kind: string; poi: string; lod: number }

/** Place a builder at local (lx, lz) with local rotation la inside a frame (no flattening / reservation). */
export function sub(ctx: GenContext, f: Frame, lx: number, lz: number, la: number, b: Builder, kind = f.kind) {
  const c = Math.cos(f.a), s = Math.sin(f.a);
  return ctx.place(b, kind, f.x + lx * c + lz * s, f.z - lx * s + lz * c, f.a + la, { y: f.y, flatten: false, mark: false, poi: f.poi, lodColor: f.lod });
}
/** Prepare ground for a landmark: flatten a w×d area and reserve it; returns the frame. */
export function frame(ctx: GenContext, id: string, x: number, z: number, a: number, w: number, d: number, kind: string, lod: number, pad = 6): Frame {
  const y = ctx.footprintHeights(x, z, a, w, d).avg;
  ctx.flatten(x, z, a, w, d, y - 0.05, 18);
  ctx.occ.mark(x, z, a, w + pad * 2, d + pad * 2, 0, 1);
  return { x, z, y, a, kind, poi: id, lod };
}

/**
 * Arc of wall segments around (cx, cz): radius r, angles t0..t1 (radians, measured from local +x toward
 * local +z). Each segment gets openings from `ops(i, n)`.
 */
function arcWall(ctx: GenContext, f: Frame, cx: number, cz: number, r: number, t0: number, t1: number, n: number, y0: number, h: number, mat: Mat, color: number, ops: (i: number, n: number, seg: number) => { u0: number; u1: number; v0: number; v1: number; glass?: boolean; open?: boolean }[]) {
  const dt = (t1 - t0) / n, seg = 2 * r * Math.sin(dt / 2) + 0.12;
  for (let i = 0; i < n; i++) {
    const t = t0 + (i + 0.5) * dt;
    const b = new Builder();
    b.wall(0, -seg / 2, seg / 2, 0, y0, h, 0.3, mat, ops(i, n, seg), color);
    // local frame: x along the tangent, z outward; rotation so local +z points along (cos t, sin t)
    sub(ctx, f, cx + Math.cos(t) * r * Math.cos(dt / 2), cz + Math.sin(t) * r * Math.cos(dt / 2), Math.atan2(Math.cos(t), Math.sin(t)), b);
  }
}
/** Ring (annulus) of flat deck pieces between r0 and r1 at height y (top), angles t0..t1. */
function arcDeck(ctx: GenContext, f: Frame, cx: number, cz: number, r0: number, r1: number, t0: number, t1: number, n: number, y: number, t: number, mat: Mat, color: number, rail = 0, railGaps: number[] = []) {
  const dt = (t1 - t0) / n;
  for (let i = 0; i < n; i++) {
    const a = t0 + (i + 0.5) * dt, rm = (r0 + r1) / 2, len = 2 * r1 * Math.sin(dt / 2) + 0.15;
    const b = new Builder();
    b.box(-len / 2, y - t, -(r1 - r0) / 2, len / 2, y, (r1 - r0) / 2, mat, { color });
    if (rail && !railGaps.some((g) => Math.abs(a - g) < dt * 0.8)) b.box(-len * 0.45 * r0 / r1, y, -(r1 - r0) / 2, len * 0.45 * r0 / r1, y + rail, -(r1 - r0) / 2 + 0.06, Mat.Metal, { color: 0x9aa0a4 });
    sub(ctx, f, cx + Math.cos(a) * rm, cz + Math.sin(a) * rm, Math.atan2(Math.cos(a), Math.sin(a)), b);
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * BCH4 TV Station (Zone 4A). A studio block (~52 × 32 m, two levels, main roof 9 m) with a low
 * one-storey office tier along its south side (roof 4.5 m), a brick penthouse with the BCH4 letters,
 * and a two-storey glass drum on the west holding the foyer: reception desk, two stairs up to a curved
 * mezzanine ring (the CoD4 "Broadcast" lobby). Studio hall is double height with 6 pairs of doors;
 * 2F offices overlook it; a maintenance stairwell runs up to the roof; exterior metal steps climb to the
 * low roof, which has double doors into 2F and a ladder to the main roof; gantry stairs lead onto the
 * penthouse roof.
 */
export function tvStation2020(ctx: GenContext) {
  const p = poi('tv_station');
  const f = frame(ctx, 'tv_station', p.x - 10, p.z + 8, 0.3, 90, 50, 'tvstation', 0xb9b2a4);
  const wallC = 0xb9b2a4, brick = 0x8a5a44, st = Mat.Concrete;
  const X0 = -6, X1 = 46, Z0 = -16, Z1 = 16, F2 = 4.5, R = 9;
  const b = new Builder();
  b.box(X0 - 0.2, -1.5, Z0 - 0.2, X1 + 0.2, 0.05, Z1 + 8.2, Mat.Concrete, { color: 0x8a8884 }); // floor + low tier floor
  // --- exterior walls, main block (two levels)
  for (const [y, h, lvl] of [[0.05, F2 - 0.05, 0], [F2, R - F2, 1]] as [number, number, number][]) {
    const winsN = []; for (let x = X0 + 3; x < X1 - 3; x += 5) if (!(lvl === 0 && x > 37)) winsN.push({ u0: x - X0 - 1, u1: x - X0 + 1, v0: 1.1, v1: 2.6, glass: lvl === 1 });
    b.wall(0, X0, X1, Z0, y, h, 0.3, st, [...winsN, ...(lvl === 0 ? [{ u0: 39 - X0, u1: 40.8 - X0, v0: 0, v1: 2.3 }] : [])], wallC, -1); // N, loading double door at NE
    b.wall(1, Z0, Z1, X1, y, h, 0.3, st, lvl === 0 ? [{ u0: 2, u1: 3.8, v0: 0, v1: 2.3 }] : [{ u0: 6, u1: 8, v0: 1.1, v1: 2.6 }], wallC, 1); // E, SE double doors to the maintenance stair
    // S wall: ground floor opens to the low tier (doors), 2F has double doors out onto the low roof
    b.wall(0, X0, X1, Z1, y, h, 0.3, st, lvl === 0 ? [{ u0: 6, u1: 7, v0: 0, v1: 2.2 }, { u0: 20, u1: 21, v0: 0, v1: 2.2 }, { u0: 36, u1: 37, v0: 0, v1: 2.2 }] : [{ u0: 24, u1: 25.8, v0: 0, v1: 2.3 }, { u0: 4, u1: 6, v0: 1.1, v1: 2.6 }, { u0: 12, u1: 14, v0: 1.1, v1: 2.6 }, { u0: 32, u1: 34, v0: 1.1, v1: 2.6 }], wallC, 1);
    // W wall joins the drum: wide openings at the foyer (ground) and doors off the mezzanine (2F)
    b.wall(1, Z0, Z1, X0, y, h, 0.3, st, lvl === 0 ? [{ u0: 5, u1: 7, v0: 0, v1: 2.3 }, { u0: 21, u1: 25, v0: 0, v1: 2.6, open: true }] : [{ u0: 6, u1: 7.8, v0: 0, v1: 2.3 }, { u0: 21.3, u1: 23.1, v0: 0, v1: 2.3 }], wallC);
  }
  // --- ground floor plan
  // studio hall x 8..40, z -16..5, double height; 3 pairs of doors from the corridor (z=5), 3 from the west (x=8)
  b.wall(0, 8, 40, 5, 0.05, R - 0.05, 0.25, Mat.Plaster, [{ u0: 5, u1: 6.8, v0: 0, v1: 2.3 }, { u0: 15, u1: 16.8, v0: 0, v1: 2.3 }, { u0: 25, u1: 26.8, v0: 0, v1: 2.3 }], 0xcfc8bb);
  b.wall(1, Z0 + 0.15, 5, 8, 0.05, F2 - 0.05, 0.25, Mat.Plaster, [{ u0: 3, u1: 4.8, v0: 0, v1: 2.3 }, { u0: 9, u1: 10.8, v0: 0, v1: 2.3 }, { u0: 15, u1: 16.8, v0: 0, v1: 2.3 }], 0xcfc8bb);
  // viewing office above the west side of the studio: 2F wall with windows looking down into it
  b.wall(1, Z0 + 0.15, 5, 8, F2, R - F2, 0.25, Mat.Plaster, [{ u0: 2, u1: 8, v0: 0.9, v1: 2.4, glass: true }, { u0: 11, u1: 18, v0: 0.9, v1: 2.4, glass: true }], 0xcfc8bb);
  b.wall(1, Z0 + 0.15, 5, 40, 0.05, R - 0.05, 0.25, Mat.Plaster, [{ u0: 16, u1: 17.8, v0: 0, v1: 2.3 }, { u0: 1, u1: 2, v0: 0, v1: 2.2 }], 0xcfc8bb); // + door onto the stair landing
  // news desk + cubicles in the studio
  b.block(24, -6, 8, 1.2, 0.05, 1.1, Mat.Wood, { color: 0x3a2c22 });
  for (let x = 12; x < 38; x += 5) b.block(x, 1.5, 3, 0.1, 0.05, 1.4, Mat.Plaster, { color: 0x8a8f94 });
  for (let x = 12; x < 38; x += 8) for (const z of [-12, -2]) b.light(x, R - 0.3, z);
  // west of the studio (ground): break room / production office, a partition with a doorway
  b.wall(0, X0 + 0.15, 8, -5, 0.05, F2 - 0.05, 0.14, Mat.Plaster, [{ u0: 5, u1: 6, v0: 0, v1: 2.2 }], 0xd8d0c0);
  // corridor z 5..9; south offices z 9..16 with doors off the corridor
  b.wall(0, X0 + 0.15, 40, 9, 0.05, F2 - 0.05, 0.14, Mat.Plaster, [{ u0: 3, u1: 4, v0: 0, v1: 2.2 }, { u0: 13, u1: 14, v0: 0, v1: 2.2 }, { u0: 23, u1: 24, v0: 0, v1: 2.2 }, { u0: 33, u1: 34, v0: 0, v1: 2.2 }, { u0: 42, u1: 43, v0: 0, v1: 2.2 }], 0xd8d0c0);
  for (const x of [4, 14, 24, 34]) b.wall(1, 9.1, Z1 - 0.15, x, 0.05, F2 - 0.05, 0.14, Mat.Plaster, [], 0xd8d0c0);
  for (let x = X0 + 3; x < 40; x += 6) { b.light(x, F2 - 0.1, 7); b.light(x + 3, F2 - 0.1, 12.5); }
  // maintenance stairwell in the east strip x 40..46, z -16..-4: dogleg to 2F and the roof
  const sx0 = 40.2, sx1 = 45.8, sz0 = -15.8, sz1 = -5;
  b.wall(0, 40, X1, sz1, 0.05, R - 0.05, 0.25, Mat.Plaster, [], 0xcfc8bb);
  for (let k = 0; k < 2; k++) {
    const y = k * F2, mid = y + F2 / 2, sxm = (sx0 + sx1) / 2;
    b.ramp(sx0, y + 0.05, sz0 + 3.2, sxm - 0.05, mid, sz1 - 1.8, 1, 1);
    b.ramp(sxm + 0.05, mid, sz0 + 3.2, sx1, y + F2, sz1 - 1.8, 1, -1);
    b.box(sx0, mid - 0.2, sz1 - 1.8, sx1, mid, sz1 - 0.15, Mat.Concrete, { color: 0x9a968f });
    b.light(sxm, y + F2 - 0.1, sz0 + 1.5);
  }
  // NE carpeted hall: vending machines
  b.block(43, 4, 0.8, 1.6, 0.05, 1.9, Mat.Metal, { color: 0xa33a2a }); b.block(43, 7, 0.8, 1.6, 0.05, 1.9, Mat.Metal, { color: 0x2e5eaa });
  // --- 2F slab: everything but the studio hall and the stair shaft
  b.slab(X0, 5, X1, Z1, F2, 0.25, Mat.Concrete, []);
  b.slab(X0, Z0, 8, 5, F2, 0.25, Mat.Concrete, []);
  b.slab(40, Z0, X1, 5, F2, 0.25, Mat.Concrete, [[sx0, sz0 + 3.1, sx1, sz1]]);
  // 2F rooms: filing office (west), script room, offices over the south strip
  b.wall(0, X0 + 0.15, 40, 9, F2, R - F2, 0.14, Mat.Plaster, [{ u0: 8, u1: 9, v0: 0, v1: 2.2 }, { u0: 20, u1: 21, v0: 0, v1: 2.2 }, { u0: 30, u1: 31, v0: 0, v1: 2.2 }], 0xd8d0c0);
  b.wall(1, 9.1, Z1 - 0.15, 16, F2, R - F2, 0.14, Mat.Plaster, [{ u0: 2, u1: 3, v0: 0, v1: 2.2 }], 0xd8d0c0);
  b.wall(1, Z0 + 0.15, 5, 1, F2, R - F2, 0.14, Mat.Plaster, [{ u0: 9, u1: 10, v0: 0, v1: 2.2 }], 0xd8d0c0);
  for (let x = X0 + 3; x < 40; x += 7) { b.light(x, R - 0.1, 7); b.light(x, R - 0.1, 12.5); }
  b.light(3, R - 0.1, -6);
  for (const [x, z] of [[0, -10], [4, 12], [20, 12], [30, 7], [-2, 2], [43, -12]]) { b.addLoot(x, 0.05, z); b.addLoot(x + 1, F2, z); }
  b.addLoot(24, 0.05, -4); b.addLoot(15, 0.05, -12);
  // --- roof: main roof with a broken skylight over the studio, penthouse, stair hut, gantry
  b.slab(X0, Z0, X1, Z1, R, 0.3, Mat.Roof, [[20, -12, 28, -6], [sx0, sz0 + 3.1, sx1, sz1]]);
  b.wall(0, X0, X1, Z0 + 0.15, R, 0.9, 0.3, st, [], wallC); b.wall(1, Z0, Z1, X1 - 0.15, R, 0.9, 0.3, st, [], wallC);
  b.wall(0, X0, X1, Z1 - 0.15, R, 0.9, 0.3, st, [{ u0: 38.5, u1: 41, v0: 0, v1: 0.9 }], wallC); // gap at the ladder
  // stair hut over the maintenance stair, door onto the roof
  b.wall(1, sz0, sz1, sx0 - 0.1, R, 2.6, 0.2, st, [{ u0: 1, u1: 2, v0: 0, v1: 2.2 }], wallC);
  b.wall(0, sx0 - 0.1, X1, sz0, R, 2.6, 0.2, st, [], wallC); b.wall(0, sx0 - 0.1, X1, sz1, R, 2.6, 0.2, st, [], wallC); b.wall(1, sz0, sz1, X1 - 0.15, R, 2.6, 0.2, st, [], wallC);
  b.box(sx0 - 0.3, R + 2.6, sz0 - 0.2, X1, R + 2.8, sz1 + 0.2, Mat.Roof);
  // penthouse (brick) with the BCH4 letters, reached by a gantry stair
  const P = { x0: 12, x1: 38, z0: -9, z1: 4, h: 4 };
  b.wall(0, P.x0, P.x1, P.z0, R, P.h, 0.3, Mat.Brick, [], brick); b.wall(0, P.x0, P.x1, P.z1, R, P.h, 0.3, Mat.Brick, [{ u0: 3, u1: 4, v0: 0, v1: 2.2 }], brick);
  b.wall(1, P.z0, P.z1, P.x0, R, P.h, 0.3, Mat.Brick, [], brick); b.wall(1, P.z0, P.z1, P.x1, R, P.h, 0.3, Mat.Brick, [], brick);
  b.slab(P.x0 - 0.2, P.z0 - 0.2, P.x1 + 0.2, P.z1 + 0.2, R + P.h, 0.3, Mat.Roof, []);
  b.wall(0, P.x0, P.x1, P.z0 + 0.1, R + P.h, 0.7, 0.2, Mat.Brick, [], brick); b.wall(1, P.z0, P.z1, P.x0 + 0.1, R + P.h, 0.7, 0.2, Mat.Brick, [], brick);
  b.ramp(P.x1 + 0.4, R, P.z1 - 0.5, P.x1 + 1.8, R + P.h, P.z1 + 7, 1, -1, Mat.Metal); // gantry stair up the penthouse's east side
  const letter = (x: number) => b.box(x, R + P.h, -5.5, x + 2.4, R + P.h + 1.4, -4.9, Mat.Metal, { color: 0xc4201c });
  for (let i = 0; i < 4; i++) letter(17 + i * 3.2);
  b.light(25, R + P.h - 0.2, -2);
  // low office tier on the south: z 16..24, x -6..40, roof at 4.5 (walkable), SW metal door, exterior steps
  b.wall(0, X0, 40, Z1 + 8, 0.05, F2 - 0.05, 0.3, st, [{ u0: 4, u1: 6, v0: 1, v1: 2.4, glass: true }, { u0: 14, u1: 16, v0: 1, v1: 2.4, glass: true }, { u0: 24, u1: 26, v0: 1, v1: 2.4, glass: true }, { u0: 34, u1: 36, v0: 1, v1: 2.4, glass: true }], wallC, 1);
  b.wall(1, Z1, Z1 + 8, X0, 0.05, F2 - 0.05, 0.3, st, [{ u0: 3, u1: 4, v0: 0, v1: 2.2 }], wallC);
  b.wall(1, Z1, Z1 + 8, 40, 0.05, F2 - 0.05, 0.3, st, [], wallC);
  for (const x of [8, 22]) b.wall(1, Z1 + 0.15, Z1 + 7.85, x, 0.05, F2 - 0.05, 0.14, Mat.Plaster, [{ u0: 2, u1: 3, v0: 0, v1: 2.2 }], 0xd8d0c0);
  b.slab(X0 - 0.2, Z1, 40.2, Z1 + 8.2, F2, 0.3, Mat.Roof, []);
  for (let x = X0 + 4; x < 40; x += 8) b.light(x, F2 - 0.35, Z1 + 4);
  b.ramp(X0 + 0.2, 0.05, Z1 + 8.4, X0 + 14, F2, Z1 + 9.9, 0, 1, Mat.Metal); // metal steps up the SW corner to the low roof
  b.ladder(39.7, Z1 + 0.15, 0, 1, F2, R); // low roof -> main roof
  // satellite dishes on the roofs
  for (const [x, z, y] of [[-2, -12, R], [4, -12, R], [44, 10, R], [44, 2, R], [30, 20, F2], [36, 21, F2], [10, 12, R]] as [number, number, number][]) {
    b.box(x - 0.08, y, z - 0.08, x + 0.08, y + 2.2, z + 0.08, Mat.Metal, { color: 0x8a8f94 });
    b.box(x - 1.1, y + 1.6, z - 1.1, x + 1.1, y + 1.9, z + 1.1, Mat.Metal, { color: 0xe6e6e0, shape: 'cyl', noCollide: true });
  }
  // sandbag ring on the main roof
  b.box(-2, R, 0, 6, R + 0.8, 0.8, Mat.Concrete, { color: 0x8c7d5e }); b.box(-2, R, 6, 6, R + 0.8, 6.8, Mat.Concrete, { color: 0x8c7d5e });
  sub(ctx, f, 0, 0, 0, b);
  // --- the glass drum foyer: centre (-16, 0), radius 15, two storeys (9 m)
  const cx = -16, cz = 0, Rr = 15, H = R;
  const t0 = 0.84, t1 = Math.PI * 2 - 0.84, n = 21;
  arcWall(ctx, f, cx, cz, Rr, t0, t1, n, 0.05, H - 0.05, Mat.Concrete, 0xa9acb0, (i, nn, seg) => {
    const west = i === (nn - 1) / 2; // the entrance faces west (the middle segment)
    return west ? [{ u0: 0.3, u1: seg - 0.3, v0: 0, v1: 3, open: true }, { u0: 0.3, u1: seg - 0.3, v0: 3.4, v1: H - 0.6, glass: true }]
      : [{ u0: 0.25, u1: seg - 0.25, v0: 0.35, v1: F2 - 0.4, glass: true }, { u0: 0.25, u1: seg - 0.25, v0: F2 + 0.5, v1: H - 0.6, glass: true }];
  });
  // floor, mezzanine ring (r 9.5..14.7 at 4.5 m, rail on the inner edge), roof
  const fl = new Builder(); fl.box(cx - Rr, -1.5, cz - Rr, X0, 0.05, cz + Rr, Mat.Concrete, { color: 0x9a968f }); sub(ctx, f, 0, 0, 0, fl);
  arcDeck(ctx, f, cx, cz, 9.5, 14.7, 0.45, Math.PI * 2 - 0.45, 22, F2, 0.3, Mat.Concrete, 0x6a5a4a, 1.0, [1.23, Math.PI * 2 - 1.23]);
  arcDeck(ctx, f, cx, cz, 0, Rr + 0.3, 0, Math.PI * 2, 24, H + 0.3, 0.3, Mat.Roof, 0x8a8680);
  // reception desk, the red BCH4 column, two stairs flanking the desk up to the mezzanine
  const fy = new Builder();
  fy.block(cx - 2, cz, 1.2, 5, 0.05, 1.1, Mat.Wood, { color: 0x6b4a2f });
  fy.box(-21, 0.05, -7, -19, H, -5, Mat.Concrete, { color: 0xb3261e }); // the red BCH4 column
  // two flights behind the desk, inside the ring's inner edge (r < 9.5), each topping out at the mezzanine
  fy.ramp(-13.9, 0.05, -8.6, -12.1, F2, -0.8, 1, -1, Mat.Concrete);
  fy.ramp(-13.9, 0.05, 0.8, -12.1, F2, 8.6, 1, 1, Mat.Concrete);
  fy.box(-13.9, 0.05, -0.8, -12.1, 1.0, 0.8, Mat.Concrete, { color: 0xb8b4aa }); // plinth between the two flights
  fy.light(cx, H - 0.5, cz); fy.light(cx - 6, H - 0.5, cz + 6); fy.light(cx - 6, H - 0.5, cz - 6); fy.light(cx + 4, F2 - 0.5, cz + 11); fy.light(cx + 4, F2 - 0.5, cz - 11);
  fy.addLoot(cx - 4, 0.05, cz + 3); fy.addLoot(cx + 2, F2, cz + 12); fy.addLoot(cx + 2, F2, cz - 12);
  sub(ctx, f, 0, 0, 0, fy);
  // BCH4 sign on the drum
  const sg = new Builder(); sg.box(-1.6, 5.2, -0.1, 1.6, 7.2, 0.1, Mat.Trim, { color: 0xb3261e, noCollide: true });
  sub(ctx, f, cx - Math.cos(0.5) * (Rr + 0.3), cz + Math.sin(0.5) * (Rr + 0.3), Math.atan2(-Math.cos(0.5), Math.sin(0.5)), sg);
  // broadcast lattice tower
  const lt = new Builder(), h = 90;
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) lt.box(x - 0.4, 0, z - 0.4, x + 0.4, h, z + 0.4, Mat.Metal, { color: 0xb33a2a });
  for (let y = 10; y < h; y += 10) { lt.box(-4.4, y, -4.4, 4.4, y + 0.4, -3.6, Mat.Metal, { color: 0xd8d8d8, noCollide: true }); lt.box(-4.4, y, 3.6, 4.4, y + 0.4, 4.4, Mat.Metal, { color: 0xd8d8d8, noCollide: true }); }
  lt.box(-0.3, h, -0.3, 0.3, h + 12, 0.3, Mat.Metal, { color: 0xd8d8d8 });
  ctx.place(lt, 'lattice', p.x + 38, p.z - 30, 0, { poi: 'tv_station', lodColor: 0xb33a2a });
  ctx.buyStations.push({ x: p.x - 40, y: 0, z: p.z + 40, a: 0 });
  ctx.contracts.push({ x: p.x + 10, y: 0, z: p.z + 45 });
}

/**
 * Enclosed dogleg stair shaft: x0..x1 × z0..z1, `levels` flights-pairs of height h from y0. Front landing
 * at z0 (depth 1.3), half landing against z1. Returns the slab hole to leave at every upper level.
 */
export function dogleg(b: Builder, x0: number, x1: number, z0: number, z1: number, y0: number, levels: number, h: number, mat = Mat.Concrete): [number, number, number, number] {
  const Lf = 1.4, Lh = 1.3, xm = (x0 + x1) / 2;
  for (let k = 0; k < levels; k++) {
    const y = y0 + k * h, mid = y + h / 2;
    b.ramp(x0 + 0.1, y, z0 + Lf, xm - 0.05, mid, z1 - Lh, 1, 1, mat);
    b.ramp(xm + 0.05, mid, z0 + Lf, x1 - 0.1, y + h, z1 - Lh, 1, -1, mat);
    b.box(x0 + 0.1, mid - 0.2, z1 - Lh, x1 - 0.1, mid, z1, mat, { color: 0x9a968f });
    b.box(x0 + 0.1, y + h - 0.2, z0, x1 - 0.1, y + h, z0 + Lf, mat, { color: 0x9a968f }); // landing at the next level
    b.box(xm - 0.05, y, z0 + Lf + 0.6, xm + 0.05, y + h, z1 - Lh - 0.7, Mat.Plaster, { color: 0xbfb8aa });
    b.light(xm, y + h - 0.1, z0 + Lf / 2);
  }
  return [x0, z0 + Lf, x1, z1];
}

/**
 * Verdansk Train Station (Zone 3B), frame x along the tracks, front (plaza) at -z, platforms at +z.
 * Central domed block with the ticket hall (15 m+ tall volume, pilasters, info kiosk, chandeliers, arched
 * window over 3 double doors, back doors to the platforms, NE stairwell to the roof beside the dome);
 * 2-storey wings; 3-storey end pavilions with stairwells to their roofs; ladders link the roof levels.
 */
export function trainStation2020(ctx: GenContext, x: number, z: number, a: number) {
  const f = frame(ctx, 'train_station', x, z, a, 170, 110, 'station', 0xd9c79a);
  const cream = 0xd9c79a, band = 0xb9a57a, st = Mat.Plaster;
  const b = new Builder();
  b.box(-76, -1.5, -13, 76, 0.05, 13, Mat.Concrete, { color: 0x9a968f });
  // ---- central block x -15..15, z -12..12, 20 m
  const CH = 20;
  const front: any[] = [{ u0: 8.6, u1: 10.4, v0: 0, v1: 3 }, { u0: 14.1, u1: 15.9, v0: 0, v1: 3 }, { u0: 19.6, u1: 21.4, v0: 0, v1: 3 }, { u0: 8, u1: 22, v0: 6, v1: 15, glass: true }, { u0: 2, u1: 5, v0: 8, v1: 12, glass: true }, { u0: 25, u1: 28, v0: 8, v1: 12, glass: true }];
  b.wall(0, -15, 15, -12, 0.05, CH, 0.5, st, front, cream, -1, 0xece2c6);
  b.wall(0, -15, 15, 12, 0.05, CH, 0.5, st, [{ u0: 9.2, u1: 11, v0: 0, v1: 3 }, { u0: 19, u1: 20.8, v0: 0, v1: 3 }, { u0: 11, u1: 19, v0: 8, v1: 14, glass: true }], cream, 1, 0xece2c6);
  b.wall(1, -12, 12, -15, 0.05, CH, 0.5, st, [{ u0: 11.1, u1: 12.9, v0: 0, v1: 3 }], cream);
  b.wall(1, -12, 12, 15, 0.05, CH, 0.5, st, [{ u0: 11.1, u1: 12.9, v0: 0, v1: 3 }], cream);
  // pilasters, clocks, the info kiosk and benches, chandeliers
  for (const px of [-11, -6, 6, 11]) { b.box(px - 0.5, 0.05, -11.8, px + 0.5, 15, -11.2, st, { color: 0xe6dcc0 }); b.box(px - 0.5, 0.05, 11.2, px + 0.5, 15, 11.8, st, { color: 0xe6dcc0 }); }
  for (const pz of [-6, 6]) { b.box(-14.8, 0.05, pz - 0.5, -14.2, 15, pz + 0.5, st, { color: 0xe6dcc0 }); }
  b.box(-1.5, 0.05, 2, 1.5, 2.8, 5, Mat.Plaster, { color: 0xe8e2d2 }); // info kiosk
  for (const bx of [-9, 9]) b.block(bx, -3, 3.5, 0.6, 0.05, 0.5, Mat.Wood, { color: 0x5a3d26 });
  b.box(-4, 9, -0.2, 4, 11.5, 0.2, Mat.Trim, { color: 0x1c1f22, noCollide: true }); // departures board
  for (const [lx, lz] of [[0, -5], [0, 5], [-8, 0], [8, 0]]) b.light(lx, 12, lz);
  b.addLoot(-10, 0.05, -8); b.addLoot(10, 0.05, -8); b.addLoot(0, 0.05, 7); b.addLoot(-12, 0.05, 9);
  // NE stairwell (just inside, to the right) up to the roof: 4 levels of 5 m
  const sh = dogleg(b, 8.2, 14.6, 1.2, 11.6, 0.05, 4, (CH - 0.05) / 4);
  b.wall(1, 1.2, 11.6, 8.1, 0.05, CH, 0.2, Mat.Plaster, [{ u0: 0.2, u1: 1.3, v0: 0, v1: 2.2 }], 0xcfc8bb);
  b.wall(0, 8.1, 14.75, 1.1, 0.05, CH, 0.2, Mat.Plaster, [], 0xcfc8bb);
  // roof: flat at 20 with a balustrade, the dome tower, the stair hut beside it
  b.slab(-15.25, -12.25, 15.25, 12.25, CH, 0.4, Mat.Roof, [sh]);
  b.wall(0, -15, 15, -11.9, CH, 1.1, 0.3, st, [], cream); b.wall(0, -15, 15, 11.9, CH, 1.1, 0.3, st, [], cream);
  b.wall(1, -12, 12, -14.9, CH, 1.1, 0.3, st, [], cream); b.wall(1, -12, 12, 14.9, CH, 1.1, 0.3, st, [], cream);
  b.box(-6, CH, -6, 6, CH + 5, 6, st, { color: cream });
  b.box(-5.2, CH + 5, -5.2, 5.2, CH + 8, 5.2, Mat.Metal, { color: 0x9a9280, shape: 'cyl' });
  b.box(-3.4, CH + 8, -3.4, 3.4, CH + 10, 3.4, Mat.Metal, { color: 0x9a9280, shape: 'cyl' });
  b.wall(1, 1.2, 11.6, 8.1, CH, 2.6, 0.2, st, [{ u0: 0.2, u1: 1.3, v0: 0, v1: 2.2 }], cream);
  b.wall(1, 1.2, 11.6, 14.75, CH, 2.6, 0.2, st, [], cream);
  b.wall(0, 8.1, 14.75, 1.1, CH, 2.6, 0.2, st, [], cream); b.wall(0, 8.1, 14.75, 11.7, CH, 2.6, 0.2, st, [], cream);
  b.box(7.9, CH + 2.6, 0.9, 14.95, CH + 2.8, 11.9, Mat.Roof);
  b.box(-4, CH - 3, -12.4, 4, CH - 1.2, -12.25, Mat.Trim, { color: 0xb3261e, noCollide: true }); // ВОКЗАЛ sign
  // front steps and a brick plinth band
  for (let k = 0; k < 3; k++) b.box(-11, -0.4 + k * 0.15, -14.4 + k * 0.6, 11, -0.25 + k * 0.15, -12.25, Mat.Concrete, { color: 0xb0aca2 });
  // back doors down to platform 1 (1.1 m up): ramps
  for (const rx of [-5.9, 4.1]) b.ramp(rx, 0.05, 12.3, rx + 1.8, 1.1, 18.2, 1, 1, Mat.Concrete);
  // ---- wings (2 storeys) and pavilions (3 storeys), mirrored
  for (const sgn of [-1, 1]) {
    const wx0 = sgn > 0 ? 15 : -60, wx1 = sgn > 0 ? 60 : -15, WZ = 9, WH = 9;
    for (const [y, h] of [[0.05, 4.45], [4.5, 4.5]]) {
      const wins = []; for (let u = 3; u < 44; u += 5) wins.push({ u0: u, u1: u + 1.6, v0: 1, v1: 3, glass: false });
      const doorsF = y < 1 ? [{ u0: 12, u1: 13.8, v0: 0, v1: 2.4 }, { u0: 30, u1: 31.8, v0: 0, v1: 2.4 }] : [];
      b.wall(0, wx0, wx1, -WZ, y, h, 0.4, st, [...wins.filter((o) => !doorsF.some((d) => o.u1 > d.u0 - 0.3 && o.u0 < d.u1 + 0.3)), ...doorsF], cream, -1, 0xece2c6);
      b.wall(0, wx0, wx1, WZ, y, h, 0.4, st, [...wins.filter((o) => y > 1 || Math.abs(o.u0 - 22) > 3), ...(y < 1 ? [{ u0: 22, u1: 23.8, v0: 0, v1: 2.4 }] : [])], cream, 1, 0xece2c6);
      for (const cxw of [wx0 + 15, wx0 + 30]) b.wall(1, -WZ + 0.2, WZ - 0.2, cxw, y, h, 0.15, Mat.Plaster, [{ u0: 8, u1: 9.2, v0: 0, v1: 2.2 }], 0xd8d0c0);
      for (let lx = wx0 + 7; lx < wx1; lx += 15) b.light(lx, y + h - 0.1, 0);
      b.addLoot(wx0 + 5, y, -5); b.addLoot(wx0 + 22, y, 5); b.addLoot(wx0 + 38, y, -4);
    }
    b.box(wx0, -0.3, -WZ - 0.05, wx1, 1.2, -WZ + 0.05, Mat.Brick, { color: band, noCollide: true });
    b.slab(wx0, -WZ, wx1, WZ, 4.5, 0.25, Mat.Concrete, []);
    b.slab(wx0 - 0.2, -WZ - 0.2, wx1 + 0.2, WZ + 0.2, WH, 0.3, Mat.Roof, []);
    b.wall(0, wx0, wx1, -WZ + 0.1, WH, 0.9, 0.2, st, [], cream); b.wall(0, wx0, wx1, WZ - 0.1, WH, 0.9, 0.2, st, [], cream);
    // pavilion
    const px0 = sgn > 0 ? 60 : -75, px1 = sgn > 0 ? 75 : -60, PH = 13.5;
    const outer = sgn > 0 ? px1 : px0, inner = sgn > 0 ? px0 : px1;
    for (const [y, h] of [[0.05, 4.45], [4.5, 4.5], [9, 4.5]] as [number, number][]) {
      const wins = [{ u0: 2.5, u1: 4.5, v0: 1, v1: 3 }, { u0: 10.5, u1: 12.5, v0: 1, v1: 3 }];
      b.wall(0, px0, px1, -12, y, h, 0.4, st, y < 1 ? [{ u0: 6.6, u1: 8.4, v0: 0, v1: 2.4 }, ...wins] : wins, cream, -1, 0xece2c6);
      b.wall(0, px0, px1, 12, y, h, 0.4, st, wins, cream, 1, 0xece2c6);
      b.wall(1, -12, 12, outer, y, h, 0.4, st, [{ u0: 4, u1: 6, v0: 1, v1: 3 }, { u0: 18, u1: 20, v0: 1, v1: 3 }], cream, sgn as 1 | -1);
      // inner wall: doors into the wing on both wing levels; above, a plain wall facing the wing roof
      b.wall(1, -12, 12, inner, y, h, 0.4, st, y < 5 ? [{ u0: 13, u1: 14.2, v0: 0, v1: 2.2 }] : [], cream);
      b.light((px0 + px1) / 2 - sgn * 2, y + h - 0.1, 4);
      b.addLoot((px0 + px1) / 2, y, 6);
    }
    // stair shaft on the pavilion's outer side, 3 levels to the roof
    const sx0 = sgn > 0 ? 69.4 : -74.6, sx1 = sgn > 0 ? 74.6 : -69.4, sInner = sgn > 0 ? sx0 - 0.1 : sx1 + 0.1;
    const hole = dogleg(b, sx0, sx1, -11.6, -1.2, 0.05, 3, 4.5);
    for (const y of [0.05, 4.5, 9]) b.wall(1, -11.6, -1.2, sInner, y, 4.45, 0.2, Mat.Plaster, [{ u0: 0.2, u1: 1.3, v0: 0, v1: 2.2 }], 0xcfc8bb);
    b.wall(0, Math.min(sx0, sx1) - 0.1, Math.max(sx0, sx1) + 0.1, -1.1, 0.05, PH, 0.2, Mat.Plaster, [], 0xcfc8bb);
    for (const y of [4.5, 9]) b.slab(px0, -12, px1, 12, y, 0.25, Mat.Concrete, [hole]);
    b.slab(px0 - 0.2, -12.2, px1 + 0.2, 12.2, PH, 0.3, Mat.Roof, [hole]);
    b.wall(0, px0, px1, -11.9, PH, 1.0, 0.3, st, [], cream); b.wall(0, px0, px1, 11.9, PH, 1.0, 0.3, st, [], cream); b.wall(1, -12, 12, outer - sgn * 0.1, PH, 1.0, 0.3, st, [], cream);
    b.wall(1, -12, 12, inner + sgn * 0.1, PH, 1.0, 0.3, st, [{ u0: 16, u1: 18, v0: 0, v1: 1.0 }], cream); // gap where the ladder comes up
    // roof hut over the pavilion stair
    b.wall(1, -11.6, -1.2, sInner, PH, 2.6, 0.2, st, [{ u0: 0.2, u1: 1.3, v0: 0, v1: 2.2 }], cream);
    b.wall(0, Math.min(sx0, sx1) - 0.1, Math.max(sx0, sx1) + 0.1, -1.1, PH, 2.6, 0.2, st, [], cream);
    b.box(Math.min(sx0, sx1) - 0.3, PH + 2.6, -11.9, Math.max(sx0, sx1) + 0.3, PH + 2.8, -0.9, Mat.Roof);
    b.box(Math.min(px0, px1) + 3, PH - 2.5, -12.45, Math.max(px0, px1) - 3, PH - 1, -12.25, Mat.Trim, { color: 0xb3261e, noCollide: true }); // ВОКЗАЛ
    // ladders: wing roof -> pavilion roof, wing roof -> central roof
    b.ladder(inner - sgn * 0.2, 5, -sgn, 0, WH, PH);
    b.ladder(sgn * 15.25 + sgn * 0.05, 7, sgn, 0, WH, CH);
  }
  sub(ctx, f, 0, 0, 0, b);
  return f;
}

/**
 * Verdansk Hospital (Zone 3A). L-shaped main building: south wing A (x -45..45, z 0..24) with a
 * full-height foyer atrium and a 3F balcony ring around it; east wing B (x 21..45, z -40..0) with the
 * double-height cafeteria turned triage ward (skylight) and kitchens under a 3F cubicle office. Levels
 * are "1F" (ground) and "3F" (7 m); roof at 12 m with a raised helipad on the west. West stairwell by
 * the foyer (1F-3F), east stairwell by the cafeteria (1F-3F-roof), a lift bank with an ascender. The
 * 10-storey NW tower joins at 3F by a glazed skybridge; its stairs stop at 3F and an ascender runs to
 * the roof (2F and 4F+ are sealed).
 */
export function hospital2020(ctx: GenContext) {
  const p = poi('hospital');
  const f = frame(ctx, 'hospital', p.x, p.z - 6, 0, 100, 76, 'hospital', 0xe3d3ac);
  const cream = 0xe3d3ac, green = 0x3f4f46, wm = Mat.Concrete;
  const F3 = 7, RF = 12;
  const b = new Builder();
  b.box(-45.2, -1.5, -40.2, 45.2, 0.05, 24.2, Mat.Concrete, { color: 0xb0aca2 });
  b.box(-45.2, -1.5, -40.2, 20.8, 0.05, -0.2, Mat.Concrete, { color: 0xb0aca2, noCollide: true });
  const win = (u: number, lvl: number) => ({ u0: u, u1: u + 1.8, v0: lvl ? 1.0 : 1.3, v1: lvl ? 3.2 : 3.8, glass: false });
  const wins = (len: number, lvl: number, skip: [number, number][] = []) => { const o = []; for (let u = 2.5; u < len - 2.5; u += 4.5) if (!skip.some(([a, c]) => u + 1.8 > a - 0.4 && u < c + 0.4)) o.push(win(u, lvl)); return o; };
  // ---- wing A exterior (two levels: 0..7 and 7..12)
  for (const [y, h, lvl] of [[0.05, F3 - 0.05, 0], [F3, RF - F3, 1]] as [number, number, number][]) {
    const sDoors: [number, number][] = lvl ? [] : [[40.1, 41.9], [48.1, 49.9], [73, 74.8], [77, 78.8]];
    b.wall(0, -45, 45, 24, y, h, 0.4, wm, [...wins(90, lvl, sDoors), ...sDoors.map(([a, c]) => ({ u0: a, u1: c, v0: 0, v1: 2.5 }))], cream, 1, 0xf0e6cc);
    const nDoors: [number, number][] = lvl ? [[11.5, 13.5]] : [];
    b.wall(0, -45, 21, 0, y, h, 0.4, wm, [...wins(66, lvl, [[11, 14], [58, 62]]), ...nDoors.map(([a, c]) => ({ u0: a, u1: c, v0: 0, v1: 2.3 }))], cream, -1, 0xf0e6cc); // N (skybridge door at 3F)
    b.wall(1, 0, 24, -45, y, h, 0.4, wm, lvl ? wins(24, 1) : [{ u0: 11.5, u1: 12.5, v0: 0, v1: 2.2 }, ...wins(24, 0, [[11, 13]])], cream, -1, 0xf0e6cc); // W, pantry door
    b.wall(1, 0, 24, 45, y, h, 0.4, wm, lvl ? wins(24, 1) : [{ u0: 11.1, u1: 12.9, v0: 0, v1: 2.4 }, ...wins(24, 0, [[10.5, 13.5]])], cream, 1, 0xf0e6cc); // E, double doors under the sign
  }
  // green pilasters on the facades
  for (let x = -44; x <= 44; x += 9) { b.box(x - 0.4, 0.05, 24.2, x + 0.4, RF, 24.55, wm, { color: green, noCollide: true }); }
  // canopies over the S entrances
  b.box(-8, 3.2, 24.2, 8, 3.5, 28, Mat.Concrete, { color: 0xd8d0bc }); b.box(26, 3.2, 24.2, 36, 3.5, 28, Mat.Concrete, { color: 0xd8d0bc });
  // ---- wing B exterior
  for (const [y, h, lvl] of [[0.05, F3 - 0.05, 0], [F3, RF - F3, 1]] as [number, number, number][]) {
    b.wall(1, -40, 0, 21, y, h, 0.4, wm, lvl ? wins(40, 1) : [{ u0: 11.1, u1: 12.9, v0: 0, v1: 2.4 }, ...wins(40, 0, [[10.5, 13.5]])], cream, -1, 0xf0e6cc); // W cafeteria double doors
    b.wall(1, -40, 0, 45, y, h, 0.4, wm, lvl ? wins(40, 1) : [{ u0: 11.1, u1: 12.9, v0: 0, v1: 2.4 }, ...wins(40, 0, [[10.5, 13.5]])], cream, 1, 0xf0e6cc); // E
    b.wall(0, 21, 45, -40, y, h, 0.4, wm, lvl ? wins(24, 1) : [{ u0: 5, u1: 6.8, v0: 0, v1: 2.4 }, { u0: 16, u1: 17.8, v0: 0, v1: 2.4 }], cream, -1, 0xf0e6cc); // N, 2 double doors
  }
  // ---- interior, wing A
  // west part: two corridors E-W with rooms (surgery, reception...) either side, both levels
  for (const [y, h] of [[0.05, F3 - 0.05], [F3, RF - F3]]) {
    const doorsAt = (xs: number[]) => xs.map((x) => ({ u0: x + 45 - 0.5, u1: x + 45 + 0.5, v0: 0, v1: 2.2 }));
    b.wall(0, -45, -16, 8, y, h, 0.15, Mat.Plaster, doorsAt([-40, -33, -26, -20]), 0xe8e2d2);
    b.wall(0, -45, -16, 16, y, h, 0.15, Mat.Plaster, doorsAt([-40, -33, -26, -20]), 0xe8e2d2);
    for (const x of [-37, -30, -23]) { b.wall(1, 0.2, 8, x, y, h, 0.15, Mat.Plaster, [], 0xe8e2d2); b.wall(1, 16, 23.8, x, y, h, 0.15, Mat.Plaster, [], 0xe8e2d2); }
    // east part: reception / ER bays
    b.wall(1, 0.2, 23.8, 21, y, h, 0.2, Mat.Plaster, [{ u0: 5, u1: 6.8, v0: 0, v1: 2.3 }, { u0: 17, u1: 18.8, v0: 0, v1: 2.3 }], 0xe8e2d2);
    for (const x of [28, 35]) b.wall(1, 12, 23.8, x, y, h, 0.15, Mat.Plaster, [{ u0: 1, u1: 2, v0: 0, v1: 2.2 }], 0xe8e2d2);
    for (let x = -40; x <= 40; x += 8) { b.light(x, y + h - 0.1, 12); b.light(x, y + h - 0.1, 4); }
  }
  // foyer atrium x -10..10, z 2..22: check-in booth, benches; 3F balcony ring (slab hole + rails)
  b.box(-3, 0.05, 11, 3, 1.1, 13, Mat.Wood, { color: 0x6b4a2f });
  for (const [x0, z0, x1, z1] of [[-7, 5, 7, 5.1], [-7, 18.9, 7, 19], [-7, 5, -6.9, 19], [6.9, 5, 7, 19]]) b.box(x0, F3, z0, x1, F3 + 1.05, z1, Mat.Metal, { color: 0x9aa0a4 });
  for (const [lx, lz] of [[0, 8], [0, 16], [-4, 12], [4, 12]]) b.light(lx, RF - 0.2, lz);
  // lift bank east of the foyer with an ascender (1F, 3F, roof)
  const lx0 = 11, lx1 = 13.4, lz0 = 1.2, lz1 = 4;
  b.wall(0, lx0, lx1, lz1, 0.05, RF + 3, 0.2, Mat.Concrete, [], 0x8a8680);
  b.wall(1, lz0 - 0.9, lz1, lx1, 0.05, RF + 3, 0.2, Mat.Concrete, [], 0x8a8680);
  b.wall(1, lz0 - 0.9, lz1, lx0, 0.05, RF + 3, 0.2, Mat.Concrete, [{ u0: 1.2, u1: 2.4, v0: 0, v1: 2.2, open: true }, { u0: 1.2, u1: 2.4, v0: F3, v1: F3 + 2.2, open: true }, { u0: 1.2, u1: 2.4, v0: RF, v1: RF + 2.2, open: true }], 0x8a8680);
  b.ascender((lx0 + lx1) / 2, (lz0 + lz1) / 2, -1, 0, 0.05, RF, [0.05, F3]);
  b.box(lx0 - 0.2, RF + 3, lz0 - 1, lx1 + 0.2, RF + 3.2, lz1 + 0.2, Mat.Roof);
  // west stairwell by the foyer (1F -> 3F), door on its east side at each level
  const wHole = dogleg(b, -16, -10, 2, 14, 0.05, 1, F3 - 0.05);
  b.wall(1, 2, 14, -10, 0.05, RF - 0.05, 0.2, Mat.Plaster, [{ u0: 0.15, u1: 1.3, v0: 0, v1: 2.2 }, { u0: 0.15, u1: 1.3, v0: F3, v1: F3 + 2.2 }], 0xcfc8bb);
  b.wall(1, 2, 14, -16, 0.05, RF - 0.05, 0.2, Mat.Plaster, [], 0xcfc8bb);
  b.wall(0, -16, -10, 14, 0.05, RF - 0.05, 0.2, Mat.Plaster, [], 0xcfc8bb);
  // 3F slab over wing A: holes for the atrium, the west stair and the lift
  b.slab(-45, 0, 45, 24, F3, 0.3, Mat.Concrete, [[-7, 5, 7, 19], wHole, [lx0, lz0 - 0.9, lx1, lz1]]);
  // ---- interior, wing B: cafeteria (double height) and kitchens under the 3F office
  b.wall(0, 21, 45, -15, 0.05, RF - 0.05, 0.25, Mat.Plaster, [{ u0: 4, u1: 5.8, v0: 0, v1: 2.4 }, { u0: 12, u1: 13.8, v0: 0, v1: 2.4 }, { u0: 3, u1: 9, v0: F3 + 1, v1: F3 + 2.4, glass: true }], 0xe8e2d2);
  b.wall(0, 21, 45, 0, 0.05, RF - 0.05, 0.25, Mat.Plaster, [{ u0: 3, u1: 4.8, v0: 0, v1: 2.4 }, { u0: 12, u1: 13.8, v0: 0, v1: 2.4 }, { u0: 3, u1: 4.8, v0: F3, v1: F3 + 2.4 }, { u0: 12, u1: 13.8, v0: F3, v1: F3 + 2.4 }], 0xe8e2d2);
  for (let x = 24; x < 44; x += 5) for (const z of [-35, -30, -24, -19]) {
    b.block(x, z, 1.0, 2.1, 0.05, 0.7, Mat.Plaster, { color: 0xe6eaec }); // triage beds
    b.block(x + 1.2, z, 0.05, 2.4, 0.05, 1.7, Mat.Plaster, { color: 0xc8c0a8 }); // privacy screens
  }
  for (let x = 25; x < 44; x += 6) for (const z of [-34, -27, -20]) b.light(x, RF - 0.3, z);
  b.block(43.5, -18, 0.8, 1.6, 0.05, 1.9, Mat.Metal, { color: 0xa33a2a });
  b.wall(1, -15, -0.2, 32, 0.05, F3 - 0.05, 0.15, Mat.Plaster, [{ u0: 6, u1: 7, v0: 0, v1: 2.2 }], 0xe8e2d2); // kitchens
  // east stairwell by the cafeteria (1F -> 3F -> roof)
  const eHole = dogleg(b, 38.8, 44.8, -14.8, -2.6, 0.05, 1, F3 - 0.05);
  dogleg(b, 38.8, 44.8, -14.8, -2.6, F3, 1, RF - F3);
  b.wall(1, -14.8, -2.6, 38.7, 0.05, RF + 2.6, 0.2, Mat.Plaster, [{ u0: 0.15, u1: 1.3, v0: 0, v1: 2.2 }, { u0: 0.15, u1: 1.3, v0: F3, v1: F3 + 2.2 }, { u0: 0.15, u1: 1.3, v0: RF, v1: RF + 2.2 }], 0xcfc8bb);
  b.wall(0, 38.7, 45, -2.5, 0.05, RF + 2.6, 0.2, Mat.Plaster, [], 0xcfc8bb);
  b.wall(0, 38.7, 45, -14.9, RF, 2.6, 0.2, wm, [], cream); b.box(38.5, RF + 2.6, -15.1, 45.2, RF + 2.8, -2.3, Mat.Roof);
  b.slab(21, -15, 45, 0, F3, 0.3, Mat.Concrete, [eHole]);
  for (let x = 23; x < 38; x += 4) for (const z of [-11, -6]) b.block(x, z, 1.6, 0.8, F3, F3 + 0.75, Mat.Wood, { color: 0x6b5a48 }); // cubicle desks
  for (let x = 24; x < 38; x += 6) b.light(x, RF - 0.1, -8);
  // ---- roof: skylights over the atrium and the cafeteria, helipad on a raised deck (west)
  b.slab(-45.3, -0.3, 45.3, 24.3, RF, 0.35, Mat.Roof, [[-6, 6, 6, 18], [lx0, lz0 - 0.9, lx1, lz1]]);
  b.slab(20.7, -40.3, 45.3, -0.3, RF, 0.35, Mat.Roof, [[26, -35, 40, -20], eHole]);
  for (const [x0, z0, x1, z1] of [[-45, 23.8, 45, 24.2], [-45, -0.2, 21, 0.2], [-45.2, 0, -44.8, 24], [44.8, -40, 45.2, 24], [20.8, -40, 21.2, 0], [21, -40.2, 45, -39.8]]) b.box(x0, RF, z0, x1, RF + 0.9, z1, wm, { color: cream });
  b.box(-43, RF, 4, -27, RF + 1.3, 20, Mat.Metal, { color: 0x5d6166 }); // helipad deck
  b.box(-38, RF + 1.3, 9, -32, RF + 1.32, 15, Mat.Trim, { color: 0xe8e8e0, noCollide: true });
  b.ramp(-27, RF, 10, -23, RF + 1.3, 12, 0, -1, Mat.Metal); b.ramp(-36, RF, 20, -34, RF + 1.3, 23, 1, -1, Mat.Metal);
  // the red cross on the east roof, the VERDANSK HOSPITAL letters
  b.box(30, RF + 0.36, -28, 36, RF + 0.38, -27, Mat.Trim, { color: 0xeeeeee, noCollide: true }); b.box(32.5, RF + 0.36, -30.5, 33.5, RF + 0.38, -24.5, Mat.Trim, { color: 0xeeeeee, noCollide: true });
  for (let i = 0; i < 9; i++) b.box(-20 + i * 2.2, RF + 1, 23.4, -18.6 + i * 2.2, RF + 3, 23.6, Mat.Metal, { color: 0x9a2a22 });
  b.ladder(15, 0.2, 0, -1, 0.05, RF); // NE inner-corner ladder to the roof
  b.addLoot(0, 0.05, 8); b.addLoot(-30, 0.05, 4); b.addLoot(-30, F3, 20); b.addLoot(30, 0.05, -30); b.addLoot(28, F3, -8); b.addLoot(0, F3, 3); b.addLoot(-35, RF + 1.3, 12); b.addLoot(38, 0.05, 20);
  sub(ctx, f, 0, 0, 0, b);
  // ---- NW tower (x -40..-24, z -30..-14), 10 storeys of 3.5 m; stairs 1F -> 3F only, ascender to the roof
  const t = new Builder(), TH = 3.5, TF = 10, TR = TF * TH;
  const TX0 = -40, TX1 = -24, TZ0 = -30, TZ1 = -14;
  t.box(TX0 - 0.2, -1.5, TZ0 - 0.2, TX1 + 0.2, 0.05, TZ1 + 0.2, Mat.Concrete, { color: 0xb0aca2 });
  for (let k = 0; k < TF; k++) {
    const y = k * TH + (k === 0 ? 0.05 : 0), h = TH - (k === 0 ? 0.05 : 0), sealed = k === 1 || k > 2;
    const tw = [2.5, 6.5, 10.5].map((u) => ({ u0: u, u1: u + 2.2, v0: 0.9, v1: 2.8, glass: sealed }));
    t.wall(0, TX0, TX1, TZ1, y, h, 0.4, wm, k === 0 ? [{ u0: 3, u1: 4.8, v0: 0, v1: 2.4 }, ...tw.slice(1)] : k === 2 ? [{ u0: 6.2, u1: 8.2, v0: 0, v1: 2.3 }, tw[0], tw[2]] : tw, cream, 1, 0xf0e6cc);
    t.wall(0, TX0, TX1, TZ0, y, h, 0.4, wm, tw, cream, -1, 0xf0e6cc);
    t.wall(1, TZ0, TZ1, TX0, y, h, 0.4, wm, tw, cream, -1, 0xf0e6cc);
    t.wall(1, TZ0, TZ1, TX1, y, h, 0.4, wm, tw, cream, 1, 0xf0e6cc);
  }
  for (const x of [-37, -32, -27]) t.box(x - 0.4, 0.05, TZ1 + 0.2, x + 0.4, TR, TZ1 + 0.55, wm, { color: green, noCollide: true });
  // stair shaft (NE of the tower), 2 levels to 3F; 2F door locked
  const tHole = dogleg(t, -30.2, -24.4, -29.6, -18.6, 0.05, 2, TH - 0.025);
  t.wall(1, -29.6, -18.6, -30.3, 0.05, TR, 0.2, Mat.Plaster, [{ u0: 0.15, u1: 1.3, v0: 0, v1: 2.2 }, { u0: 0.15, u1: 1.3, v0: TH, v1: TH + 2.2, locked: true }, { u0: 0.15, u1: 1.3, v0: 2 * TH, v1: 2 * TH + 2.2 }], 0xcfc8bb);
  t.wall(0, -30.3, -24.2, -18.5, 0.05, TR, 0.2, Mat.Plaster, [], 0xcfc8bb);
  // lift shaft with the ascender (stops 1F, 3F, roof)
  const ex0 = -35, ex1 = -32.6, ez0 = -29.6, ez1 = -26.8;
  t.wall(0, ex0, ex1, ez1, 0.05, TR + 3, 0.2, Mat.Concrete, [], 0x8a8680); t.wall(1, ez0, ez1, ex0, 0.05, TR + 3, 0.2, Mat.Concrete, [], 0x8a8680);
  t.wall(1, ez0, ez1, ex1, 0.05, TR + 3, 0.2, Mat.Concrete, [0, 2 * TH, TR].map((v) => ({ u0: 0.8, u1: 2.0, v0: v, v1: v + 2.2, open: true })), 0x8a8680);
  t.ascender((ex0 + ex1) / 2, (ez0 + ez1) / 2, 1, 0, 0.05, TR, [0.05, 2 * TH]);
  t.box(ex0 - 0.2, TR + 3, ez0 - 0.3, ex1 + 1.6, TR + 3.2, ez1 + 0.2, Mat.Roof);
  t.wall(0, ex1, ex1 + 1.6, ez1, TR, 3, 0.2, wm, [], cream);
  // slabs: 2F, 3F, 3F ceiling, roof (4F+ are sealed and empty)
  t.slab(TX0, TZ0, TX1, TZ1, TH, 0.25, Mat.Concrete, [tHole, [ex0, ez0, ex1, ez1]]);
  t.slab(TX0, TZ0, TX1, TZ1, 2 * TH, 0.25, Mat.Concrete, [tHole, [ex0, ez0, ex1, ez1]]);
  t.slab(TX0, TZ0, TX1, TZ1, 3 * TH, 0.25, Mat.Concrete, [[ex0, ez0, ex1, ez1]]);
  t.slab(TX0 - 0.3, TZ0 - 0.3, TX1 + 0.3, TZ1 + 0.3, TR, 0.4, Mat.Roof, [[ex0, ez0, ex1, ez1]]);
  for (const [x0, z0, x1, z1] of [[TX0, TZ0, TX1, TZ0 + 0.3], [TX0, TZ1 - 0.3, TX1, TZ1], [TX0, TZ0, TX0 + 0.3, TZ1], [TX1 - 0.3, TZ0, TX1, TZ1]]) t.box(x0, TR, z0, x1, TR + 1.0, z1, wm, { color: cream });
  t.box(-37, TR, -24, -29, TR + 3, -16, wm, { color: cream }); // upper tier
  t.ladder(-33, -15.85, 0, 1, TR, TR + 3);
  for (let i = 0; i < 8; i++) t.box(-38 + i * 1.8, TR + 3, -16.3, -36.8 + i * 1.8, TR + 5, -16.1, Mat.Metal, { color: 0xb3261e }); // HOSPITAL letters
  // 3F: hallway along the south, 3 two-bed rooms to the north
  t.wall(0, TX0 + 0.2, -30.4, -21, 2 * TH, TH, 0.15, Mat.Plaster, [-37, -33.5].map((x) => ({ u0: x - TX0 - 0.5, u1: x - TX0 + 0.5, v0: 0, v1: 2.2 })), 0xe8e2d2);
  t.wall(1, TZ0 + 0.2, -21, -35.2, 2 * TH, TH, 0.15, Mat.Plaster, [], 0xe8e2d2);
  for (const [lx, lz] of [[-36, -17.5], [-28, -17], [-37.5, -26], [-32, -16]]) { t.light(lx, 2 * TH + TH - 0.1, lz); t.light(lx, TH - 0.1, lz); }
  t.block(-36, -17, 3, 1, 0.05, 1.1, Mat.Wood, { color: 0x6b4a2f }); // 1F reception
  t.addLoot(-36, 2 * TH, -26); t.addLoot(-37, 0.05, -20); t.addLoot(-32, TR, -20);
  sub(ctx, f, 0, 0, 0, t, 'hospital');
  // glazed skybridge at 3F: tower south wall (z -14) -> wing A north wall (z 0), x -34..-30
  const sk = new Builder();
  sk.box(-34, F3 - 0.3, -14, -30, F3, 0, Mat.Concrete, { color: 0xb0aca2 });
  sk.wall(1, -14, 0, -34, F3, 3, 0.15, Mat.Metal, [{ u0: 0.5, u1: 13.5, v0: 0.9, v1: 2.7, glass: true }], 0x6a6e72);
  sk.wall(1, -14, 0, -30, F3, 3, 0.15, Mat.Metal, [{ u0: 0.5, u1: 13.5, v0: 0.9, v1: 2.7, glass: true }], 0x6a6e72);
  sk.box(-34.1, F3 + 3, -14, -29.9, F3 + 3.2, 0, Mat.Roof);
  sk.light(-32, F3 + 2.9, -7);
  sub(ctx, f, 0, 0, 0, sk, 'hospital');
  // aid tents and the buy station
  for (let i = 0; i < 5; i++) {
    const tb = new Builder();
    tb.box(-3, 0, -2.5, 3, 2.6, 2.5, Mat.Plaster, { color: 0xe8e4d8, shape: 'gable', noCollide: false });
    tb.addLoot(0, 0.05, 0);
    ctx.place(tb, 'tent', p.x - 40 + i * 8, p.z + 34, 0, { poi: 'hospital', lodColor: 0xe8e4d8 });
  }
  ctx.buyStations.push({ x: p.x - 55, y: 0, z: p.z + 10, a: 0 });
}

/**
 * Airport control tower (Zone 2A). A horseshoe-shaped two-storey admin building (white corrugated siding,
 * roof not reachable from the ground) wraps the tower base. The tower's ground floor is a corridor around
 * the lift shaft; the only way up is the ascender, which stops at the office level (~42 m). From there a
 * stair climbs into the open-air cab (windows blown out) with a balcony round it; the small roof above is
 * only reachable by parachute.
 */
export function controlTower2020(ctx: GenContext, x: number, z: number) {
  const f = frame(ctx, 'airport', x, z, 0, 48, 32, 'ctower', 0xd4d0c6, 4);
  const white = 0xd9dbd6, grey = 0xd4d0c6, H = 3.75;
  // ---- horseshoe admin building (open to the south, around the tower): north bar + west and east bars
  const a = new Builder();
  a.box(-22.2, -1.5, -16.2, 22.2, 0.05, 12.2, Mat.Concrete, { color: 0x9a968f });
  type Bar = { x0: number; z0: number; x1: number; z1: number; doors: { side: 'n' | 's' | 'w' | 'e'; u: number }[] };
  const bars: Bar[] = [
    { x0: -22, z0: -16, x1: 22, z1: -8, doors: [{ side: 'n', u: 21.1 }, { side: 's', u: 21.1 }, { side: 'w', u: 3.1 }, { side: 'e', u: 3.1 }] },
    { x0: -22, z0: -8, x1: -10, z1: 12, doors: [{ side: 'w', u: 14 }, { side: 'e', u: 12 }, { side: 's', u: 5 }] },
    { x0: 10, z0: -8, x1: 22, z1: 12, doors: [{ side: 'e', u: 14 }, { side: 'w', u: 12 }, { side: 's', u: 5 }] },
  ];
  for (const B of bars) {
    const len = B.x1 - B.x0, dep = B.z1 - B.z0;
    for (const [y, h, lvl] of [[0.05, H - 0.05, 0], [H, H, 1]] as [number, number, number][]) {
      const ops = (L: number, side: string) => { const d = lvl ? [] : B.doors.filter((q) => q.side === side).map((q) => ({ u0: q.u, u1: q.u + 1.8, v0: 0, v1: 2.3 })); const o: any[] = [...d]; for (let u = 2; u < L - 2; u += 4) if (!d.some((q) => u + 1.6 > q.u0 - 0.3 && u < q.u1 + 0.3)) o.push({ u0: u, u1: u + 1.6, v0: 1, v1: 2.6, glass: true }); return o; };
      // shared walls between bars are built once (the north bar's south wall stops at the side bars)
      a.wall(0, B.x0, B.x1, B.z0, y, h, 0.25, Mat.Metal, B.z0 === -8 ? [] : ops(len, 'n'), white, -1);
      if (B.z1 === -8) { a.wall(0, -10, 10, -8, y, h, 0.25, Mat.Metal, ops(20, 's').map((o: any) => ({ ...o, u0: o.u0 - 12, u1: o.u1 - 12 })).filter((o: any) => o.u0 > 0 && o.u1 < 20), white, 1); }
      else a.wall(0, B.x0, B.x1, B.z1, y, h, 0.25, Mat.Metal, ops(len, 's'), white, 1);
      a.wall(1, B.z0, B.z1, B.x0, y, h, 0.25, Mat.Metal, ops(dep, 'w'), white, -1);
      a.wall(1, B.z0, B.z1, B.x1, y, h, 0.25, Mat.Metal, ops(dep, 'e'), white, 1);
    }
    a.slab(B.x0, B.z0, B.x1, B.z1, H, 0.25, Mat.Concrete, B.x1 === -10 ? [[-21.8, -6.2, -19.4, 6]] : []);
    a.slab(B.x0 - 0.3, B.z0 - 0.3, B.x1 + 0.3, B.z1 + 0.3, 2 * H, 0.3, Mat.Roof, []);
    for (let lx = B.x0 + 3; lx < B.x1; lx += 6) for (let lz = B.z0 + 2.5; lz < B.z1; lz += 6) { a.light(lx, H - 0.1, lz); a.light(lx, 2 * H - 0.1, lz); }
  }
  // partitions, reception, the stair (west bar) to 2F
  a.wall(0, -19.3, -10.1, 8.5, 0.05, H - 0.05, 0.15, Mat.Plaster, [{ u0: 4, u1: 5, v0: 0, v1: 2.2 }], 0xe8e2d2);
  a.wall(0, 10.1, 21.9, 2, 0.05, H - 0.05, 0.15, Mat.Plaster, [{ u0: 5, u1: 6, v0: 0, v1: 2.2 }], 0xe8e2d2);
  a.wall(1, -15.9, -8.1, 0, 0.05, H - 0.05, 0.15, Mat.Plaster, [{ u0: 3, u1: 4, v0: 0, v1: 2.2 }], 0xe8e2d2);
  a.ramp(-21.8, 0.05, -6, -19.6, H, 6, 1, 1, Mat.Concrete);
  a.block(-6, -12, 5, 1, 0.05, 1.1, Mat.Wood, { color: 0x6b4a2f });
  for (const [lx, lz, y] of [[-16, 8, 0.05], [16, -4, 0.05], [-5, -12, H], [16, 8, H], [-15, -12, 0.05]]) a.addLoot(lx, y, lz);
  sub(ctx, f, 0, 0, 0, a);
  // ---- the tower
  const t = new Builder(), R = 5.5, TOP = 42, CAB = 46;
  t.box(-R - 0.2, -1.5, -R - 0.2, R + 0.2, 0.05, R + 0.2, Mat.Concrete, { color: 0x9a968f });
  // shaft walls up to the office level; the ground floor opens south into the U's courtyard
  t.wall(0, -R, R, R, 0.05, TOP, 0.35, Mat.Concrete, [{ u0: R - 0.9, u1: R + 0.9, v0: 0, v1: 2.4 }], grey, 1);
  t.wall(0, -R, R, -R, 0.05, TOP, 0.35, Mat.Concrete, [], grey, -1);
  t.wall(1, -R, R, -R, 0.05, TOP, 0.35, Mat.Concrete, [], grey, -1);
  t.wall(1, -R, R, R, 0.05, TOP, 0.35, Mat.Concrete, [], grey, 1);
  for (const [fx, fz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) t.box(fx - 0.6, 0.05, fz - 0.6, fx + 0.6, TOP + 0.5, fz + 0.6, Mat.Concrete, { color: 0xc6c2b8 }); // corner fins
  // lift shaft in the middle, opening south at the bottom and at the office level; corridor wraps it
  const lx = 1.4;
  t.wall(0, -lx, lx, -lx, 0.05, TOP + 3, 0.2, Mat.Concrete, [], 0x8a8680);
  t.wall(1, -lx, lx, -lx, 0.05, TOP + 3, 0.2, Mat.Concrete, [], 0x8a8680);
  t.wall(1, -lx, lx, lx, 0.05, TOP + 3, 0.2, Mat.Concrete, [], 0x8a8680);
  t.wall(0, -lx, lx, lx, 0.05, TOP + 3, 0.2, Mat.Concrete, [{ u0: 0.8, u1: 2.0, v0: 0, v1: 2.2, open: true }, { u0: 0.8, u1: 2.0, v0: TOP, v1: TOP + 2.2, open: true }], 0x8a8680);
  t.ascender(0, 0, 0, 1, 0.05, TOP, [0.05]);
  for (const [px, pz] of [[-3.5, 3.5], [3.5, 3.5], [-3.5, -3.5], [3.5, -3.5]]) t.light(px, 3.4, pz);
  t.slab(-R + 0.2, -R + 0.2, R - 0.2, R - 0.2, 3.8, 0.2, Mat.Concrete, [[-lx, -lx, lx, lx]]); // ground-floor ceiling (the shaft above is sealed)
  // office / server level: a ring of rooms round the lift, windows all round
  t.slab(-R - 0.8, -R - 0.8, R + 0.8, R + 0.8, TOP, 0.3, Mat.Concrete, [[-lx, -lx, lx, lx]]);
  const ow = [{ u0: 1.5, u1: 4.5, v0: 1, v1: 2.6, glass: false }, { u0: 7, u1: 10, v0: 1, v1: 2.6, glass: false }];
  t.wall(0, -R - 0.8, R + 0.8, -R - 0.8, TOP, 3.8, 0.3, Mat.Concrete, ow, grey); t.wall(0, -R - 0.8, R + 0.8, R + 0.8, TOP, 3.8, 0.3, Mat.Concrete, ow, grey);
  t.wall(1, -R - 0.8, R + 0.8, -R - 0.8, TOP, 3.8, 0.3, Mat.Concrete, ow, grey); t.wall(1, -R - 0.8, R + 0.8, R + 0.8, TOP, 3.8, 0.3, Mat.Concrete, ow, grey);
  t.block(-4, -4, 1.2, 0.6, TOP, TOP + 2, Mat.Metal, { color: 0x2a2d30 }); t.block(-2.5, -4, 1.2, 0.6, TOP, TOP + 2, Mat.Metal, { color: 0x2a2d30 }); // server racks
  t.light(0, TOP + 3.6, 3.5); t.light(-3.5, TOP + 3.6, -3.5);
  // stairs up the east side into the cab (hole in the cab floor above)
  t.ramp(3.2, TOP, -4.5, 5.6, CAB, 4.2, 1, 1, Mat.Metal);
  // the cab: wider, open-air (windows blown out), balcony ring, roof above
  const C = 8;
  t.slab(-C - 1.2, -C - 1.2, C + 1.2, C + 1.2, CAB, 0.4, Mat.Concrete, [[3.1, -4.6, 5.7, 4.3]]);
  for (const [x0, z0, x1, z1] of [[-C - 1.2, -C - 1.2, C + 1.2, -C - 1.1], [-C - 1.2, C + 1.1, C + 1.2, C + 1.2], [-C - 1.2, -C - 1.2, -C - 1.1, C + 1.2], [C + 1.1, -C - 1.2, C + 1.2, C + 1.2]]) t.box(x0, CAB, z0, x1, CAB + 1.1, z1, Mat.Metal, { color: 0x9aa0a4 }); // balcony rail
  for (const [x0, z0, x1, z1] of [[-C, -C, C, -C + 0.2], [-C, C - 0.2, C, C], [-C, -C, -C + 0.2, C], [C - 0.2, -C, C, C]]) t.box(x0, CAB, z0, x1, CAB + 1.0, z1, Mat.Metal, { color: 0x5a6066 }); // console sill
  for (const [px, pz] of [[-C, -C], [C, -C], [-C, C], [C, C], [0, -C], [0, C], [-C, 0], [C, 0]]) t.box(px - 0.15, CAB, pz - 0.15, px + 0.15, CAB + 3.6, pz + 0.15, Mat.Metal, { color: 0x3a3d42 }); // mullions
  t.wall(0, -C, C, C - 0.1, CAB + 1, 2.6, 0.1, Mat.Metal, [{ u0: 0.4, u1: 2 * C - 0.4, v0: 0.05, v1: 2.5 }], 0x3a3d42); // blown-out window frame, one side
  t.box(-C - 0.6, CAB + 3.6, -C - 0.6, C + 0.6, CAB + 4.0, C + 0.6, Mat.Roof, { color: 0x3a3d42 });
  t.block(-3, 0, 4, 1, CAB, CAB + 1.1, Mat.Metal, { color: 0x4a4f55 }); // control desk
  t.light(0, CAB + 3.5, 0);
  t.addLoot(2, CAB, -3); t.addLoot(-5, TOP, 3); t.addLoot(0, 0.05, -4); t.addLoot(-6, CAB + 4, 0);
  sub(ctx, f, 0, 0, 0, t);
}

/**
 * Atlas Superstore (Zone 2E). A blue corrugated box (116 × 74 m, 11 m walls with a yellow cap band),
 * single storey inside with columns on a 10 m grid (yellow bases), pallet racking in N-S aisles,
 * checkouts along the S wall, a hazmat drum stack in the middle. 2F exists only in corner pockets: SW
 * offices (stairwell down to 1F, door out onto the low west annex roof), NW office over the floor, a
 * small SE office reached only from the east gantry. The roof is reachable only from outside: ladder
 * onto the west annex, the east gantry stair to a balcony and a ladder on, and a ladder on the north
 * wall. Three double doors under the sign (S), two loading openings (N), unloading bay B (E), cross-
 * shaped glass skylights, solar panels, and a covered car park in front.
 */
export function superstore2020(ctx: GenContext) {
  const p = poi('superstore');
  const f = frame(ctx, 'superstore', p.x, p.z - 10, 0, 150, 120, 'superstore', 0x2d5a9a);
  const blue = 0x2d5a9a, yellow = 0xe0b020, HW = 58, HD = 37, H = 11, F2 = 4.2;
  const b = new Builder();
  b.box(-HW - 0.2, -1.5, -HD - 0.2, HW + 0.2, 0.05, HD + 0.2, Mat.Concrete, { color: 0x8e8c86 });
  const door = (u: number, w = 1.8) => ({ u0: u, u1: u + w, v0: 0, v1: 2.4 });
  // S (front): 3 double doors under the sign + 2 in the SE unloading area; high windows
  b.wall(0, -HW, HW, HD, 0.05, H, 0.3, Mat.Metal, [door(HW - 20.9), door(HW - 0.9), door(HW + 19.1), door(HW + 40), door(HW + 46), { u0: HW - 30, u1: HW + 30, v0: 7.5, v1: 9.5, glass: true }], blue, 1);
  // N: two big loading openings (open), a door
  b.wall(0, -HW, HW, -HD, 0.05, H, 0.3, Mat.Metal, [{ u0: HW - 28, u1: HW - 22, v0: 0, v1: 4.6, open: true }, { u0: HW + 2, u1: HW + 8, v0: 0, v1: 4.6, open: true }, door(HW + 30, 1)], blue, -1);
  // W: a door to the rear lot; at 2F a door out onto the annex roof
  b.wall(1, -HD, HD, -HW, 0.05, H, 0.3, Mat.Metal, [door(HD + 8, 1), { u0: HD + 14, u1: HD + 15, v0: F2, v1: F2 + 2.2 }], blue, -1);
  // E: unloading garage B (open), locker-room door, alcove double doors; 2F door onto the balcony
  b.wall(1, -HD, HD, HW, 0.05, H, 0.3, Mat.Metal, [{ u0: HD - 22, u1: HD - 16, v0: 0, v1: 4.6, open: true }, door(HD - 8, 1), door(4), { u0: HD + 27, u1: HD + 28, v0: F2, v1: F2 + 2.2 }], blue, 1);
  // yellow cap band + parapet
  for (const [x0, z0, x1, z1] of [[-HW, HD - 0.2, HW, HD + 0.3], [-HW, -HD - 0.3, HW, -HD + 0.2], [-HW - 0.3, -HD, -HW + 0.2, HD], [HW - 0.2, -HD, HW + 0.3, HD]]) {
    b.box(x0, H - 1.2, z0, x1, H + 0.9, z1, Mat.Trim, { color: yellow, noCollide: true });
  }
  // ---- interior: columns (10 m grid), racking, checkouts, drums, platform, frozen aisle
  for (let x = -HW + 8; x < HW; x += 10) for (let z = -HD + 7; z < HD; z += 10) {
    b.box(x - 0.25, 0.05, z - 0.25, x + 0.25, H, z + 0.25, Mat.Metal, { color: 0xd8d8d0 });
    b.box(x - 0.3, 0.05, z - 0.3, x + 0.3, 1.2, z + 0.3, Mat.Metal, { color: yellow });
  }
  for (let x = -36; x <= 36; x += 7) for (const [z0, z1] of [[-28, -10], [-6, 16]]) {
    if (Math.abs(x) < 4) continue; // central drum area
    b.box(x - 0.6, 0.05, z0, x + 0.6, 4.5, z1, Mat.Metal, { color: 0xc47a1e });
  }
  for (let x = -30; x <= 30; x += 5) b.box(x - 0.4, 0.05, 28, x + 0.4, 1.1, 31, Mat.Metal, { color: 0x5a6066 }); // checkouts
  for (let i = 0; i < 9; i++) b.box(-3 + (i % 3) * 1.1, 0.05 + Math.floor(i / 3) * 0 , -3 + Math.floor(i / 3) * 1.1, -2.1 + (i % 3) * 1.1, 1.2, -2.1 + Math.floor(i / 3) * 1.1, Mat.Metal, { color: 0xe6e6e0, shape: 'cyl' }); // hazmat drums
  b.box(-10, 0.05, -33, 10, 1.4, -29, Mat.Wood, { color: 0x7a5a38 }); // raised platform (N)
  b.box(-38, 0.05, 20, -24, 1.6, 22, Mat.Metal, { color: 0xe6e8ea }); // frozen food cabinets (SW of the floor)
  for (let x = -HW + 8; x < HW; x += 12) for (let z = -HD + 8; z < HD; z += 12) b.light(x, H - 0.8, z);
  for (const [x, z] of [[-40, -20], [-20, 0], [0, 10], [20, -20], [40, 5], [-30, 25], [30, 25], [0, -30], [50, -30], [-50, 5]]) b.addLoot(x, 0.05, z);
  // ---- 2F pockets
  // SW offices + break room (x -58..-40, z 10..37) with a stairwell down to 1F and the annex-roof door
  b.slab(-HW, 10, -40, HD, F2, 0.3, Mat.Concrete, [[-57.8, 22.4, -52, 36.8]]);
  const swHole = dogleg(b, -57.8, -52, 21, 36.8, 0.05, 1, F2 - 0.05); void swHole;
  b.wall(1, 21, 36.8, -51.9, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [{ u0: 0.15, u1: 1.3, v0: 0, v1: 2.2 }], 0xcfc8bb);
  b.wall(0, -57.8, -51.9, 20.9, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [], 0xcfc8bb);
  b.wall(0, -HW, -40, 10, 0.05, F2 + 3, 0.2, Mat.Plaster, [{ u0: 10, u1: 11, v0: 0, v1: 2.2 }, { u0: 4, u1: 8, v0: F2 + 1, v1: F2 + 2.4, glass: true }], 0xd8d0c0);
  b.wall(1, 10, HD, -40, 0.05, F2 + 3, 0.2, Mat.Plaster, [{ u0: 6, u1: 7, v0: 0, v1: 2.2 }, { u0: 12, u1: 20, v0: F2 + 1, v1: F2 + 2.4, glass: true }], 0xd8d0c0);
  b.slab(-HW, 10, -40, HD, F2 + 3, 0.2, Mat.Concrete, []);
  b.wall(0, -51.8, -40.2, 21, F2, 3, 0.12, Mat.Plaster, [{ u0: 4, u1: 5, v0: 0, v1: 2.2 }], 0xd8d0c0); // offices / break room
  b.light(-46, F2 + 2.9, 16); b.light(-46, F2 + 2.9, 30); b.light(-55, F2 + 2.9, 15);
  b.addLoot(-45, F2, 15); b.addLoot(-45, F2, 30);
  // NW office over the floor (x -58..-44, z -37..-25) + its stairwell
  b.slab(-HW, -HD, -44, -25, F2, 0.3, Mat.Concrete, [[-57.8, -35.6, -52, -25]]);
  dogleg(b, -57.8, -52, -37, -25, 0.05, 1, F2 - 0.05);
  b.wall(1, -37, -25, -51.9, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [{ u0: 0.15, u1: 1.3, v0: 0, v1: 2.2 }], 0xcfc8bb);
  b.wall(0, -57.8, -51.9, -24.9, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [], 0xcfc8bb);
  b.wall(0, -HW, -44, -25, F2, 3, 0.2, Mat.Plaster, [{ u0: 3, u1: 12, v0: 0.9, v1: 2.4, glass: true }], 0xd8d0c0);
  b.wall(1, -HD, -25, -44, F2, 3, 0.2, Mat.Plaster, [{ u0: 2, u1: 10, v0: 0.9, v1: 2.4, glass: true }], 0xd8d0c0);
  b.slab(-HW, -HD, -44, -25, F2 + 3, 0.2, Mat.Concrete, []);
  b.block(-48, -33, 0.8, 1.6, F2, F2 + 2, Mat.Metal, { color: 0x2a2d30 }); b.light(-49, F2 + 2.9, -31); b.addLoot(-47, F2, -29);
  // SE office over the checkouts (x 46..58, z 22..37), only reached from the east gantry balcony
  b.slab(46, 22, HW, HD, F2, 0.3, Mat.Concrete, []);
  b.wall(1, 22, HD, 46, F2, 3, 0.2, Mat.Plaster, [{ u0: 3, u1: 10, v0: 0.9, v1: 2.4, glass: true }], 0xd8d0c0);
  b.wall(0, 46, HW, 22, F2, 3, 0.2, Mat.Plaster, [], 0xd8d0c0);
  b.slab(46, 22, HW, HD, F2 + 3, 0.2, Mat.Concrete, []);
  b.light(52, F2 + 2.9, 30); b.addLoot(52, F2, 30);
  // ---- roof: parapet, cross skylights (glass), solar panels, AC units
  b.slab(-HW - 0.2, -HD - 0.2, HW + 0.2, HD + 0.2, H, 0.4, Mat.Roof, [[-45, -3, 45, 3], [-3, -30, 3, 30]]);
  b.box(-45, H - 0.1, -3, 45, H, 3, Mat.Glass, {}); b.box(-3, H - 0.1, -30, 3, H, 30, Mat.Glass, {});
  b.box(-45, H, -3.2, 45, H + 2, 3.2, Mat.Glass, { shape: 'gable', noCollide: true });
  for (let x = -50; x <= 50; x += 6) for (const z of [-25, -18, 10, 18, 25]) if (Math.abs(x) > 5) b.box(x - 2.2, H, z - 1.2, x + 2.2, H + 0.9, z + 1.2, Mat.Metal, { color: 0x1d2a3a });
  for (const [x, z] of [[30, -30], [-30, 30], [50, 30]]) b.box(x - 1.5, H, z - 1, x + 1.5, H + 1.4, z + 1, Mat.Metal, { color: 0xa0a6aa });
  for (const [x0, z0, x1, z1] of [[-HW, HD - 0.3, HW, HD], [-HW, -HD, HW, -HD + 0.3], [-HW, -HD, -HW + 0.3, HD], [HW - 0.3, -HD, HW, HD]]) b.box(x0, H, z0, x1, H + 0.9, z1, Mat.Metal, { color: blue });
  b.addLoot(0, H, -20); b.addLoot(40, H, 30); b.addLoot(-40, H, -30);
  // ---- outside: west annex (low roof), east gantry + balcony, ladders
  b.box(-70, -1.2, -10, -58.3, 0.05, 20, Mat.Concrete, { color: 0x8e8c86 });
  b.wall(1, -10, 20, -70, 0.05, F2 - 0.05, 0.3, Mat.Metal, [door(12, 1)], blue, -1);
  b.wall(0, -70, -58.3, -10, 0.05, F2 - 0.05, 0.3, Mat.Metal, [], blue, -1); b.wall(0, -70, -58.3, 20, 0.05, F2 - 0.05, 0.3, Mat.Metal, [door(5, 1)], blue, 1);
  b.slab(-70.2, -10.2, -58.3, 20.2, F2, 0.3, Mat.Roof, []);
  b.ladder(-70.15, 0, -1, 0, 0.05, F2); // up the annex's west wall
  b.light(-64, F2 - 0.3, 5); b.addLoot(-64, 0.05, 5);
  b.ramp(HW + 0.3, 0.05, -5, HW + 2.2, F2, 15, 1, 1, Mat.Metal); // east gantry stair, rising south
  b.box(HW + 0.3, F2 - 0.2, 15, HW + 3, F2, 35, Mat.Metal, { color: 0x6d7378 }); // balcony
  b.box(HW + 2.9, F2, 15, HW + 3, F2 + 1, 35, Mat.Metal, { color: 0x6d7378 }); // rail
  b.ladder(HW + 0.15, 34, 1, 0, F2, H); // balcony -> main roof
  b.ladder(20, -HD - 0.15, 0, -1, 0.05, H); // north wall ladder
  // ---- covered car park in front
  for (const z of [46, 57]) {
    b.box(-28, 4, z - 5, 28, 4.3, z + 5, Mat.Metal, { color: 0x2d5a9a });
    for (let x = -26; x <= 26; x += 13) b.box(x - 0.2, 0.05, z - 0.2, x + 0.2, 4, z + 0.2, Mat.Metal, { color: 0x8a8f94 });
  }
  sub(ctx, f, 0, 0, 0, b);
  ctx.buyStations.push({ x: p.x + 40, y: 0, z: p.z + 45, a: 0 });
  ctx.contracts.push({ x: p.x - 70, y: 0, z: p.z + 30 });
}

/** Fire station (one prefab reused across Verdansk: Stations 20, 36, 57, 74...). Street end at local -x. */
export function fireStation(): Builder {
  const b = new Builder(), red = 0xa33a2a, brick = 0x9a5a44, cream = 0xd8cdb4;
  b.box(-7.2, -1.2, -7.2, 11.2, 0.05, 10.2, Mat.Concrete, { color: 0x8e8c86 });
  // garage hall x -7..7, z 0..10, walls 5 m, gable roof along x (ridge ~8 m); two arched bays on the street end
  b.wall(1, 0, 10, -7, 0.05, 4.95, 0.3, Mat.Brick, [{ u0: 0.8, u1: 4.4, v0: 0, v1: 4.2, open: true }, { u0: 5.6, u1: 9.2, v0: 0, v1: 4.2, open: true }], brick, -1);
  b.wall(1, 0, 10, 7, 0.05, 4.95, 0.3, Mat.Brick, [{ u0: 4, u1: 5, v0: 0, v1: 2.2 }], brick, 1);
  b.wall(0, -7, 7, 10, 0.05, 4.95, 0.3, Mat.Brick, [{ u0: 3, u1: 5, v0: 2.4, v1: 3.8, glass: false }, { u0: 9, u1: 11, v0: 2.4, v1: 3.8, glass: false }], brick, 1);
  b.box(-7.4, 5, -0.4, 7.4, 8, 10.4, Mat.Roof, { shape: 'gable', noCollide: true, color: red });
  b.ramp(-7.4, 5, -0.4, 7.4, 8, 5, 1, 1, Mat.Roof); b.ramp(-7.4, 5, 5, 7.4, 8, 10.4, 1, -1, Mat.Roof);
  b.box(-5.5, 0.05, 1.5, 5.5, 2.8, 4.2, Mat.Metal, { color: 0xb3261e }); // fire engine
  b.light(-2, 4.8, 5); b.light(3, 4.8, 5);
  b.addLoot(-3, 0.05, 7); b.addLoot(4, 0.05, 8);
  // two-storey wing x -7..7, z -7..0 (6.5 m, flat roof): reception + lockers down, crew quarters up
  for (const [y, h, lvl] of [[0.05, 3.2, 0], [3.25, 3.25, 1]] as [number, number, number][]) {
    b.wall(1, -7, 0, -7, y, h, 0.3, Mat.Plaster, lvl ? [{ u0: 2.5, u1: 4.5, v0: 0.9, v1: 2.3 }] : [{ u0: 3, u1: 4, v0: 0, v1: 2.2 }], cream, -1);
    b.wall(0, -7, 7, -7, y, h, 0.3, Mat.Plaster, [{ u0: 2, u1: 3.4, v0: 0.9, v1: 2.3 }, { u0: 9, u1: 10.4, v0: 0.9, v1: 2.3 }], cream, -1);
    b.wall(1, -7, 0, 7, y, h, 0.3, Mat.Plaster, lvl ? [{ u0: 1.5, u1: 2.5, v0: 0, v1: 2.2 }] : [], cream, 1); // 2F: door into the hose tower (z -5.5..-4.5)
    // partition with the garage: a door down, windows up (crew quarters overlook the garage)
    b.wall(0, -7, 7, 0, y, h, 0.25, Mat.Plaster, lvl ? [{ u0: 5, u1: 9, v0: 0.9, v1: 2.2, glass: true }] : [{ u0: 10, u1: 11, v0: 0, v1: 2.2 }], cream);
    b.light(-3, y + h - 0.1, -3.5); b.light(3, y + h - 0.1, -3.5);
  }
  for (let k = 0; k < 2; k++) b.box(-7.3 - 0.35 * (2 - k), 0, -4.2, -7.15, (k + 1) * 0.05 + 0.02, -2.6, Mat.Concrete, { color: 0x9a968f }); // steps
  b.ramp(-4.6, 0.05, -1.5, 2.4, 3.25, -0.35, 0, 1, Mat.Wood); // straight stair against the partition
  b.slab(-7, -7, 7, 0, 3.25, 0.25, Mat.Concrete, [[-4.7, -1.6, 2.5, -0.2]]);
  b.slab(-7.2, -7.2, 7.2, 0, 6.5, 0.3, Mat.Roof, []);
  b.box(-5, 0.05, -6.5, -3, 1.9, -5.9, Mat.Metal, { color: 0x6a7076 }); b.box(-2.5, 0.05, -6.5, -0.5, 1.9, -5.9, Mat.Metal, { color: 0x6a7076 }); // lockers
  for (let k = 0; k < 3; k++) b.block(-4 + k * 3, -5, 0.9, 2, 3.25, 3.75, Mat.Wood, { color: 0x6b5238 }); // bunks
  b.addLoot(-5, 0.05, -2); b.addLoot(4, 3.25, -4); b.addLoot(-2, 3.25, -5.5);
  b.ladder(4.5, -7.15, 0, -1, 0.05, 6.5); // wing -> roof (garage roof reachable from it)
  // hose / lookout tower x 7..11, z -7..-3, to 13 m; floor at 2F level, ladder up to the lookout room
  for (const [y, h] of [[0.05, 3.2], [3.25, 7.75], [11, 2.4]] as [number, number][]) {
    const top = y > 10;
    const w = top ? [{ u0: 0.6, u1: 3.4, v0: 0.9, v1: 2.2 }] : [];
    b.wall(0, 7, 11, -7, y, h, 0.3, Mat.Brick, w, brick, -1); b.wall(0, 7, 11, -3, y, h, 0.3, Mat.Brick, w, brick, 1);
    b.wall(1, -7, -3, 11, y, h, 0.3, Mat.Brick, w, brick, 1);
  }
  b.slab(7, -7, 11, -3, 3.25, 0.25, Mat.Concrete, []);
  b.slab(7, -7, 11, -3, 11, 0.25, Mat.Concrete, [[10, -6.8, 10.85, -5.8]]);
  b.ladder(10.85, -6.3, -1, 0, 3.25, 11, true);
  b.box(6.6, 13.4, -7.4, 11.4, 15, -2.6, Mat.Roof, { shape: 'gable', noCollide: true, color: red });
  b.slab(6.7, -7.3, 11.3, -2.7, 13.4, 0.2, Mat.Roof, []);
  b.light(9, 13.2, -5); b.addLoot(8.5, 11, -4);
  return b;
}

/** Gas station: store with glass front + ATM + office, fixed garage bay, rear door, roof ladder; pump canopy. */
export function gasStation(): Builder {
  const b = new Builder(), wall = 0xd8d4ca, brand = 0xc4201c;
  b.box(-6, -1.2, -10, 6, 0.05, 7.2, Mat.Concrete, { color: 0x8e8c86 });
  b.wall(0, -4.5, 4.5, 0, 0.05, 3.55, 0.25, Mat.Plaster, [{ u0: 0.5, u1: 3, v0: 0.4, v1: 2.6, glass: true }, { u0: 3.2, u1: 4.2, v0: 0, v1: 2.2 }, { u0: 4.4, u1: 5.8, v0: 0.4, v1: 2.6, glass: true }], wall, -1);
  b.wall(0, -4.5, 4.5, 7, 0.05, 3.55, 0.25, Mat.Plaster, [{ u0: 1, u1: 2, v0: 0, v1: 2.2 }], wall, 1);
  b.wall(1, 0, 7, -4.5, 0.05, 3.55, 0.25, Mat.Plaster, [{ u0: 2.5, u1: 3.5, v0: 0, v1: 2.2 }], wall, -1);
  b.wall(1, 0, 7, 4.5, 0.05, 3.55, 0.25, Mat.Plaster, [], wall, 1);
  b.box(4.63, 0.05, 1.5, 4.7, 3, 4.5, Mat.Metal, { color: 0x8a8f94, noCollide: true }); // roller door (fixed shut)
  b.wall(1, 0.1, 6.9, 1.5, 0.05, 3.5, 0.12, Mat.Plaster, [{ u0: 4.5, u1: 5.5, v0: 0, v1: 2.2 }], 0xd8d0c0); // garage bay
  b.wall(0, -4.4, -1.5, 4, 0.05, 3.5, 0.12, Mat.Plaster, [{ u0: 1, u1: 2, v0: 0, v1: 2.2 }], 0xd8d0c0); // office
  b.box(-1.2, 0.05, 1, 0.5, 1.1, 2.2, Mat.Wood, { color: 0x6b4a2f }); // counter
  b.box(-4.3, 0.05, 1.2, -3.8, 1.8, 2, Mat.Metal, { color: 0x3a4a5a }); // ATM
  for (const x of [-3, 0]) b.box(x - 0.5, 0.05, 3, x + 0.5, 1.6, 3.4, Mat.Metal, { color: 0xc8c8c0 }); // shelves
  b.slab(-4.7, -0.2, 4.7, 7.2, 3.6, 0.25, Mat.Roof, []);
  b.box(-4.8, 3.6, -0.3, 4.8, 4.1, -0.2, Mat.Trim, { color: brand, noCollide: true });
  b.ladder(3.5, 7.15, 0, 1, 0.05, 3.6);
  // canopy: touches the store, walkable roof (step up from the store roof), two columns over the pumps
  b.box(-5.2, 4.3, -9.2, 5.2, 4.6, -0.2, Mat.Metal, { color: 0xe6e6e0 });
  b.box(-5.25, 4.1, -9.25, 5.25, 4.3, -0.15, Mat.Trim, { color: brand, noCollide: true });
  for (const x of [-2.8, 2.8]) { b.box(x - 0.25, 0.05, -5.4, x + 0.25, 4.3, -4.9, Mat.Metal, { color: 0xd0d0c8 }); b.box(x - 0.5, 0.05, -6.8, x + 0.5, 1.6, -6.2, Mat.Metal, { color: brand }); }
  b.light(0, 3.45, 2); b.light(-3, 3.45, 5.5); b.light(0, 4.25, -5); b.light(3, 3.45, 5.5);
  b.addLoot(-2, 0.05, 2.5); b.addLoot(3, 0.05, 5); b.addLoot(-3, 0.05, 5.5); b.addLoot(0, 3.6, 4);
  return b;
}

/** Place a prefab on free ground near (x, z), trying a spiral of spots and the four axis rotations. */
export function placeNear(ctx: GenContext, b: () => Builder, kind: string, x: number, z: number, w: number, d: number, lod: number, maxR = 160, maxRise = 3, poiId?: string): boolean {
  for (let r = 0; r <= maxR; r += 8) for (let k = 0; k < Math.max(1, Math.floor(r / 4)); k++) {
    const a = (k / Math.max(1, Math.floor(r / 4))) * Math.PI * 2 + r * 0.37, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const ang = (Math.floor(ctx.rng.next() * 4) * Math.PI) / 2;
    if (!ctx.occ.free(px, pz, ang, w, d, 2)) continue;
    const fh = ctx.footprintHeights(px, pz, ang, w, d);
    if (fh.max - fh.min > maxRise || ctx.hf.at(px, pz) < 1) continue;
    ctx.place(b(), kind, px, pz, ang, { lodColor: lod, ...(poiId ? { poi: poiId } : {}) });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
/**
 * Verdansk International Airport main terminal (Zone 2A, atlas 010A-010ZF). Local frame: x west→east,
 * -z faces the runway (north), +z the landside roads (south). 1F: west coffee shop / lounge and the
 * maintenance stairs; the check-in hall (three counter islands, crashed SUV + APC) under a triple-height
 * volume; wide double stairs up to the 2F Security Checkpoint concourse; garage bays 01-07 and a hole in
 * the wall on the runway side; east café / tourist concourse, customs and baggage claim reached by the
 * east double stairs. 2F: the east-west concourse along the runway glass, the checkpoint concourse, the
 * duty-free store with its blown-out wall, Economy / Business doors onto the baggage-loading roof, the
 * gate window. 3F: the central mezzanine (seat rows, a hole into duty-free) reached by the crate stack or
 * the Departures door from the elevated road; the west Burger Town mezzanine only from above. Roof partly
 * collapsed.
 */
export function terminal2020(ctx: GenContext, x: number, z: number) {
  const f = frame(ctx, 'airport', x + 20, z + 4, 0, 260, 80, 'terminal', 0xc9c5bb);
  const b = new Builder();
  const HW = 85, HD = 25, F2 = 5.5, F3 = 10.5, H = 16;
  const conc = 0xc9c5bb, panel = 0xb8682c, pillar = 0x8e8f8c, tile = 0xd8d4cc, glassBand = 0x9ab0b8;
  // Builder.box expects world-ish local coords; the frame sits at (x + 20, z + 4): shift everything so the
  // hall is centred on (x, z) and the east ramp has room
  const ox = -20, oz = -4;
  const B = {
    box: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat, e?: any) => b.box(x0 + ox, y0, z0 + oz, x1 + ox, y1, z1 + oz, m, e),
    slab: (x0: number, z0: number, x1: number, z1: number, y: number, t: number, m: Mat, holes: [number, number, number, number][] = []) => b.slab(x0 + ox, z0 + oz, x1 + ox, z1 + oz, y, t, m, holes.map(([a, c, d, e]) => [a + ox, c + oz, d + ox, e + oz] as [number, number, number, number])),
    wall: (axis: 0 | 1, a: number, c: number, at: number, y0: number, h: number, t: number, m: Mat, ops: any[] = [], col?: number, out: 0 | 1 | -1 = 0) => b.wall(axis, a + (axis === 0 ? ox : oz), c + (axis === 0 ? ox : oz), at + (axis === 0 ? oz : ox), y0, h, t, m, ops, col, out),
    ramp: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, axis: 0 | 1, dir: 1 | -1, m = Mat.Concrete) => b.ramp(x0 + ox, y0, z0 + oz, x1 + ox, y1, z1 + oz, axis, dir, m),
    light: (lx: number, ly: number, lz: number) => b.light(lx + ox, ly, lz + oz),
    loot: (lx: number, ly: number, lz: number) => b.addLoot(lx + ox, ly, lz + oz),
    ladder: (lx: number, lz: number, nx: number, nz: number, y0: number, y1: number) => b.ladder(lx + ox, lz + oz, nx, nz, y0, y1),
  };
  const door = (u: number, w = 1.8, v0 = 0) => ({ u0: u, u1: u + w, v0, v1: v0 + 2.3 });
  const open = (u: number, w: number, v0: number, v1: number) => ({ u0: u, u1: u + w, v0, v1, open: true });
  B.box(-HW - 0.2, -1.5, -HD - 0.2, HW + 0.2, 0.05, HD + 0.2, Mat.Tile, { color: tile });

  // ---------------- exterior walls
  // north (runway): 1F maintenance door, garage bays 01-07 (3 open), hole in the wall, blown-out tourist
  // concourse windows, baggage claim door; 2F runway glass (broken up by the Economy / Business doors and
  // the open gate window)
  const nOps: any[] = [door(HW - 57, 1), door(HW + 72, 1.8)];
  for (let i = 0; i < 7; i++) { const u = HW - 2 + i * 4.6; if (i % 2 === 1) nOps.push(open(u, 3.6, 0, 3.6)); }
  nOps.push(open(HW + 58, 4.5, 0, 4.2), open(HW + 49, 8, 0, 4.2));
  const ecoDoors = [HW + 43, HW + 49.5];
  const gateWin = [HW + 64, HW + 70];
  let u = 1;
  const cuts = [...ecoDoors.map((d) => [d - 0.4, d + 1.5]), gateWin].sort((p, q) => p[0] - q[0]);
  for (const [c0, c1] of cuts) { if (c0 - u > 1) nOps.push({ u0: u, u1: c0, v0: F2 + 0.9, v1: F3 - 0.3, glass: true }); u = c1 + 0.4; }
  if (2 * HW - 1 - u > 1) nOps.push({ u0: u, u1: 2 * HW - 1, v0: F2 + 0.9, v1: F3 - 0.3, glass: true });
  for (const d of ecoDoors) nOps.push({ ...door(d, 1.1, F2 - 0.05), door: true });
  nOps.push(open(gateWin[0], gateWin[1] - gateWin[0], F2 + 0.2, F3 - 0.3));
  B.wall(0, -HW, HW, -HD, 0.05, H, 0.35, Mat.Concrete, nOps, conc, -1);
  // south (landside): lounge doors, 3 Departures and 2 Arrivals openings between pillars, "BMA" window
  // band, the 3F Departures entrance and two smashed coach windows onto the elevated road
  const sOps: any[] = [door(5, 1.8), open(HW - 40, 4, 0, 4), open(HW - 28, 4, 0, 4), open(HW - 16, 4, 0, 4), open(HW + 62, 4, 0, 4), open(HW + 72, 4, 0, 4)];
  sOps.push(open(HW + 10, 4, F3 - 0.05, F3 + 2.8), open(HW - 8, 3, F3 + 0.4, F3 + 2.4), open(HW - 3, 3, F3 + 0.4, F3 + 2.4));
  for (let x0 = 18; x0 < 2 * HW - 6; x0 += 9) if (!(x0 > HW - 10 && x0 < HW + 16)) sOps.push({ u0: x0, u1: x0 + 6, v0: F2 + 1.4, v1: F2 + 4, glass: true });
  B.wall(0, -HW, HW, HD, 0.05, H, 0.35, Mat.Concrete, sOps, conc, 1);
  B.wall(1, -HD + 0.17, HD - 0.17, -HW, 0.05, H, 0.35, Mat.Concrete, [door(HD + 5, 1.8), { u0: 6, u1: 2 * HD - 6, v0: F3 + 1, v1: H - 1.5, glass: true }], conc, -1);
  B.wall(1, -HD + 0.17, HD - 0.17, HW, 0.05, H, 0.35, Mat.Concrete, [{ u0: 6, u1: 2 * HD - 6, v0: F3 + 1, v1: H - 1.5, glass: true }], conc, 1);
  // sandbagged pillars at the entrances
  for (const px of [-44, -32, -20, 58, 68, 78]) { B.box(px - 0.6, 0.05, HD + 0.4, px + 0.6, 4.5, HD + 1.6, Mat.Concrete, { color: pillar }); B.box(px - 1.3, 0.05, HD + 1.6, px + 1.3, 1.1, HD + 2.4, Mat.Wood, { color: 0x8a7a58 }); }

  // ---------------- 1F west: coffee shop, lounge, restrooms, maintenance stairs
  B.wall(1, -HD + 0.2, HD - 0.2, -52, 0.05, F2 - 0.05, 0.25, Mat.Plaster, [open(HD + 6, 3.5, 0, 3), door(HD - 20 + 5, 1.1)], 0xd8d0c0);
  B.box(-80, 0.05, 6, -70, 1.1, 7.2, Mat.Wood, { color: 0x6a4a30 }); // coffee counter
  for (let i = 0; i < 5; i++) B.box(-78 + i * 4.5, 0.05, 14, -76 + i * 4.5, 0.5, 20, Mat.Wood, { color: 0x3a3d44 }); // lounge seats
  B.wall(0, -85, -64, -5, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [door(12, 1)], 0xd8d0c0); // restrooms / junction
  B.wall(1, -25, -5, -64, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [door(10, 1)], 0xd8d0c0);
  dogleg(b, -58 + ox, -52.2 + ox, -24.9 + oz, -13 + oz, 0.05, 1, F2 - 0.05);
  B.wall(1, -24.9, -13, -58.1, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [door(0.2, 1.1)], 0xcfc8bb);
  B.slab(-HW, -HD, -52, -5, F2, 0.3, Mat.Concrete, [[-58, -23.5, -52.2, -13]]);
  B.wall(0, -HW, -52, -5, F2, F3 - F2, 0.2, Mat.Plaster, [door(20, 1)], 0xd8d0c0); // 2F junction room
  for (const [lx, lz] of [[-75, 0], [-75, 15], [-60, 10], [-70, -15], [-60, -20]]) B.light(lx, F2 - 0.15, lz);
  B.loot(-75, 0.05, 10); B.loot(-60, 0.05, -18); B.loot(-70, F2, -15);

  // ---------------- 1F check-in hall (x -52..-2), triple height
  for (const cx of [-44, -32, -20]) {
    B.box(cx - 1.1, 0.05, 0, cx + 1.1, 1.1, 12, Mat.Wood, { color: panel });
    B.box(cx - 0.3, 0.05, 0, cx + 0.3, 0.6, 12, Mat.Metal, { color: 0x3a3c40 }); // belt
    B.box(cx - 2.5, 2.2, 5.5, cx + 2.5, 3.8, 5.7, Mat.Metal, { color: 0x2a3a4a, noCollide: true }); // airline board
  }
  B.box(-31, 0.05, 16, -26, 2.1, 18.4, Mat.Metal, { color: 0x2a2d28 }); // crashed SUV
  B.box(-23, 0.05, 11, -16.5, 2.6, 14, Mat.Metal, { color: 0x4a5040 }); // APC
  for (const [lx, lz] of [[-44, 8], [-32, 8], [-20, 8]]) B.loot(lx + 2, 0.05, lz);
  for (let lx = -48; lx <= -6; lx += 10) for (const lz of [2, 16]) B.light(lx, H - 0.6, lz);

  // ---------------- double stairs up to the Security Checkpoint (x 0..8, rising north z 18 -> 6)
  B.ramp(-1, 0.05, 6, 3, F2, 18, 1, -1, Mat.Tile); B.ramp(4, 0.05, 6, 8, F2, 18, 1, -1, Mat.Tile);
  // solid balustrade walls along both sides (a rail you can't step through)
  B.box(-1.25, 0.05, 6, -1, F2 + 1, 18, Mat.Plaster, { color: 0xd8d4cc }); B.box(8, 0.05, 6, 8.25, F2 + 1, 18, Mat.Plaster, { color: 0xd8d4cc });
  B.box(3, 0.05, 17.2, 4, 1.0, 18, Mat.Metal, { color: 0x9aa0a4 }); // divider newel at the foot
  B.box(-1, F2 + 3.2, 5.6, 9, F2 + 4.4, 5.9, Mat.Metal, { color: 0x24384c, noCollide: true }); // SECURITY CHECKPOINT sign

  // ---------------- 2F: east-west concourse (runway side) + checkpoint concourse + east part
  B.slab(-52, -HD, 70, -15, F2, 0.35, Mat.Tile);
  B.slab(-2, -15, 40, 6, F2, 0.35, Mat.Tile);
  // balcony fronts: orange panelling with a rail; gaps at the stair heads
  const rail = (x0: number, z0: number, x1: number, z1: number) => { B.box(x0, F2, z0, x1, F2 + 1.05, z1, Mat.Glass, {}); B.box(x0, F2 - 1.2, z0, x1, F2 - 0.3, z1, Mat.Wood, { color: panel, noCollide: true }); };
  rail(-52, -15.1, -2, -14.9); rail(-2.1, -15, -1.9, 6); rail(8.2, 5.9, 40, 6.1); rail(40, -15.1, 48, -14.9); rail(57, -15.1, 70, -14.9);
  B.box(-1, F2 - 1.2, 5.9, 8.2, F2 - 0.3, 6.1, Mat.Wood, { color: panel, noCollide: true });
  // columns
  for (let cx = -48; cx <= 80; cx += 16) for (const cz of [-15, 6]) if (!(cx > 40 && cz === 6)) B.box(cx - 0.55, 0.05, cz - 0.55, cx + 0.55, H, cz + 0.55, Mat.Concrete, { color: pillar });
  // duty-free store (x 24..40, z -12..6) with a big hole in its west wall
  B.wall(1, -12, 6, 24, F2, F3 - F2 - 0.1, 0.2, Mat.Plaster, [open(4, 6, 0, 3.4)], 0xe0dad0);
  B.wall(0, 24, 40, -12, F2, F3 - F2 - 0.1, 0.2, Mat.Plaster, [door(3, 1.8)], 0xe0dad0);
  for (let i = 0; i < 4; i++) B.box(27 + i * 3.2, F2, -8, 28 + i * 3.2, F2 + 1.6, 3, Mat.Metal, { color: 0x8a8f94 });
  B.loot(32, F2, -3); B.loot(10, F2, -5); B.loot(-30, F2, -20); B.loot(60, F2, -20);
  // Economy / Business check-in counter between the two doors
  B.box(44.6, F2, -24.6, 49.3, F2 + 1.1, -23.4, Mat.Wood, { color: panel });
  for (let lx = -46; lx <= 66; lx += 10) B.light(lx, F3 - 0.15, -20);
  for (let lx = 2; lx <= 38; lx += 9) B.light(lx, F3 - 0.15, -5);
  // crate stack in the corner up to the mezzanine (steps of ~1.3 m you can mantle)
  const cr = [[-15, -13.5, 1.3], [-13.5, -12, 2.6], [-12, -10.5, 3.9], [-10.5, -8.05, 4.9]];
  for (const [z0, z1, hh] of cr) B.box(-1.6, F2, z0, 2.2, F2 + hh, z1, Mat.Wood, { color: 0x7a5a38 });

  // ---------------- 3F mezzanine (x -2..40, z -8..6) + bridge to the Departures door
  B.slab(-2, -8, 40, 6, F3, 0.35, Mat.Tile, [[30, -6, 36, -2]]);
  B.slab(8, 6, 16, HD - 0.2, F3, 0.35, Mat.Tile);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) B.box(6 + i * 7, F3, -5 + j * 3.5, 11 + i * 7, F3 + 0.45, -4.3 + j * 3.5, Mat.Metal, { color: 0x3a4250 });
  const mrail = (x0: number, z0: number, x1: number, z1: number) => B.box(x0, F3, z0, x1, F3 + 1.05, z1, Mat.Metal, { color: 0x9aa0a4 });
  mrail(2.3, -8.1, 40, -7.95); mrail(-2.1, -8, -1.95, 6); mrail(-2, 5.95, 8, 6.1); mrail(16, 5.95, 40, 6.1); mrail(39.9, -8, 40.05, 6); mrail(7.9, 6, 8.05, HD - 0.2); mrail(15.95, 6, 16.1, HD - 0.2);
  B.light(10, H - 0.6, 0); B.light(28, H - 0.6, 0); B.loot(20, F3, 2); B.loot(12, F3, 18);

  // ---------------- west Burger Town mezzanine (only from above)
  B.slab(-HW, -HD, -55, 5, F3, 0.35, Mat.Tile);
  B.box(-80, F3, -22, -70, F3 + 1.1, -20.8, Mat.Metal, { color: 0xc8302a }); // Burger Town counter
  for (let i = 0; i < 6; i++) B.box(-78 + (i % 3) * 7, F3, -12 + Math.floor(i / 3) * 8, -76.8 + (i % 3) * 7, F3 + 0.75, -10.8 + Math.floor(i / 3) * 8, Mat.Wood, { color: 0x8a6a48 });
  B.box(-55.1, F3, -HD, -54.95, F3 + 1.05, 5, Mat.Metal, { color: 0x9aa0a4 }); B.box(-HW, F3, 4.95, -55, F3 + 1.05, 5.1, Mat.Metal, { color: 0x9aa0a4 });
  B.loot(-75, F3, -15); B.light(-70, H - 0.6, -10);

  // ---------------- 1F under the checkpoint: garage bay room + storage, 1F east
  B.wall(0, -2, 40, -14, 0.05, F2 - 0.05, 0.25, Mat.Concrete, [open(10, 3, 0, 2.6), open(30, 2.5, 0, 2.6)], 0xb0aca4);
  B.wall(1, -14, 6, -2, 0.05, F2 - 0.05, 0.25, Mat.Concrete, [door(8, 1.8)], 0xb0aca4);
  B.wall(1, -25, -14, -2, 0.05, F2 - 0.05, 0.25, Mat.Concrete, [], 0xb0aca4);
  for (const [lx, lz] of [[6, -20], [18, -19], [30, -21], [12, -4], [30, -2]]) { B.box(lx - 1, 0.05, lz - 1, lx + 1, 1.3, lz + 1, Mat.Wood, { color: 0x7a5a38 }); B.loot(lx + 2, 0.05, lz); }
  for (let lx = 4; lx <= 36; lx += 10) { B.light(lx, F2 - 0.15, -19); B.light(lx, F2 - 0.15, -4); }
  // east double stairs (x 48..57) from the 2F concourse down to the 1F east concourse (z -15 -> -3)
  B.ramp(48, 0.05, -15, 52.3, F2, -3, 1, -1, Mat.Tile); B.ramp(52.7, 0.05, -15, 57, F2, -3, 1, -1, Mat.Tile);
  B.box(47.75, 0.05, -15, 48, F2 + 1, -3, Mat.Plaster, { color: 0xd8d4cc }); B.box(57, 0.05, -15, 57.25, F2 + 1, -3, Mat.Plaster, { color: 0xd8d4cc });
  // café express and tourist information (low rooms, roofs = low mezzanines)
  for (const [x0, x1, name] of [[40, 47, 'cafe'], [58, 66, 'tourist']] as [number, number, string][]) {
    B.wall(0, x0, x1, -2, 0.05, 3.8, 0.2, Mat.Plaster, [], 0xe0dad0);
    B.wall(0, x0, x1, 12, 0.05, 3.8, 0.2, Mat.Plaster, [door(2, 1.8)], 0xe0dad0);
    B.wall(1, -2, 12, name === 'cafe' ? x1 : x0, 0.05, 3.8, 0.2, Mat.Glass, [door(5, 1.8)], 0xe0dad0);
    B.wall(1, -2, 12, name === 'cafe' ? x0 : x1, 0.05, 3.8, 0.2, Mat.Plaster, [], 0xe0dad0);
    B.slab(x0, -2, x1, 12, 3.95, 0.15, Mat.Concrete);
    B.light((x0 + x1) / 2, 3.7, 5); B.loot((x0 + x1) / 2, 0.05, 5);
  }
  B.box(41, 0.05, 1, 46, 1.1, 2, Mat.Wood, { color: panel }); // café counter
  // customs / bureau de change / baggage claim
  B.wall(1, -15, HD - 0.2, 66, 0.05, F2 - 0.05, 0.25, Mat.Plaster, [open(4, 3, 0, 2.6), door(22, 1.8), open(30, 4, 0, 2.6)], 0xd8d0c0);
  B.slab(66, -15, HW, HD, F2, 0.35, Mat.Concrete);
  for (const cz of [-8, 6]) { B.box(70, 0.05, cz - 1.5, 81, 0.7, cz + 1.5, Mat.Metal, { color: 0x5a6066 }); B.box(71, 0.7, cz - 0.6, 80, 0.75, cz + 0.6, Mat.Metal, { color: 0x2a2d30 }); }
  B.wall(0, 66, HW, 15, 0.05, F2 - 0.05, 0.2, Mat.Plaster, [door(6, 1.8), { u0: 10, u1: 16, v0: 1, v1: 2.3, glass: true }], 0xd8d0c0); // bureau de change
  for (const [lx, lz] of [[75, -10], [75, 8], [75, 20], [52, 10], [62, 18]]) { B.light(lx, F2 - 0.15, lz); B.loot(lx, 0.05, lz); }
  for (let lx = 44; lx <= 64; lx += 10) B.light(lx, H - 0.6, 18);

  // ---------------- roof, partly collapsed (helicopter-sized holes), parapet
  B.slab(-HW - 0.2, -HD - 0.2, HW + 0.2, HD + 0.2, H, 0.45, Mat.Roof, [[-40, -10, -20, 12], [-78, -18, -62, -2], [44, -14, 58, 2]]);
  for (const [x0, z0, x1, z1] of [[-HW, HD - 0.3, HW, HD], [-HW, -HD, HW, -HD + 0.3], [-HW, -HD, -HW + 0.3, HD], [HW - 0.3, -HD, HW, HD]]) B.box(x0, H, z0, x1, H + 1, z1, Mat.Concrete, { color: conc });
  B.box(-40, H - 3, -10, -34, H - 2.6, 12, Mat.Concrete, { color: pillar }); // sagging roof beam
  B.loot(0, H, 0); B.loot(60, H, 15);

  // ---------------- runway side: baggage loading annex (x 36..56), its roof deck + exterior gantry
  B.box(35.8, -1.2, -37.2, 56.2, 0.05, -HD, Mat.Concrete, { color: 0x9a968f });
  B.wall(0, 36, 56, -37, 0.05, F2 - 0.1, 0.3, Mat.Metal, [open(6, 4, 0, 3.6), door(14, 1)], 0x8a8f94, -1);
  B.wall(1, -37, -HD - 0.17, 36, 0.05, F2 - 0.1, 0.3, Mat.Metal, [], 0x8a8f94, -1);
  B.wall(1, -37, -HD - 0.17, 56, 0.05, F2 - 0.1, 0.3, Mat.Metal, [door(4, 1)], 0x8a8f94, 1);
  B.slab(35.8, -37.2, 56.2, -HD - 0.17, F2, 0.3, Mat.Concrete);
  B.box(35.8, F2, -37.2, 56.2, F2 + 1, -37.05, Mat.Metal, { color: 0x6d7378 }); B.box(56.05, F2, -37.2, 56.2, F2 + 1, -HD, Mat.Metal, { color: 0x6d7378 });
  B.ramp(33.8, 0.05, -40, 35.7, F2, -28.5, 1, 1, Mat.Metal); // gantry up the west side of the annex
  B.box(33.8, F2 - 0.2, -28.5, 35.8, F2, -26, Mat.Metal, { color: 0x6d7378 });
  B.light(46, F2 - 0.3, -31); B.loot(46, 0.05, -31); B.loot(46, F2, -31);

  // ---------------- landside: elevated road at 3F with a ramp down to the east, coaches
  B.box(-60, F3 - 0.6, HD + 0.2, 60, F3, HD + 12, Mat.Asphalt, { color: 0x6e6f72 });
  B.ramp(60, 0.05, HD + 0.2, 125, F3, HD + 12, 0, -1, Mat.Asphalt);
  for (let px = -54; px <= 110; px += 14) { const top = px <= 60 ? F3 - 0.6 : F3 * (125 - px) / 65 - 0.4; if (top > 1) B.box(px - 0.6, 0.05, HD + 5.4, px + 0.6, top, HD + 6.8, Mat.Concrete, { color: pillar }); }
  B.box(-60, F3, HD + 11.8, 60, F3 + 1, HD + 12, Mat.Concrete, { color: conc });
  for (const cx of [-20, 30]) B.box(cx - 6, F3, HD + 3, cx + 6, F3 + 3.2, HD + 5.6, Mat.Metal, { color: 0xd8d8d0 }); // coaches
  B.loot(0, F3, HD + 6);
  sub(ctx, f, 0, 0, 0, b);
}

// ---------------------------------------------------------------------------------------------
/** Olive canvas bunk tent (Arklov barracks / airport camp): ~10 × 7 m, 4 m ridge along x, door flaps at both gable ends. */
function tent(b: Builder, cx: number, cz: number, rot: boolean) {
  const olive = 0x5a6238, L = 5, Wd = 3.5;
  const X = (x: number, z: number): [number, number] => (rot ? [cx + z, cz + x] : [cx + x, cz + z]);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat, e?: any) => { const [a, c] = X(x0, z0), [d, g] = X(x1, z1); b.box(Math.min(a, d), y0, Math.min(c, g), Math.max(a, d), y1, Math.max(c, g), m, e); };
  box(-L, 0.05, -Wd, L, 0.2, Wd, Mat.Wood, { color: 0x6a5a40 }); // pallet floor
  // side walls (canvas) and end walls with door flaps
  if (!rot) {
    b.wall(0, cx - L, cx + L, cz - Wd, 0.2, 1.8, 0.08, Mat.Plaster, [], olive); b.wall(0, cx - L, cx + L, cz + Wd, 0.2, 1.8, 0.08, Mat.Plaster, [], olive);
    for (const ex of [cx - L, cx + L]) b.wall(1, cz - Wd, cz + Wd, ex, 0.2, 1.8, 0.08, Mat.Plaster, [{ u0: Wd - 0.7, u1: Wd + 0.7, v0: 0, v1: 1.79, open: true }], olive);
    b.box(cx - L - 0.1, 1.8, cz - Wd - 0.15, cx + L + 0.1, 4.1, cz + Wd + 0.15, Mat.Plaster, { color: olive, shape: 'gable', noCollide: true });
  } else {
    b.wall(1, cz - L, cz + L, cx - Wd, 0.2, 1.8, 0.08, Mat.Plaster, [], olive); b.wall(1, cz - L, cz + L, cx + Wd, 0.2, 1.8, 0.08, Mat.Plaster, [], olive);
    for (const ez of [cz - L, cz + L]) b.wall(0, cx - Wd, cx + Wd, ez, 0.2, 1.8, 0.08, Mat.Plaster, [{ u0: Wd - 0.7, u1: Wd + 0.7, v0: 0, v1: 1.79, open: true }], olive);
    // gable ridge runs along local x in the renderer: for rotated tents use a lower flat canvas roof pair
    b.box(cx - Wd - 0.15, 1.8, cz - L - 0.1, cx + Wd + 0.15, 2.2, cz + L + 0.1, Mat.Plaster, { color: olive, noCollide: true });
    b.box(cx - Wd * 0.55, 2.2, cz - L - 0.1, cx + Wd * 0.55, 3.2, cz + L + 0.1, Mat.Plaster, { color: olive, noCollide: true });
  }
  // double bunks along both long sides
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
    const x0 = -L + 0.6 + i * 2.35, z0 = sd * (Wd - 1.05);
    box(x0, 0.2, z0 - 0.45, x0 + 2, 0.65, z0 + 0.45, Mat.Metal, { color: 0x4a5040 });
    box(x0, 1.35, z0 - 0.45, x0 + 2, 1.45, z0 + 0.45, Mat.Metal, { color: 0x4a5040, noCollide: true });
  }
  const [lx, lz] = X(0, 0); b.addLoot(lx, 0.2, lz); b.light(lx, 3.2, lz);
}

/**
 * Arklov Peak barracks compound (2020): 10 bunk tents in two rows inside a 3 m concrete panel wall with
 * gaps and an entrance, crates between the tents, and a two-level container barracks with an exterior
 * steel stair to the upper container doors.
 */
export function barracksCompound(): Builder {
  const b = new Builder(), HW = 44, HD = 30, wallC = 0xa8a49a;
  // no base slab: the flattened ground is the compound floor (a slab edge would be a step at the wall gaps)
  const gap = (u: number, w = 5) => ({ u0: u, u1: u + w, v0: 0, v1: 3.2, open: true });
  b.wall(0, -HW, HW, -HD, 0.05, 3, 0.35, Mat.Concrete, [gap(HW - 3, 6), gap(12)], wallC);
  b.wall(0, -HW, HW, HD, 0.05, 3, 0.35, Mat.Concrete, [gap(2 * HW - 18)], wallC);
  b.wall(1, -HD, HD, -HW, 0.05, 3, 0.35, Mat.Concrete, [gap(HD - 2.5)], wallC);
  b.wall(1, -HD, HD, HW, 0.05, 3, 0.35, Mat.Concrete, [gap(10)], wallC);
  for (let i = 0; i < 5; i++) { tent(b, -34 + i * 13, -17, false); tent(b, -34 + i * 13, 4, false); }
  for (const [x, z] of [[-27.5, -6], [-14.5, -7], [11.5, -6], [24.5, -7], [-1, 14], [30, 16]]) b.block(x, z, 1.2, 1.2, 0.05, 1.25, Mat.Wood, { color: 0x7a5a38 });
  // container barracks: two stacked rows along the east side, exterior stair to the upper doors
  const cont = (x0: number, z0: number, y: number, col: number) => {
    b.wall(0, x0, x0 + 12, z0, y, 2.55, 0.08, Mat.Container, [{ u0: 5.4, u1: 6.4, v0: 0, v1: 2.1 }], col, -1);
    b.wall(0, x0, x0 + 12, z0 + 2.45, y, 2.55, 0.08, Mat.Container, [{ u0: 2, u1: 4, v0: 0.9, v1: 1.8, open: true }], col, 1);
    b.wall(1, z0, z0 + 2.45, x0, y, 2.55, 0.08, Mat.Container, [], col); b.wall(1, z0, z0 + 2.45, x0 + 12, y, 2.55, 0.08, Mat.Container, [], col);
    b.box(x0, y + 2.55, z0 - 0.04, x0 + 12, y + 2.65, z0 + 2.49, Mat.Container, { color: col });
    b.light(x0 + 6, y + 2.4, z0 + 1.2); b.addLoot(x0 + 3, y, z0 + 1.2);
  };
  cont(26, 22, 0.05, 0xb8b4a8); cont(26, 22, 2.65, 0xb0aca0);
  b.ramp(22, 0.05, 20.6, 25.9, 2.65, 21.9, 0, 1, Mat.Metal); // exterior stair up to the upper container
  b.box(25.9, 2.45, 20.3, 38, 2.65, 21.95, Mat.Metal, { color: 0x6d7378 }); // walkway along the doors
  b.box(25.9, 2.65, 20.3, 38, 3.65, 20.4, Mat.Metal, { color: 0x6d7378 });
  b.addLoot(0, 0.05, -6); b.addLoot(-20, 0.05, 14);
  return b;
}

/**
 * Arklov hangar (2020 "Hangars 11-13, 21-22"): an earth-covered arched hangar ~40 × 30 × 12 m. Open front
 * with a camouflage panel over it, grass slopes you can walk up from outside onto the roof, sparse inside,
 * a short rear corridor through the mound to a metal door. Front at local -z.
 */
export function grassHangar(): Builder {
  // arched profile: two grass slopes from the ground 6 m outside the side walls meet at a 14 m ridge;
  // their undersides are the arched ceiling inside. Low side walls, back wall and camo front follow the arch
  const b = new Builder(), HW = 20, HD = 15, R = 14, E = HW + 6, grass = 0x5e6e3c, wall = 0x7c7f74;
  const arch = (x: number) => 0.05 + (E - Math.abs(x)) * (R - 0.05) / E;
  b.box(-E, -1.2, -HD - 0.2, E, 0.05, HD + 0.2, Mat.Concrete, { color: 0x8e8c86 });
  b.ramp(-E, 0.05, -HD - 0.2, 0, R, HD + 0.2, 0, 1, Mat.Concrete, grass); b.ramp(0, 0.05, -HD - 0.2, E, R, HD + 0.2, 0, -1, Mat.Concrete, grass);
  const side = arch(HW) - 0.3;
  b.wall(1, -HD, HD, -HW, 0.05, side, 0.4, Mat.Concrete, [], wall); b.wall(1, -HD, HD, HW, 0.05, side, 0.4, Mat.Concrete, [], wall);
  // back wall in 2 m strips up to the arch, a door in the middle strip; camo panels over the front
  for (let x = -HW; x < HW; x += 2) {
    const top = Math.min(arch(x), arch(x + 2)) - 0.3;
    if (x === 0) { /* door strip */ b.box(x, 2.3, HD - 0.2, x + 2, top, HD + 0.2, Mat.Concrete, { color: wall }); b.box(x, 0.05, HD - 0.2, x + 0.45, 2.3, HD + 0.2, Mat.Concrete, { color: wall }); b.box(x + 1.55, 0.05, HD - 0.2, x + 2, 2.3, HD + 0.2, Mat.Concrete, { color: wall }); }
    else b.box(x, 0.05, HD - 0.2, x + 2, top, HD + 0.2, Mat.Concrete, { color: wall });
    if (top > 8.6) b.box(x, 8.2, -HD - 0.25, x + 2, top, -HD + 0.05, Mat.Plaster, { color: 0x6a6a48, noCollide: true });
  }
  // short rear corridor to a metal door
  b.wall(1, HD, HD + 4, 0, 0.05, 2.6, 0.2, Mat.Concrete, [], wall); b.wall(1, HD, HD + 4, 2, 0.05, 2.6, 0.2, Mat.Concrete, [], wall);
  b.box(-0.1, 2.6, HD, 2.1, 2.8, HD + 4, Mat.Concrete, { color: wall });
  b.wall(0, 0, 2, HD + 4, 0.05, 2.8, 0.2, Mat.Metal, [{ u0: 0.45, u1: 1.55, v0: 0, v1: 2.2 }], 0x5a6066);
  b.light(1, 2.5, HD + 2);
  for (let x = -10; x <= 10; x += 10) b.light(x, arch(x) - 1.2, 0);
  for (const [x, z] of [[-14, -6], [12, 8], [7, 11]]) { b.block(x, z, 2.4, 1.2, 0.05, 1.3, Mat.Wood, { color: 0x6a5a40 }); b.addLoot(x + 2, 0.05, z); }
  b.addLoot(-3, R - 1.6, 0);
  return b;
}

// ---------------------------------------------------------------------------------------------
/**
 * Zordaya Prison (Zone 5E), the round fortress. The outer ring is itself a 3-level building: an arcade of
 * arches on the courtyard side, rooms behind it and on the upper floors, a walkable crenellated rampart on
 * top. Six turrets on the outside hold stairwells from the arcade up to the ramparts, with a ladder on to
 * each turret top. The north gate is a tunnel through the ring and the barbican (gabled block between two
 * big round towers), reached over a stone bridge. Courtyard: raised helipad deck, fuel tanks, water tower
 * with a ladder, metal cover roofs.
 */
export function prison2020(ctx: GenContext, cx: number, cz: number) {
  const f = frame(ctx, 'prison', cx, cz - 12, 0, 176, 200, 'prisonwall', 0x8d877c, 4);
  f.z = cz; // frame origin at the ring centre (the flattened area extends north for the bridge)
  const stone = 0x9a8e7c, dark = 0x847a6a, Ro = 70, Ri = 59, D = Ro - Ri, Hr = 15, N = 48, dt = (Math.PI * 2) / N;
  const L = 2 * Ro * Math.sin(dt / 2) + 0.3, Li = 2 * (Ri + 0.4) * Math.sin(dt / 2) + 0.35;
  const stairs = new Set([4, 12, 20, 28, 36, 44]);
  const h2 = D / 2;
  for (let i = 0; i < N; i++) {
    const t = -Math.PI / 2 + i * dt, b = new Builder(), gate = i === 0, st = stairs.has(i);
    // outer wall (thick, slit windows on the upper floors), inner courtyard wall (arcade arch on 1F)
    const slits = gate ? [{ u0: L / 2 - 3, u1: L / 2 + 3, v0: 0, v1: 7, open: true }] : [{ u0: L / 2 - 0.4, u1: L / 2 + 0.4, v0: 6.2, v1: 7.6, open: true }, { u0: L / 2 - 0.4, u1: L / 2 + 0.4, v0: 11.2, v1: 12.6, open: true }];
    b.wall(0, -L / 2, L / 2, h2 - 0.6, 0.05, Hr, 1.2, Mat.Rock, slits, stone);
    const arch = gate ? { u0: Li / 2 - 3, u1: Li / 2 + 3, v0: 0, v1: 7, open: true } : { u0: Li / 2 - 1.7, u1: Li / 2 + 1.7, v0: 0, v1: 4.2, open: true };
    b.wall(0, -Li / 2, Li / 2, -h2 + 0.4, 0.05, Hr, 0.8, Mat.Rock, [arch, ...(gate ? [] : [{ u0: Li / 2 - 0.6, u1: Li / 2 + 0.6, v0: 6.5, v1: 8.2, open: true }, { u0: Li / 2 - 0.6, u1: Li / 2 + 0.6, v0: 11.5, v1: 13.2, open: true }])], stone);
    if (gate) {
      // gate tunnel through the ring: side walls and a vaulted ceiling
      b.box(-3.3, 0.05, -h2, -3, 7.5, h2, Mat.Rock, { color: dark }); b.box(3, 0.05, -h2, 3.3, 7.5, h2, Mat.Rock, { color: dark });
      b.box(-3.3, 7.5, -h2, 3.3, 8, h2, Mat.Rock, { color: dark });
      b.box(-L / 2, 9.75, -h2 + 0.8, L / 2, 10, h2 - 1.2, Mat.Wood, { color: 0x6a5a44 }); // guard room floor above the gate
      b.light(0, 7.2, 0);
    } else {
      // arcade back wall (rooms behind, a door in every other bay; the stair bays open onto their landing)
      const Lb = 2 * (Ri + h2 - 1.1) * Math.sin(dt / 2) + 0.3; // chord at this radius (longer walls poke into the next bay)
      const doorOp = st ? [{ u0: Lb / 2 - L / 2 + 0.6, u1: Lb / 2 - L / 2 + 1.8, v0: 0, v1: 2.3, open: true }] : i % 2 === 0 ? [{ u0: Lb / 2 - 0.55, u1: Lb / 2 + 0.55, v0: 0, v1: 2.3, locked: i % 6 === 2 }] : [];
      b.wall(0, -Lb / 2, Lb / 2, -1.1, 0.05, 4.95, 0.3, Mat.Plaster, doorOp, 0xb0a490);
      const holes: [number, number, number, number][] = st ? [[-L / 2 + 1.4, -1, L / 2, 4.9]] : [];
      b.slab(-L / 2, -h2 + 0.8, L / 2, h2 - 1.2, 5, 0.3, Mat.Wood, holes);
      b.slab(-L / 2, -h2 + 0.8, L / 2, h2 - 1.2, 10, 0.3, Mat.Wood, holes);
      if (i % 4 === 2) for (const y of [0.05, 5, 10]) b.wall(1, -1.1, h2 - 1.2, -L / 2 + 0.15, y, 4.95, 0.25, Mat.Plaster, [{ u0: 2.2, u1: 3.3, v0: 0, v1: 2.2 }], 0xb0a490); // room partitions
      for (const y of [0.05, 5, 10]) b.light(0, y + 4.6, 1.8);
      if (i % 3 === 0) b.addLoot(0.5, 0.05, 2); if (i % 3 === 1) b.addLoot(-0.5, 5, 2); if (i % 5 === 0) b.addLoot(0, 10, 1);
      b.light(0, 4.6, -3.3);
    }
    if (st) {
      // stairwell across the bay (flights along the tangent), 1F -> rampart
      const x0 = -L / 2 + 0.1, x1 = L / 2 - 0.1, za = -1, zb = 1.9, zc = 4.8, Lf = 1.3, Lh = 1.3;
      for (let k = 0; k < 3; k++) {
        const y = 0.05 + k * 5, mid = y + 2.5, top = k === 2 ? Hr : y + 5;
        b.ramp(x0 + Lf, y, za, x1 - Lh, mid, zb - 0.05, 0, 1, Mat.Rock);
        b.ramp(x0 + Lf, mid, zb + 0.05, x1 - Lh, top, zc, 0, -1, Mat.Rock);
        b.box(x1 - Lh, mid - 0.25, za, x1, mid, zc, Mat.Rock, { color: dark });
        b.box(x0 + Lf + 0.5, y, zb - 0.05, x1 - Lh - 0.4, y + 5, zb + 0.05, Mat.Plaster, { color: 0xb0a490 });
      }
      // the turret outside it (standable top, crenellated), ladder up its face from the rampart
      // (centred over the top landing so its ladder is reached from the landing, not across the stair well)
      const tx = -L / 2 + 2.2;
      b.box(tx - 4.5, 0.05, h2, tx + 4.5, Hr + 5, h2 + 9, Mat.Rock, { color: dark, shape: 'cyl' });
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.box(tx + Math.cos(a) * 3.8 - 0.6, Hr + 5, h2 + 4.5 + Math.sin(a) * 3.8 - 0.6, tx + Math.cos(a) * 3.8 + 0.6, Hr + 6.2, h2 + 4.5 + Math.sin(a) * 3.8 + 0.6, Mat.Rock, { color: dark }); }
      b.ladder(-L / 2 + 0.7, h2 - 0.15, 0, -1, Hr, Hr + 5);
      b.addLoot(tx, Hr + 5, h2 + 4.5);
    }
    // rampart deck, crenellated outer parapet (gap at the turret ladders), low inner parapet
    b.slab(-L / 2, -h2, L / 2, h2, Hr, 0.5, Mat.Rock, st ? [[-L / 2 + 1.4, -1, L / 2, 4.8]] : []);
    for (let x = -L / 2 + 0.3; x < L / 2 - 0.5; x += 2.3) if (!(st && x < -L / 2 + 1.8)) b.box(x, Hr, h2 - 1.2, x + 1.2, Hr + 1.5, h2, Mat.Rock, { color: stone });
    if (!st) b.box(-L / 2, Hr, h2 - 1.2, L / 2, Hr + 0.8, h2, Mat.Rock, { color: stone });
    else b.box(-L / 2 + 1.7, Hr, h2 - 1.2, L / 2, Hr + 0.8, h2, Mat.Rock, { color: stone }); // gap at the turret ladder
    b.box(-Li / 2, Hr, -h2, Li / 2, Hr + 0.9, -h2 + 0.5, Mat.Rock, { color: stone });
    if (i % 8 === 6) b.addLoot(0, Hr, 0);
    const rm = (Ro + Ri) / 2;
    sub(ctx, f, Math.cos(t) * rm, Math.sin(t) * rm, Math.atan2(Math.cos(t), Math.sin(t)), b, st ? 'prisonturret' : 'prisonwall');
  }
  // barbican: gabled block over the gate tunnel between two big round towers, then the stone bridge
  {
    const b = new Builder(), bz = 7;
    b.box(-9, 0.05, -bz, -3.3, 20, bz, Mat.Rock, { color: stone }); b.box(3.3, 0.05, -bz, 9, 20, bz, Mat.Rock, { color: stone });
    b.box(-3.3, 7.5, -bz, 3.3, 20, bz, Mat.Rock, { color: stone });
    b.box(-9.2, 20, -bz - 0.2, 9.2, 25, bz + 0.2, Mat.Roof, { color: 0x5a524a, shape: 'gable' });
    b.box(-3, 0.05, -bz, -2.9, 7.5, bz, Mat.Rock, { color: dark }); b.box(2.9, 0.05, -bz, 3, 7.5, bz, Mat.Rock, { color: dark });
    for (const s of [-1, 1]) {
      b.box(s * 13 - 5.5, 0.05, -5.5, s * 13 + 5.5, 26, 5.5, Mat.Rock, { color: stone, shape: 'cyl' });
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.box(s * 13 + Math.cos(a) * 4.8 - 0.7, 26, Math.sin(a) * 4.8 - 0.7, s * 13 + Math.cos(a) * 4.8 + 0.7, 27.4, Math.sin(a) * 4.8 + 0.7, Mat.Rock, { color: stone }); }
    }
    // bridge (paved deck with parapets and piers)
    b.box(-3.6, -0.5, bz, 3.6, 0.05, bz + 30, Mat.Rock, { color: 0x8a8070 });
    b.box(-4, 0.05, bz, -3.6, 1.1, bz + 30, Mat.Rock, { color: stone }); b.box(3.6, 0.05, bz, 4, 1.1, bz + 30, Mat.Rock, { color: stone });
    b.light(0, 7.2, 0); b.addLoot(0, 26, 0);
    sub(ctx, f, 0, -(Ro + bz), Math.PI, b, 'barbican');
  }
  // courtyard (bailey)
  {
    const b = new Builder();
    b.box(-9, 0.05, -7, 9, 2.2, 7, Mat.Metal, { color: 0x7a7e76 }); // raised helipad deck
    b.ramp(9, 0.05, -1.5, 14, 2.2, 1.5, 0, -1, Mat.Metal);
    b.box(-8, 2.2, -0.2, 8, 2.21, 0.2, Mat.Trim, { color: 0xe8e8e0, noCollide: true });
    for (const z of [-3, 3]) b.box(-30, 0.05, 20 + z - 1.4, -18, 2.8, 20 + z + 1.4, Mat.Metal, { color: 0xb8b8b0, shape: 'cyl' }); // fuel tanks (lying)
    // water tower with a ladder
    for (const [x, z] of [[27, -27], [31, -27], [27, -23], [31, -23]]) b.box(x - 0.2, 0.05, z - 0.2, x + 0.2, 9, z + 0.2, Mat.Metal, { color: 0x5a524a });
    b.box(26.5, 9, -27.5, 31.5, 9.3, -22.5, Mat.Wood, { color: 0x6a5a44 });
    b.box(27, 9.3, -27, 31, 13, -23, Mat.Wood, { color: 0x6a5a44, shape: 'cyl' });
    b.ladder(29, -22.4, 0, 1, 0.05, 9.3);
    // metal cover roofs on posts
    for (const [x, z] of [[18, 22], [-22, -20]]) { b.box(x - 5, 3, z - 3, x + 5, 3.2, z + 3, Mat.Metal, { color: 0x6d7378 }); for (const [dx, dz] of [[-4.8, -2.8], [4.6, -2.8], [-4.8, 2.6], [4.6, 2.6]]) b.box(x + dx, 0.05, z + dz, x + dx + 0.2, 3, z + dz + 0.2, Mat.Metal, { color: 0x5a6066 }); }
    b.addLoot(0, 2.2, 0); b.addLoot(-24, 0.05, 20); b.addLoot(29, 9.3, -25); b.addLoot(18, 0.05, 22);
    sub(ctx, f, 0, 0, 0, b, 'prisonyard');
  }
}
