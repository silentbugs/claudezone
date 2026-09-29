/**
 * Apartment buildings laid out like 2020 Verdansk (per the official Tac Map Atlas, see
 * .harness/ref/interiors/spec.md, archetypes C and E):
 *  - Every stairwell is a "podyezd": a 3 m bay running the full depth of the building, entered by a
 *    double door under a canopy, with a dogleg (switchback) stair: a flight up the left side to a half
 *    landing at the rear wall (with a window), a flight back down the right side to the next floor's
 *    landing. Flat doors open off the landings. The top flight comes up into a roof hut.
 *  - Walk-ups (2-3 floors) have one podyezd, flats either side, about half the flat doors open.
 *  - Long panel blocks have a podyezd every ~16 m, but (as in 2020) only one is enterable; the others
 *    are locked. Inside it, one flat every couple of floors is open, the rest are boarded (locked doors,
 *    glazed windows). Blocks of 5+ floors have a lift shaft with an ascender beside the stairs.
 *  - Downtown towers: stairs only go to 3F; the ascender is the only way higher (to the roof).
 */
import { Mat } from './collision';
import { Builder, FLOOR_H, Opening, Style } from './builder';
import { Rng } from '../core/rng';

const H = FLOOR_H, BAY = 3.0, T = 0.3;

interface Hole { x0: number; z0: number; x1: number; z1: number }
interface Sec { cx: number; open: boolean }
export interface BlockOpts { floors: number; kind: 'walkup' | 'panel' | 'tower'; glass?: boolean }

/** Wall along x at z (outer face sign `out`), openings given in absolute x. */
function wallX(b: Builder, z: number, xa: number, xb: number, y: number, h: number, st: Style, ops: (Opening & { x0?: number })[], out: -1 | 1 | 0, t = T, mat?: Mat, color?: number) {
  b.wall(0, xa, xb, z, y, h, t, mat ?? st.wall, ops, color ?? st.wallColor, out, st.trim || 0xc8c4ba);
}
const op = (xa: number, x0: number, x1: number, v0: number, v1: number, extra: Partial<Opening> = {}): Opening => ({ u0: x0 - xa, u1: x1 - xa, v0, v1, ...extra });

export function block2020(rng: Rng, w: number, d: number, st: Style, o: BlockOpts): Builder {
  const b = new Builder(), hw = w / 2, hd = d / 2, F = o.floors;
  const E = o.kind === 'walkup' ? 0.45 : 0.6; // raised ground floor
  const lvl = (f: number) => E + f * H;
  const top = lvl(F);
  const glassy = !!o.glass;
  // --- sections (podyezds)
  const nSec = o.kind === 'walkup' ? 1 : Math.max(1, Math.round(w / 16));
  const secW = w / nSec, secs: Sec[] = [];
  const openIdx = nSec === 1 ? 0 : rng.int(0, nSec - 1);
  for (let i = 0; i < nSec; i++) secs.push({ cx: -hw + secW * (i + 0.5), open: i === openIdx });
  // landing depth: deeper buildings get a lobby so flights stay ~6 m long
  const lift = o.kind !== 'walkup' && (F >= 5 || o.kind === 'tower');
  const Lh = 1.3, L = Math.max(lift ? 3.8 : 1.8, d - Lh - 6.2);
  const z0 = -hd + T / 2, z1 = hd - T / 2;
  const stairsTo = o.kind === 'tower' ? Math.min(2, F) : F; // towers: stairs stop at 3F (two flights up)
  const LZ0 = z0 + 1.45, LZ1 = z0 + 3.6, LZC = (LZ0 + LZ1) / 2; // lift shaft span along z (opening centred on it)
  // plinth / ground slab
  b.box(-hw - 0.1, -1.6, -hd - 0.1, hw + 0.1, E, hd + 0.1, Mat.Concrete, { color: 0x7d7a76 });
  const holes: Hole[][] = Array.from({ length: F + 1 }, () => []);
  // per-floor flat-door states for the open section: [left, right]
  const flatOpen: [boolean, boolean][] = [];
  for (let f = 0; f < F; f++) {
    if (o.kind === 'walkup') flatOpen.push([rng.chance(0.55), rng.chance(0.55)]);
    else { const any = f % 2 === 0 || (o.kind === 'tower' && f < 3); const side = rng.chance(0.5); flatOpen.push([any && side, any && !side]); }
  }
  // --- facade walls, floor by floor
  for (let f = 0; f < F; f++) {
    const y = lvl(f), wh = H - 0.05;
    const front: Opening[] = [], back: Opening[] = [];
    for (const s of secs) {
      const bx0 = s.cx - BAY / 2, bx1 = s.cx + BAY / 2;
      const inside = s.open;
      // flats: windows either side of the bay (open where the flat is accessible, glazed otherwise)
      for (const [fa, fb, side] of [[s.cx - secW / 2, bx0, 0], [bx1, s.cx + secW / 2, 1]] as [number, number, number][]) {
        const accessible = inside && flatOpen[f][side];
        const n = Math.max(1, Math.floor((fb - fa - 1) / 3.2));
        for (let k = 0; k < n; k++) {
          const c = fa + (fb - fa) * ((k + 0.5) / n);
          const win = { v0: 0.9, v1: 2.3, glass: glassy || !accessible };
          front.push(op(-hw, c - 0.7, c + 0.7, win.v0, win.v1, { glass: win.glass }));
          back.push(op(-hw, c - 0.7, c + 0.7, win.v0, win.v1, { glass: win.glass }));
        }
      }
      if (f === 0) front.push(op(-hw, s.cx - 0.9, s.cx + 0.9, 0, 2.3, { locked: !inside }));
      else front.push(op(-hw, s.cx - 0.6, s.cx + 0.6, 0.9, 2.3, { glass: !inside || glassy }));
      // rear: the bay's full-height wall is built separately (landing windows); leave a gap here
    }
    // rear wall pieces between bays
    let xa = -hw;
    for (const s of secs) {
      const bx0 = s.cx - BAY / 2, bx1 = s.cx + BAY / 2;
      wallX(b, hd - T / 2, xa, bx0, y, wh, st, back.filter((q) => q.u0 + -hw >= xa - 1e-6 && q.u1 + -hw <= bx0 + 1e-6).map((q) => ({ ...q, u0: q.u0 - (xa + hw), u1: q.u1 - (xa + hw) })), glassy ? 0 : 1);
      xa = bx1;
    }
    wallX(b, hd - T / 2, xa, hw, y, wh, st, back.filter((q) => q.u0 + -hw >= xa - 1e-6).map((q) => ({ ...q, u0: q.u0 - (xa + hw), u1: q.u1 - (xa + hw) })), glassy ? 0 : 1);
    wallX(b, -hd + T / 2, -hw, hw, y, wh, st, front, glassy ? 0 : -1);
    const sideOps = [{ u0: d * 0.3 - 0.6, u1: d * 0.3 + 0.6, v0: 0.9, v1: 2.3, glass: true }, { u0: d * 0.7 - 0.6, u1: d * 0.7 + 0.6, v0: 0.9, v1: 2.3, glass: true }];
    b.wall(1, -hd + T, hd - T, -hw + T / 2, y, wh, T, st.wall, sideOps, st.wallColor, glassy ? 0 : -1);
    b.wall(1, -hd + T, hd - T, hw - T / 2, y, wh, T, st.wall, sideOps, st.wallColor, glassy ? 0 : 1);
  }
  // --- each podyezd
  for (const s of secs) {
    const bx0 = s.cx - BAY / 2, bx1 = s.cx + BAY / 2, bxm = s.cx;
    // bay rear wall, full height, a window at every half landing
    const rearOps: Opening[] = [];
    for (let f = 0; f < F; f++) rearOps.push({ u0: 0.7, u1: BAY - 0.7, v0: lvl(f) - E + H / 2 + 0.9, v1: lvl(f) - E + H / 2 + 2.1, glass: !s.open });
    b.wall(0, bx0, bx1, hd - T / 2, E, F * H, T, st.wall, rearOps, st.wallColor, glassy ? 0 : 1);
    // porch at the front door: canopy + steps
    b.box(s.cx - 1.6, E + 2.55, -hd - 1.5, s.cx + 1.6, E + 2.75, -hd, Mat.Concrete, { color: 0xa39f97 });
    for (let k = 0; k < 3; k++) b.box(s.cx - 1.3, 0, -hd - 0.35 * (3 - k) - 0.05, s.cx + 1.3, ((k + 1) * E) / 3, -hd - 0.35 * (2 - k) - 0.05, Mat.Concrete, { color: 0x9a968f });
    if (!s.open) continue; // sealed podyezd: facade only
    // party walls to the sealed neighbours
    for (const x of [s.cx - secW / 2, s.cx + secW / 2]) if (Math.abs(Math.abs(x) - hw) > 0.5) b.wall(1, -hd + T, hd - T, x, E, F * H, 0.25, Mat.Concrete, [], 0xa8a39a);
    for (let f = 0; f < F; f++) {
      const y = lvl(f), wh = H - 0.05;
      // bay side walls with the flat doors off the landing (and the lift opening)
      for (const [x, side] of [[bx0, 0], [bx1, 1]] as [number, number][]) {
        const ops: Opening[] = [{ u0: 0.35, u1: 1.3, v0: 0, v1: 2.15, locked: !flatOpen[f][side] }];
        if (lift && side === 0) ops.push({ u0: LZC - 0.55 - z0, u1: LZC + 0.55 - z0, v0: 0, v1: 2.2, open: true });
        b.wall(1, z0, z1, x, y, wh, 0.2, Mat.Plaster, ops, 0xbfb8aa);
      }
      // dogleg flights (stairs stop at stairsTo)
      if (f < stairsTo) {
        const mid = y + H / 2;
        b.ramp(bx0 + 0.1, y, z0 + L, bxm - 0.05, mid, z1 - Lh, 1, 1);
        b.ramp(bxm + 0.05, mid, z0 + L, bx1 - 0.1, y + H, z1 - Lh, 1, -1);
        b.box(bx0 + 0.1, mid - 0.2, z1 - Lh, bx1 - 0.1, mid, z1 - 0.02, Mat.Concrete, { color: 0x9a968f }); // half landing
        b.box(bxm - 0.05, y, z0 + L + 0.6, bxm + 0.05, y + H, z1 - Lh - 0.7, Mat.Plaster, { color: 0xbfb8aa }); // wall between the flights
        holes[f + 1].push({ x0: bx0, z0: z0 + L, x1: bx1, z1: z1 });
        b.light(s.cx, mid + H / 2 - 0.05, z1 - Lh / 2);
      }
      b.light(s.cx, y + H - 0.08, z0 + L / 2);
      b.addLoot(s.cx, y, z0 + 0.8);
      // flats: partitions + lights + loot where accessible
      for (const [fa, fb, side] of [[s.cx - secW / 2 + T / 2, bx0 - 0.1, 0], [bx1 + 0.1, s.cx + secW / 2 - T / 2, 1]] as [number, number, number][]) {
        if (!flatOpen[f][side]) continue;
        const fw = fb - fa;
        if (side === 0) { // two-bed: a wall across the flat with a doorway, and a room split
          b.wall(0, fa, fb, 0, y, wh, 0.12, Mat.Plaster, [{ u0: fw * 0.6, u1: fw * 0.6 + 0.9, v0: 0, v1: 2.1 }], 0xd8d0c0);
          if (fw > 5) b.wall(1, 0.06, z1, fa + fw * 0.45, y, wh, 0.12, Mat.Plaster, [{ u0: 0.8, u1: 1.7, v0: 0, v1: 2.1 }], 0xd8d0c0);
        } else { // studio with a bathroom box in the back corner
          b.wall(0, fb - 2.2, fb, z1 - 2.2, y, wh, 0.12, Mat.Plaster, [{ u0: 0.3, u1: 1.1, v0: 0, v1: 2.1 }], 0xd8d0c0);
          b.wall(1, z1 - 2.2, z1, fb - 2.2, y, wh, 0.12, Mat.Plaster, [], 0xd8d0c0);
        }
        b.light((fa + fb) / 2, y + H - 0.08, -hd / 2); b.light((fa + fb) / 2, y + H - 0.08, hd / 2);
        b.addLoot(fa + 1, y, z1 - 1); b.addLoot(fb - 1, y, z0 + 1.5);
        // furniture: a table and a wardrobe
        b.block(fa + fw * 0.3, -hd * 0.4, 1.2, 0.8, y, y + 0.75, Mat.Wood, { color: 0x6b4a2f });
        b.block(fb - 0.4, 0.8, 0.6, 1.4, y, y + 2.0, Mat.Wood, { color: 0x5a3d26 });
      }
    }
    // lift shaft with ascender (beside the landing, inside the left flat's footprint)
    if (lift) {
      const lx1 = bx0 - 0.1, lx0 = lx1 - 2.1, lz0 = LZ0, lz1 = LZ1;
      b.wall(0, lx0, lx1, lz0, E, F * H + 3, 0.2, Mat.Concrete, [], 0x8a8680);
      b.wall(0, lx0, lx1, lz1, E, F * H + 3, 0.2, Mat.Concrete, [], 0x8a8680);
      b.wall(1, lz0, lz1, lx0, E, F * H + 3, 0.2, Mat.Concrete, [], 0x8a8680);
      for (let f = 1; f <= F; f++) holes[f].push({ x0: lx0, z0: lz0, x1: lx1, z1: lz1 });
      b.ascender((lx0 + lx1) / 2, (lz0 + lz1) / 2, 1, 0, E, top, Array.from({ length: F }, (_, f) => lvl(f)));
      // lift head room on the roof, opening onto the roof
      b.wall(1, lz0 - 0.1, lz1 + 0.1, lx1 + 0.1, top, 3, 0.2, st.wall, [{ u0: LZC - 0.55 - (lz0 - 0.1), u1: LZC + 0.55 - (lz0 - 0.1), v0: 0, v1: 2.2 }], st.wallColor);
      b.box(lx0 - 0.2, top + 3, lz0 - 0.2, lx1 + 0.3, top + 3.2, lz1 + 0.2, Mat.Roof);
    }
    // roof hut over the top flight (only where the stairs reach the roof)
    if (stairsTo === F) {
      b.wall(0, bx0 - 0.1, bx1 + 0.1, z0, top, 2.6, 0.2, st.wall, [], st.wallColor);
      b.wall(0, bx0 - 0.1, bx1 + 0.1, z1, top, 2.6, 0.2, st.wall, [], st.wallColor);
      b.wall(1, z0, z1, bx0, top, 2.6, 0.2, st.wall, lift ? [{ u0: LZC - 0.55 - z0, u1: LZC + 0.55 - z0, v0: 0, v1: 2.2, open: true }] : [], st.wallColor);
      b.wall(1, z0, z1, bx1, top, 2.6, 0.2, st.wall, [{ u0: 0.35, u1: 1.3, v0: 0, v1: 2.15 }], st.wallColor); // metal door out onto the roof
      b.box(bx0 - 0.3, top + 2.6, z0 - 0.2, bx1 + 0.3, top + 2.8, z1 + 0.2, Mat.Roof);
    }
  }
  // --- floor slabs (only inside the enterable podyezd's footprint) and the roof
  for (let f = 1; f < F; f++) {
    for (const s of secs) if (s.open) b.slab(s.cx - secW / 2 + T / 2, -hd + T / 2, s.cx + secW / 2 - T / 2, hd - T / 2, lvl(f), 0.25, Mat.Concrete, holes[f].filter((hh) => hh.x1 > s.cx - secW / 2 && hh.x0 < s.cx + secW / 2).map((hh) => [hh.x0, hh.z0, hh.x1, hh.z1] as [number, number, number, number]));
  }
  b.slab(-hw, -hd, hw, hd, top, 0.3, st.roof, holes[F].map((hh) => [hh.x0, hh.z0, hh.x1, hh.z1] as [number, number, number, number]));
  // parapet + slab-edge bands + roof clutter
  const par = 0.8;
  b.wall(0, -hw, hw, -hd + 0.15, top, par, 0.3, st.wall, [], st.wallColor);
  b.wall(0, -hw, hw, hd - 0.15, top, par, 0.3, st.wall, [], st.wallColor);
  b.wall(1, -hd, hd, -hw + 0.15, top, par, 0.3, st.wall, [], st.wallColor);
  b.wall(1, -hd, hd, hw - 0.15, top, par, 0.3, st.wall, [], st.wallColor);
  for (let f = 1; f <= F; f++) {
    const y = lvl(f), col = glassy ? 0x8a8e92 : 0xb8b4aa;
    b.box(-hw - 0.08, y - 0.22, -hd - 0.08, hw + 0.08, y + 0.02, -hd + 0.02, Mat.Trim, { color: col, noCollide: true });
    b.box(-hw - 0.08, y - 0.22, hd - 0.02, hw + 0.08, y + 0.02, hd + 0.08, Mat.Trim, { color: col, noCollide: true });
  }
  for (let i = 0; i < Math.floor(w / 10) + 1; i++) {
    const cx = rng.range(-hw + 2, hw - 2), cz = rng.range(-hd + 1.5, hd - 1.5);
    if (secs.some((s) => Math.abs(cx - s.cx) < BAY + 1)) continue;
    b.block(cx, cz, 1.8, 1.2, top, top + 1.2, Mat.Metal, { color: 0xa0a6aa });
  }
  // sealed and tall blocks: an exterior ladder up the back (2020: "a ladder in the back allows you to access its roof")
  if (o.kind === 'panel' && F <= 5) b.ladder(hw - 1.5, hd + 0.15, 0, 1, 0, top);
  b.addLoot(hw - 2, top, -hd + 2);
  return b;
}
