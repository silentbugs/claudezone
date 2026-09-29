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
