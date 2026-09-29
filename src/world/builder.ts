/**
 * Building archetypes, authored in local space (x = width, z = depth, y = up, origin at footprint
 * centre, ground floor at y = 0). Walls are split around real door/window openings so players can
 * walk and shoot through them.
 */
import { Mat, Part, RampPart } from './collision';
import { Rng } from '../core/rng';

export const FLOOR_H = 3.2;
export const WALL_T = 0.25;

export interface Opening { u0: number; u1: number; v0: number; v1: number; glass?: boolean; /** no door leaf (arches, garages, shop fronts) */ open?: boolean; /** door leaf that never opens (boarded flats, sealed stairwells) */ locked?: boolean }
/** A hinged door leaf in builder-local space: hinge at (x, z), closed leaf runs along +angle direction. */
export interface AscenderDef { x: number; z: number; nx: number; nz: number; y0: number; y1: number; stops: number[] }
export interface LadderDef { x: number; z: number; nx: number; nz: number; y0: number; y1: number }
export interface DoorDef { x: number; z: number; y: number; angle: number; w: number; h: number; locked?: boolean }

export class Builder {
  parts: Part[] = [];
  ramps: RampPart[] = [];
  loot: [number, number, number][] = [];
  doors: DoorDef[] = [];
  ladders: LadderDef[] = [];
  ascenders: AscenderDef[] = [];
  lights: [number, number, number][] = [];
  /**
   * Ascender (2020 vertical zip cable, in lift shafts): hold on with Use and ride up. (x, z) is the cable,
   * (nx, nz) the way out of the shaft, stops the floor levels you can step off at (the top is always one).
   */
  ascender(x: number, z: number, nx: number, nz: number, y0: number, y1: number, stops: number[] = []) {
    this.ascenders.push({ x, z, nx, nz, y0, y1, stops: [...stops, y1].sort((a, b) => a - b) });
    this.box(x - 0.02, y0, z - 0.02, x + 0.02, y1 + 2.2, z + 0.02, Mat.Metal, { color: 0x1d1f21, noCollide: true }); // cable
    this.box(x - 0.18, y0 + 0.9, z - 0.12, x + 0.18, y0 + 1.25, z + 0.12, Mat.Metal, { color: 0xc9a227, noCollide: true }); // yellow grab unit
    this.box(x - 0.3, y1 + 2.2, z - 0.3, x + 0.3, y1 + 2.5, z + 0.3, Mat.Metal, { color: 0x3a3d40, noCollide: true }); // top pulley
  }
  /** Ceiling light fixture (drawn as a lit panel; also a hint for interior lighting). */
  light(x: number, y: number, z: number) { this.lights.push([x, y, z]); }
  /**
   * Exterior ladder against a wall face. (x, z) is on the wall face, (nx, nz) the outward normal (axis-aligned).
   * Rails and rungs are visual only; climbing is handled by movement.
   */
  ladder(x: number, z: number, nx: number, nz: number, y0: number, y1: number) {
    this.ladders.push({ x, z, nx, nz, y0, y1 });
    const ox = x + nx * 0.18, oz = z + nz * 0.18, tx = -nz, tz = nx; // tangent along the wall
    const col = 0x6f7478, top = y1 + 1.0; // rails run up past the roof edge to grab
    for (const s of [-0.24, 0.24]) this.box(ox + tx * s - 0.025, y0, oz + tz * s - 0.025, ox + tx * s + 0.025, top, oz + tz * s + 0.025, Mat.Metal, { color: col, noCollide: true });
    for (let y = y0 + 0.3; y < y1 + 0.2; y += 0.3) this.box(ox - Math.abs(tx) * 0.24 - Math.abs(nx) * 0.015, y, oz - Math.abs(tz) * 0.24 - Math.abs(nz) * 0.015, ox + Math.abs(tx) * 0.24 + Math.abs(nx) * 0.015, y + 0.03, oz + Math.abs(tz) * 0.24 + Math.abs(nz) * 0.015, Mat.Metal, { color: col, noCollide: true });
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, extra?: Partial<Part>): Part {
    const p: Part = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), mat, ...extra };
    if (p.x1 - p.x0 < 1e-3 || p.y1 - p.y0 < 1e-3 || p.z1 - p.z0 < 1e-3) return p;
    this.parts.push(p); return p;
  }
  /** Solid box centred at (cx, cz). */
  block(cx: number, cz: number, w: number, d: number, y0: number, y1: number, mat: Mat, extra?: Partial<Part>) {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y1, cz + d / 2, mat, extra);
  }
  /**
   * Wall along an axis. axis 0: runs along x from a to b at z = c. axis 1: along z at x = c.
   * Openings are in wall space (u along the wall from a, v up from y0).
   */
  wall(axis: 0 | 1, a: number, b: number, c: number, y0: number, h: number, t: number, mat: Mat, openings: Opening[] = [], color?: number, out: 0 | 1 | -1 = 0, trim = 0xd8d4ca) {
    const len = b - a;
    if (out) for (const o of openings) {
      // decorative trims on the outside face: sill + head for windows, jambs + head for doors
      const u0 = Math.max(0, o.u0), u1 = Math.min(len, o.u1), f = c + out * (t / 2), e = 0.12 * out;
      const add = (uu0: number, uu1: number, vv0: number, vv1: number, depth: number) => {
        if (axis === 0) this.box(a + uu0, y0 + vv0, f, a + uu1, y0 + vv1, f + depth * out, Mat.Trim, { color: trim, noCollide: true });
        else this.box(f, y0 + vv0, a + uu0, f + depth * out, y0 + vv1, a + uu1, Mat.Trim, { color: trim, noCollide: true });
      };
      if (o.v0 > 0.2) { add(u0 - 0.1, u1 + 0.1, o.v0 - 0.08, o.v0, 0.16); add(u0 - 0.06, u1 + 0.06, o.v1, o.v1 + 0.12, 0.06); }
      else { add(u0 - 0.1, u0, 0, o.v1 + 0.1, 0.06); add(u1, u1 + 0.1, 0, o.v1 + 0.1, 0.06); add(u0 - 0.1, u1 + 0.1, o.v1, o.v1 + 0.12, 0.06); }
      void e;
    }
    const ops = openings.filter((o) => o.u1 > 0 && o.u0 < len).sort((p, q) => p.u0 - q.u0);
    // hinged doors in door-sized, floor-level openings (single ~1 m, double ~1.8 m as two leaves)
    for (const o of ops) {
      const ow = o.u1 - o.u0, oh = o.v1 - o.v0;
      if (o.open || o.glass || o.v0 > 0.05 || oh < 1.9 || oh > 2.8 || ow < 0.7 || ow > 2.3) continue;
      const leaves = ow > 1.45 ? 2 : 1, lw = ow / leaves - 0.02;
      for (let k = 0; k < leaves; k++) {
        // hinge at the jamb; leaf direction along the wall toward the other jamb (or the centre for doubles)
        const hu = k === 0 ? o.u0 + 0.01 : o.u1 - 0.01, dir = k === 0 ? 1 : -1;
        const hx = axis === 0 ? a + hu : c, hz = axis === 0 ? c : a + hu;
        const ang = axis === 0 ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.doors.push({ x: hx, z: hz, y: y0 + o.v0, angle: ang, w: lw, h: Math.min(oh - 0.03, 2.2), locked: o.locked });
      }
    }
    const seg = (u0: number, u1: number, v0: number, v1: number, m: Mat) => {
      if (u1 - u0 < 0.02 || v1 - v0 < 0.02) return;
      if (axis === 0) this.box(a + u0, y0 + v0, c - t / 2, a + u1, y0 + v1, c + t / 2, m, color !== undefined ? { color } : undefined);
      else this.box(c - t / 2, y0 + v0, a + u0, c + t / 2, y0 + v1, a + u1, m, color !== undefined ? { color } : undefined);
    };
    let u = 0;
    for (const o of ops) {
      const u0 = Math.max(0, o.u0), u1 = Math.min(len, o.u1);
      seg(u, u0, 0, h, mat);
      seg(u0, u1, 0, o.v0, mat);
      seg(u0, u1, o.v1, h, mat);
      if (o.glass) seg(u0, u1, o.v0, o.v1, Mat.Glass);
      u = Math.max(u, u1);
    }
    seg(u, len, 0, h, mat);
  }
  /** Floor slab with optional rectangular holes (stairwells). */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, t: number, mat: Mat, holes: [number, number, number, number][] = []) {
    // split along x into strips at hole edges, then along z
    const xs = [x0, x1]; for (const [hx0, , hx1] of holes) xs.push(hx0, hx1);
    const ux = [...new Set(xs)].filter((v) => v >= x0 && v <= x1).sort((p, q) => p - q);
    for (let i = 0; i < ux.length - 1; i++) {
      const sx0 = ux[i], sx1 = ux[i + 1], mx = (sx0 + sx1) / 2;
      const hs = holes.filter(([hx0, , hx1]) => mx > hx0 && mx < hx1).map(([, hz0, , hz1]) => [hz0, hz1] as [number, number]).sort((p, q) => p[0] - q[0]);
      let z = z0;
      for (const [hz0, hz1] of hs) { if (hz0 > z) this.box(sx0, y - t, z, sx1, y, hz0, mat); z = Math.max(z, hz1); }
      if (z < z1) this.box(sx0, y - t, z, sx1, y, z1, mat);
    }
  }
  ramp(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, axis: 0 | 1, dir: 1 | -1, mat = Mat.Concrete) {
    this.ramps.push({ x0, y0, z0, x1, y1, z1, axis, dir, mat });
  }
  addLoot(x: number, y: number, z: number) { this.loot.push([x, y + 0.05, z]); }
}

/** Evenly spaced window openings along a wall, skipping a reserved door span. */
function windows(len: number, spacing: number, w: number, sill: number, top: number, avoid: [number, number][] = [], glass = false): Opening[] {
  const out: Opening[] = [];
  const n = Math.max(0, Math.floor((len - 1.2) / spacing));
  const start = (len - (n - 1) * spacing) / 2;
  for (let i = 0; i < n; i++) {
    const c = start + i * spacing, u0 = c - w / 2, u1 = c + w / 2;
    if (u0 < 0.6 || u1 > len - 0.6) continue;
    if (avoid.some(([a, b]) => u1 > a - 0.3 && u0 < b + 0.3)) continue;
    out.push({ u0, u1, v0: sill, v1: top, glass });
  }
  return out;
}

export interface Style { wall: Mat; wallColor: number; trim: number; roof: Mat; roofColor: number }

/**
 * Detached house: 1-2 floors, door front and back, windows, an interior partition, stairs,
 * gable roof you can stand on.
 */
export function house(rng: Rng, w: number, d: number, floors: number, st: Style): Builder {
  // 2020 village houses sit on a plinth ~0.5 m up, with a few concrete steps at every door
  const b = new Builder(), hw = w / 2, hd = d / 2, H = FLOOR_H, E = 0.45;
  let lastPx = 0;
  b.box(-hw - 0.1, -1.5, -hd - 0.1, hw + 0.1, E + 0.05, hd + 0.1, Mat.Concrete, { color: 0x8a8580 }); // plinth + floor
  for (let f = 0; f < floors; f++) {
    const y = f * H + E + 0.05, wh = H - 0.05;
    const door: Opening = { u0: w / 2 - 0.6, u1: w / 2 + 0.6, v0: 0, v1: 2.3 };
    const frontOps = [...windows(w, 3.2, 1.3, 0.95, 2.25, f === 0 ? [[door.u0, door.u1]] : []), ...(f === 0 ? [door] : [])];
    const backDoor: Opening = { u0: w * 0.3 - 0.55, u1: w * 0.3 + 0.55, v0: 0, v1: 2.3 };
    const backOps = [...windows(w, 3.2, 1.3, 0.95, 2.25, f === 0 ? [[backDoor.u0, backDoor.u1]] : []), ...(f === 0 ? [backDoor] : [])];
    b.wall(0, -hw, hw, -hd, y, wh, WALL_T, st.wall, frontOps, st.wallColor, -1, st.trim);
    b.wall(0, -hw, hw, hd, y, wh, WALL_T, st.wall, backOps, st.wallColor, 1, st.trim);
    b.wall(1, -hd + WALL_T / 2, hd - WALL_T / 2, -hw, y, wh, WALL_T, st.wall, windows(d, 3.4, 1.2, 0.95, 2.25), st.wallColor, -1, st.trim);
    b.wall(1, -hd + WALL_T / 2, hd - WALL_T / 2, hw, y, wh, WALL_T, st.wall, windows(d, 3.4, 1.2, 0.95, 2.25), st.wallColor, 1, st.trim);
    // interior partition across the depth with a doorway
    const px = f === 0 ? (lastPx = rng.range(-hw * 0.3, hw * 0.3)) : rng.range(-hw * 0.3, hw * 0.3);
    if (w > 7) b.wall(1, -hd + WALL_T, hd - WALL_T, px, y, wh, 0.14, Mat.Plaster, [{ u0: d * 0.5 - 0.5, u1: d * 0.5 + 0.5, v0: 0, v1: 2.2 }], 0xd8d0c0);
    b.light((-hw + px) / 2, y + wh - 0.02, 0); b.light((hw + px) / 2, y + wh - 0.02, 0);
    b.addLoot(-hw + 1.2, y, -hd + 1.2); b.addLoot(hw - 1.2, y, hd - 1.2);
    if (rng.chance(0.5)) b.addLoot(px + 1, y, 0);
  }
  // upper floor slabs with a stairwell hole along the back-left wall
  const sw = 1.1, run = 4.2;
  const sx0 = -hw + WALL_T / 2 + 0.05, sz1 = hd - WALL_T / 2 - 0.05;
  for (let f = 1; f < floors; f++) {
    const y = f * H + E + 0.05;
    b.slab(-hw, -hd, hw, hd, y, 0.25, Mat.Concrete, [[sx0, sz1 - sw, sx0 + run + 0.3, sz1]]);
    b.ramp(sx0, (f - 1) * H + E + 0.05, sz1 - sw, sx0 + run, y, sz1, 0, 1);
  }
  // roof
  const top = floors * H + E + 0.05;
  // single-storey cottages: a loft under the ridge, reached by one straight stair (2020 atlas: "upstairs loft",
  // "check its attic"); the stair runs along the ridge line where there's headroom, on the side away from the partition
  const loft = floors === 1 && w >= 8;
  const side = lastPx < 0 ? 1 : -1, sxLo = side * (hw - 0.4), sxHi = side * (hw - 4.6);
  if (loft) {
    b.ramp(Math.min(sxLo, sxHi), E + 0.05, -0.55, Math.max(sxLo, sxHi), top, 0.55, 0, side > 0 ? -1 : 1, Mat.Wood);
    b.slab(-hw - 0.3, -hd - 0.3, hw + 0.3, hd + 0.3, top, 0.25, st.roof, [[Math.min(sxLo, sxHi) - 0.1, -0.65, Math.max(sxLo, sxHi) + 0.1, 0.65]]);
    b.light(0, top + Math.min(2.6, d * 0.28) - 0.35, 0);
    b.addLoot(-side * (hw - 1.5), top, 0);
  } else b.slab(-hw - 0.3, -hd - 0.3, hw + 0.3, hd + 0.3, top, 0.25, st.roof);
  const ridge = Math.min(2.6, d * 0.28);
  b.box(-hw - 0.4, top, -hd - 0.4, hw + 0.4, top + ridge, hd + 0.4, st.roof, { shape: 'gable', noCollide: true, color: st.roofColor });
  b.ramp(-hw - 0.4, top, -hd - 0.4, hw + 0.4, top + ridge, 0, 1, 1, st.roof);
  b.ramp(-hw - 0.4, top, 0, hw + 0.4, top + ridge, hd + 0.4, 1, -1, st.roof);
  b.box(-hw, top, -hd * 0.3, hw, top + ridge * 0.6, hd * 0.3, st.roof, { noCollide: true, mat: Mat.Wood } as any); // bullet blocker inside the gable
  if (rng.chance(0.6)) { const cx = rng.range(-hw * 0.6, hw * 0.6); b.box(cx - 0.35, top + ridge * 0.4, -0.35 + d * 0.12, cx + 0.35, top + ridge + 0.9, 0.35 + d * 0.12, Mat.Brick, { color: 0x8a6a5a }); }
  b.box(-hw - 0.1, -0.3, -hd - 0.1, hw + 0.1, E + 0.35, hd + 0.1, Mat.Concrete, { color: 0x8a8580, noCollide: true }); // plinth band
  // steps up to the front and back doors
  const steps = (cx: number, zFace: number, out: number) => { for (let k = 0; k < 3; k++) { const z0 = zFace + out * (0.05 + (2 - k) * 0.3); b.box(cx - 0.8, 0, Math.min(z0, z0 + out * 0.3), cx + 0.8, (k + 1) * (E + 0.05) / 3, Math.max(z0, z0 + out * 0.3), Mat.Concrete, { color: 0x9a968f }); } };
  steps(0, -hd - 0.1, -1); steps(-hw + w * 0.3, hd + 0.1, 1);
  // single-storey lean-to annex with its own door; its flat roof is the way up onto the main roof
  if (rng.chance(0.55) && d >= 7) {
    const ax0 = hw + 0.1, ax1 = hw + 4.1, az0 = -hd + 0.6, az1 = az0 + 5, ay = 0.05, ah = 2.6;
    b.box(ax0, -1.2, az0, ax1, ay, az1, Mat.Concrete, { color: 0x8a8580 });
    b.wall(0, ax0, ax1, az0 + 0.1, ay, ah, 0.2, st.wall, [{ u0: 1.4, u1: 2.4, v0: 0, v1: 2.15 }], st.wallColor, -1, st.trim);
    b.wall(0, ax0, ax1, az1 - 0.1, ay, ah, 0.2, st.wall, [], st.wallColor, 1, st.trim);
    b.wall(1, az0 + 0.2, az1 - 0.2, ax1 - 0.1, ay, ah, 0.2, st.wall, [{ u0: 1.8, u1: 3.0, v0: 1.0, v1: 2.1 }], st.wallColor, 1, st.trim);
    b.slab(ax0 - 0.1, az0 - 0.15, ax1 + 0.15, az1 + 0.15, ay + ah + 0.2, 0.2, st.roof);
    b.addLoot(ax0 + 2, ay, az0 + 3);
  }
  return b;
}

/**
 * Soviet-style apartment block / generic mid-rise: stair core with switchback ramps up to a roof
 * exit, doors on both long sides, window grid, a parapet.
 */
export function apartment(rng: Rng, w: number, d: number, floors: number, st: Style, opts: { glassBands?: boolean; groundShop?: boolean } = {}): Builder {
  const b = new Builder(), hw = w / 2, hd = d / 2, H = FLOOR_H;
  b.box(-hw - 0.1, -2, -hd - 0.1, hw + 0.1, 0.05, hd + 0.1, Mat.Concrete, { color: 0x7d7a76 });
  // stair core in the middle of the back wall: 2 flights per floor
  const coreW = 2.6, coreD = 5.2, cx0 = -coreW / 2, cz1 = hd - WALL_T / 2, cz0 = cz1 - coreD;
  const doors: [number, number][] = [];
  const nDoor = w > 26 ? 2 : 1;
  for (let i = 0; i < nDoor; i++) { const c = nDoor === 1 ? w / 2 : w * (0.25 + 0.5 * i); doors.push([c - 0.7, c + 0.7]); }
  for (let f = 0; f < floors; f++) {
    const y = f * H + 0.05, wh = H - 0.05;
    const gf = f === 0;
    const glass = !!opts.glassBands;
    const winF = glass ? [{ u0: 0.8, u1: w - 0.8, v0: 0.9, v1: 2.8, glass: true }] : windows(w, 3.0, 1.4, 0.9, 2.3, gf ? doors : []);
    const frontOps: Opening[] = gf && opts.groundShop ? [{ u0: 1, u1: w - 1, v0: 0.3, v1: 2.7, glass: true }, ...doors.map(([a, c]) => ({ u0: a, u1: c, v0: 0, v1: 2.4 }))] : [...(glass && gf ? [] : winF), ...(gf ? doors.map(([a, c]) => ({ u0: a, u1: c, v0: 0, v1: 2.4 })) : [])];
    if (glass && gf) { let u = 0.8; for (const [a, c] of doors) { if (a - u > 1) frontOps.push({ u0: u, u1: a - 0.2, v0: 0.9, v1: 2.8, glass: true }); u = c + 0.2; } if (w - 0.8 - u > 1) frontOps.push({ u0: u, u1: w - 0.8, v0: 0.9, v1: 2.8, glass: true }); }
    const backOps: Opening[] = [...(glass ? [{ u0: 0.8, u1: w / 2 - coreW / 2 - 0.4, v0: 0.9, v1: 2.8, glass: true }, { u0: w / 2 + coreW / 2 + 0.4, u1: w - 0.8, v0: 0.9, v1: 2.8, glass: true }] : windows(w, 3.0, 1.4, 0.9, 2.3, [[w / 2 - coreW / 2 - 0.2, w / 2 + coreW / 2 + 0.2]])), ...(gf ? [{ u0: w / 2 + coreW / 2 + 0.6, u1: w / 2 + coreW / 2 + 1.8, v0: 0, v1: 2.4 }] : [])];
    b.wall(0, -hw, hw, -hd, y, wh, 0.3, st.wall, frontOps, st.wallColor, glass ? 0 : -1, 0xc8c4ba);
    b.wall(0, -hw, hw, hd, y, wh, 0.3, st.wall, backOps, st.wallColor, glass ? 0 : 1, 0xc8c4ba);
    if (!glass && f > 0 && !opts.groundShop) {
      // Soviet-block balconies on the front, every other window bay
      for (const [k, o] of winF.entries()) if (k % 2 === (f % 2) && o.v0 > 0) {
        const x0 = -hw + o.u0 - 0.3, x1 = -hw + o.u1 + 0.3;
        b.box(x0, y - 0.05, -hd - 1.1, x1, y + 0.1, -hd - 0.15, Mat.Concrete, { color: 0xa8a49c });
        b.box(x0, y + 0.1, -hd - 1.12, x1, y + 1.0, -hd - 1.02, Mat.Concrete, { color: st.wallColor });
        b.box(x0, y + 0.1, -hd - 1.1, x0 + 0.08, y + 1.0, -hd - 0.15, Mat.Metal, { color: 0x555555, noCollide: true });
        b.box(x1 - 0.08, y + 0.1, -hd - 1.1, x1, y + 1.0, -hd - 0.15, Mat.Metal, { color: 0x555555, noCollide: true });
      }
    }
    const sideOps = glass ? [{ u0: 0.8, u1: d - 0.8, v0: 0.9, v1: 2.8, glass: true }] : windows(d, 3.2, 1.3, 0.9, 2.3);
    b.wall(1, -hd + 0.15, hd - 0.15, -hw, y, wh, 0.3, st.wall, sideOps, st.wallColor);
    b.wall(1, -hd + 0.15, hd - 0.15, hw, y, wh, 0.3, st.wall, sideOps, st.wallColor);
    // interior: core walls (with opening towards the corridor) and room partitions
    b.wall(1, cz0, cz1, cx0 - 0.1, y, wh, 0.18, Mat.Plaster, [{ u0: 0.3, u1: 1.5, v0: 0, v1: 2.3 }], 0xcfc8bb);
    b.wall(1, cz0, cz1, -cx0 + 0.1, y, wh, 0.18, Mat.Plaster, [{ u0: 0.3, u1: 1.5, v0: 0, v1: 2.3 }], 0xcfc8bb);
    const nPart = Math.floor(w / 9);
    for (let i = 1; i <= nPart; i++) {
      const px = -hw + (w / (nPart + 1)) * i;
      if (Math.abs(px) < coreW) continue;
      b.wall(1, -hd + 0.3, hd - 0.3, px, y, wh, 0.14, Mat.Plaster, [{ u0: d * 0.35, u1: d * 0.35 + 1.1, v0: 0, v1: 2.2 }], 0xd8d0c0);
    }
    b.addLoot(-hw + 1.5, y, -hd + 1.5); b.addLoot(hw - 1.5, y, -hd + 1.5);
    if (w > 20) b.addLoot(rng.range(-hw + 2, hw - 2), y, rng.range(-hd + 2, hd - 3));
    // flights: first half along +z on the left side of the core, second back along -z on the right
    const mid = y + H / 2;
    b.ramp(cx0 + 0.05, y, cz0 + 1.2, cx0 + coreW / 2 - 0.05, mid, cz1 - 0.1, 1, 1);
    b.ramp(cx0 + coreW / 2 + 0.05, mid, cz0 + 1.2, -cx0 - 0.05, y + H, cz1 - 0.1, 1, -1);
    b.box(cx0, mid - 0.2, cz1 - 0.1 - 0.001, -cx0, mid, cz1 - 0.1, Mat.Concrete); // tiny landing lip (visual)
    if (f + 1 <= floors) {
      const yy = y + H;
      b.slab(-hw, -hd, hw, hd, yy, 0.3, Mat.Concrete, [[cx0, cz0 + 1.1, -cx0, cz1]]);
    }
  }
  // facade: a slab-edge band at every floor and a darker plinth (Soviet panel-block look)
  for (let f = 1; f <= floors; f++) {
    const y = f * H + 0.05, band = opts.glassBands ? 0.45 : 0.22, out = opts.glassBands ? 0.12 : 0.08, col = opts.glassBands ? 0x8a8e92 : 0xb8b4aa;
    b.box(-hw - out, y - band, -hd - out, hw + out, y + 0.02, -hd + 0.02, Mat.Trim, { color: col, noCollide: true });
    b.box(-hw - out, y - band, hd - 0.02, hw + out, y + 0.02, hd + out, Mat.Trim, { color: col, noCollide: true });
    b.box(-hw - out, y - band, -hd, -hw + 0.02, y + 0.02, hd, Mat.Trim, { color: col, noCollide: true });
    b.box(hw - 0.02, y - band, -hd, hw + out, y + 0.02, hd, Mat.Trim, { color: col, noCollide: true });
  }
  b.box(-hw - 0.06, 0.05, -hd - 0.06, hw + 0.06, 0.75, hd + 0.06, Mat.Concrete, { color: 0x77736c, noCollide: true });
  if (opts.glassBands) for (let x = -hw + 3; x < hw - 1; x += 3) { b.box(x - 0.08, 0.05, -hd - 0.1, x + 0.08, floors * H, -hd + 0.05, Mat.Metal, { color: 0x6a6e72, noCollide: true }); b.box(x - 0.08, 0.05, hd - 0.05, x + 0.08, floors * H, hd + 0.1, Mat.Metal, { color: 0x6a6e72, noCollide: true }); }
  // roof: parapet + stair head house over the core
  const top = floors * H + 0.05;
  b.wall(0, -hw, hw, -hd + 0.15, top, 1.0, 0.3, st.wall, [], st.wallColor);
  b.wall(0, -hw, hw, hd - 0.15, top, 1.0, 0.3, st.wall, [{ u0: hw + cx0 - 0.2, u1: hw - cx0 + 0.2, v0: 0, v1: 1.0 }], st.wallColor); // open above the stair landing
  b.wall(1, -hd, hd, -hw + 0.15, top, 1.0, 0.3, st.wall, [], st.wallColor);
  b.wall(1, -hd, hd, hw - 0.15, top, 1.0, 0.3, st.wall, [], st.wallColor);
  b.wall(0, cx0 - 0.2, -cx0 + 0.2, cz0 + 0.9, top, 2.6, 0.2, st.wall, [{ u0: coreW / 2 + 0.05, u1: coreW + 0.35, v0: 0, v1: 2.3 }], st.wallColor); // doorway over the up-flight
  b.wall(1, cz0 + 0.9, cz1, cx0 - 0.1, top, 2.6, 0.2, st.wall, [], st.wallColor);
  b.wall(1, cz0 + 0.9, cz1, -cx0 + 0.1, top, 2.6, 0.2, st.wall, [], st.wallColor);
  b.box(cx0 - 0.3, top + 2.6, cz0 + 0.8, -cx0 + 0.3, top + 2.85, cz1 + 0.1, Mat.Roof);
  b.addLoot(hw - 2, top, -hd + 2);
  // roof clutter: AC units, vents, antennas, water tanks
  const nClutter = Math.floor(w / 10) + 1;
  for (let i = 0; i < nClutter; i++) {
    const cx = rng.range(-hw + 2, hw - 2), cz = rng.range(-hd + 1.5, hd - 1.5);
    if (Math.abs(cx) < coreW && cz > cz0) continue;
    const k = rng.next();
    if (k < 0.45) b.block(cx, cz, 1.8, 1.2, top, top + 1.2, Mat.Metal, { color: 0xa0a6aa });
    else if (k < 0.7) b.block(cx, cz, 0.6, 0.6, top, top + 0.9, Mat.Metal, { color: 0x8a9096 });
    else if (k < 0.85) b.block(cx, cz, 0.12, 0.12, top, top + 4 + rng.next() * 3, Mat.Metal, { color: 0x6a6e72, noCollide: true });
    else b.box(cx - 1.2, top, cz - 1.2, cx + 1.2, top + 2.2, cz + 1.2, Mat.Metal, { color: 0x8a8f94, shape: 'cyl' });
  }
  return b;
}

/** Tall downtown tower: glass bands, stair core to the roof, ground-floor lobby. */
export function tower(rng: Rng, w: number, d: number, floors: number, st: Style): Builder {
  return apartment(rng, w, d, floors, st, { glassBands: true });
}

/** Warehouse / hangar: big open hall with roller doors, a mezzanine with stairs, clerestory windows. */
export function warehouse(rng: Rng, w: number, d: number, h: number, st: Style, opts: { hangar?: boolean } = {}): Builder {
  const b = new Builder(), hw = w / 2, hd = d / 2;
  b.box(-hw - 0.1, -1.5, -hd - 0.1, hw + 0.1, 0.1, hd + 0.1, Mat.Concrete, { color: 0x8a8884 });
  const bigDoor = opts.hangar ? { u0: w * 0.1, u1: w * 0.9, v0: 0, v1: h * 0.8 } : { u0: w / 2 - 2.5, u1: w / 2 + 2.5, v0: 0, v1: 4.2 };
  const hi = windows(w, 4, 2.5, h - 2, h - 0.8);
  b.wall(0, -hw, hw, -hd, 0.1, h, 0.3, st.wall, [bigDoor, ...hi.filter((o) => o.u1 < bigDoor.u0 || o.u0 > bigDoor.u1 || o.v0 > bigDoor.v1)], st.wallColor);
  b.wall(0, -hw, hw, hd, 0.1, h, 0.3, st.wall, [{ u0: w * 0.25 - 0.6, u1: w * 0.25 + 0.6, v0: 0, v1: 2.4 }, ...(opts.hangar ? [] : [{ u0: w * 0.7 - 2, u1: w * 0.7 + 2, v0: 0, v1: 4 }]), ...windows(w, 4, 2.5, h - 2, h - 0.8)], st.wallColor);
  b.wall(1, -hd + 0.15, hd - 0.15, -hw, 0.1, h, 0.3, st.wall, [{ u0: d / 2 - 0.6, u1: d / 2 + 0.6, v0: 0, v1: 2.4 }, ...windows(d, 5, 2, 1.2, 2.4, [[d / 2 - 0.6, d / 2 + 0.6]])], st.wallColor);
  b.wall(1, -hd + 0.15, hd - 0.15, hw, 0.1, h, 0.3, st.wall, windows(d, 5, 2, 1.2, 2.4), st.wallColor);
  // mezzanine along the back with stairs
  if (!opts.hangar && d > 12 && h > 6) {
    const my = 3.6;
    b.box(-hw + 0.2, my - 0.25, hd - 5, hw - 0.2, my, hd - 0.2, Mat.Metal, { color: 0x6d7378 });
    b.box(-hw + 0.2, my, hd - 5.05, hw - 0.2, my + 1.0, hd - 4.95, Mat.Metal, { color: 0x6d7378, noCollide: false });
    b.ramp(-hw + 0.4, 0.1, hd - 6.3 - 0.1, -hw + 5.4, my, hd - 5.1, 0, 1, Mat.Metal);
    b.box(-hw + 0.4, 0.1, hd - 6.3 - 0.1, -hw + 5.4, 0.2, hd - 5.1, Mat.Metal, { noCollide: true });
    b.addLoot(hw - 2, my, hd - 2); b.addLoot(0, my, hd - 2.5);
  }
  // crates inside for cover
  const n = Math.floor((w * d) / 140);
  for (let i = 0; i < n; i++) {
    const cx = rng.range(-hw + 3, hw - 3), cz = rng.range(-hd + 3, hd - 7);
    b.block(cx, cz, rng.range(1.2, 2.4), rng.range(1.2, 2.4), 0.1, 0.1 + rng.pick([1.2, 1.2, 2.4]), rng.chance(0.5) ? Mat.Wood : Mat.Container, { color: rng.pick([0x7a5a38, 0x5e6e44, 0x6a4a30]) });
  }
  b.slab(-hw - 0.2, -hd - 0.2, hw + 0.2, hd + 0.2, h + 0.1, 0.3, st.roof);
  for (let lx = -hw + 5; lx <= hw - 5; lx += 8) for (let lz = -hd + 5; lz <= hd - 5; lz += 8) b.light(lx, h - 0.25, lz);
  b.ladder(hw + 0.15, -hd + 2.2, 1, 0, 0.1, h + 0.1); // roof ladder on the side (2020: warehouses reach the roof by exterior ladder)
  b.addLoot(-hw + 2, 0.1, -hd + 2); b.addLoot(hw - 2, 0.1, -hd + 2); b.addLoot(0, 0.1, 0);
  return b;
}

/** Single-storey shop / garage with a glass front. */
export function shop(rng: Rng, w: number, d: number, st: Style): Builder {
  const b = new Builder(), hw = w / 2, hd = d / 2, h = 3.8;
  b.box(-hw - 0.1, -1.5, -hd - 0.1, hw + 0.1, 0.1, hd + 0.1, Mat.Concrete, { color: 0x8a8884 });
  b.wall(0, -hw, hw, -hd, 0.1, h, 0.25, st.wall, [{ u0: 0.8, u1: w / 2 - 1, v0: 0.4, v1: 2.8, glass: true }, { u0: w / 2 - 0.8, u1: w / 2 + 0.8, v0: 0, v1: 2.5 }, { u0: w / 2 + 1, u1: w - 0.8, v0: 0.4, v1: 2.8, glass: true }], st.wallColor);
  b.wall(0, -hw, hw, hd, 0.1, h, 0.25, st.wall, [{ u0: 1, u1: 2.1, v0: 0, v1: 2.3 }], st.wallColor);
  b.wall(1, -hd + 0.12, hd - 0.12, -hw, 0.1, h, 0.25, st.wall, windows(d, 3.5, 1.2, 1, 2.2), st.wallColor);
  b.wall(1, -hd + 0.12, hd - 0.12, hw, 0.1, h, 0.25, st.wall, [], st.wallColor);
  // counter/shelves
  b.block(0, hd * 0.3, w * 0.5, 0.8, 0.1, 1.1, Mat.Wood, { color: 0x6b4a2f });
  for (let lx = -hw + 2.5; lx <= hw - 2.5; lx += 4) b.light(lx, h + 0.08 - 0.02 - 0.3, 0);
  b.slab(-hw - 0.3, -hd - 0.3, hw + 0.3, hd + 0.3, h + 0.1, 0.3, st.roof);
  b.ladder(hw - 1.2, hd + 0.125, 0, 1, 0.1, h + 0.1); // roof ladder at the back
  // signage band
  b.box(-hw - 0.05, h - 0.6, -hd - 0.35, hw + 0.05, h + 0.4, -hd - 0.25, Mat.Trim, { color: rng.pick([0xb03a2e, 0x2e5eaa, 0xd8a31a, 0x2f8a4a]), noCollide: true });
  b.addLoot(-hw + 1.2, 0.1, hd - 1.2); b.addLoot(hw - 1.2, 0.1, 0);
  return b;
}

/** Row of lock-up garages (Storage Town). */
export function garageRow(rng: Rng, w: number, d: number, st: Style): Builder {
  const b = new Builder(), hw = w / 2, hd = d / 2, h = 2.8, unit = 3.4;
  const n = Math.max(2, Math.floor(w / unit));
  b.box(-hw, -1, -hd, hw, 0.1, hd, Mat.Concrete, { color: 0x8a8884 });
  b.wall(0, -hw, hw, hd, 0.1, h, 0.2, st.wall, [], st.wallColor);
  b.wall(1, -hd, hd, -hw, 0.1, h, 0.2, st.wall, [], st.wallColor);
  b.wall(1, -hd, hd, hw, 0.1, h, 0.2, st.wall, [], st.wallColor);
  const ops: Opening[] = [];
  for (let i = 0; i < n; i++) {
    const u0 = i * (w / n) + 0.35, u1 = (i + 1) * (w / n) - 0.35;
    if (rng.chance(0.55)) ops.push({ u0, u1, v0: 0, v1: 2.3 }); // open door
    else b.box(-hw + u0, 0.1, -hd - 0.05, -hw + u1, 2.4, -hd + 0.05, Mat.Metal, { color: rng.pick([0x6a7a6a, 0x7a6a5a, 0x5a6a7a, 0x8a8a7a]) });
    if (i > 0) b.wall(1, -hd + 0.1, hd - 0.1, -hw + i * (w / n), 0.1, h, 0.15, st.wall, [], st.wallColor);
    if (rng.chance(0.3)) b.addLoot(-hw + (u0 + u1) / 2, 0.1, 0);
  }
  b.wall(0, -hw, hw, -hd, 0.1, h, 0.2, st.wall, ops, st.wallColor);
  b.slab(-hw - 0.2, -hd - 0.3, hw + 0.2, hd + 0.2, h + 0.1, 0.2, Mat.Roof);
  return b;
}
