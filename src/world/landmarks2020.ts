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
