/**
 * Populates Verdansk: hand-built landmarks first, then procedural buildings wherever the traced
 * tac-map shows built-up ground (oriented to the nearest roads, styled by district), then trees,
 * wrecks and cover. Also flattens the terrain under every footprint.
 */
import { Rng, hash2 } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import { CollisionWorld, Heightfield, makeStructure, Mat, Structure, Part } from './collision';
import { block2020, tenement2020 } from './blocks2020';
import { Builder, house, apartment, tower, warehouse, shop, garageRow, Style } from './builder';
import { MapMasks, MAP_SIZE, M_BUILT, M_ROAD, M_SNOW, POIS, Poi } from './mapdata';
import { buildTerrain, riverQuery, TerrainExtras, waterSurfaceAt } from './terrain';
import { buildLandmarks } from './landmarks';
import { FOOTPRINTS } from '../data/footprints';

export type District = 'downtown' | 'urban' | 'suburb' | 'industrial' | 'military' | 'rural' | 'airport';

const DISTRICT: Record<string, District> = {
  downtown: 'downtown', promenade_east: 'urban', promenade_west: 'urban', hospital: 'urban', train_station: 'urban', torsk_bloc: 'urban', tv_station: 'urban', bloc_6: 'urban', graveyard: 'urban',
  hills: 'suburb', farmland: 'rural', lumber: 'industrial', bloc_18: 'suburb', bloc_16: 'suburb', riverside: 'suburb', lozoff_pass: 'urban', park: 'suburb', jarvdinsk_spomenik: 'suburb',
  port: 'industrial', storage_town: 'industrial', boneyard: 'industrial', quarry: 'industrial', airport_maintenance: 'industrial', junkyard: 'industrial', superstore: 'urban',
  military_base: 'military', airport: 'airport', dam: 'industrial', prison: 'military', stadium: 'urban',
};

export function districtAt(x: number, z: number): { d: District; poi: Poi | null } {
  let best: Poi | null = null, bd = Infinity;
  for (const p of POIS) {
    const d = Math.hypot(p.x - x, p.z - z) / Math.max(60, p.r);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best || bd > 1.35) return { d: 'rural', poi: best && bd < 2.2 ? best : null };
  return { d: DISTRICT[best.id] ?? 'rural', poi: best };
}

// 2020 Verdansk reads earthy and weathered, not pastel: ochre / yellow / sand / faded green / blue-grey plaster,
// rusty-red, green and slate corrugated roofs (sampled from the 2020 location shots in .harness/ref)
const PALETTE = {
  plaster: [0xc4ad7e, 0xc9a957, 0xb9ab8c, 0x9aa48c, 0xa7aeb0, 0xb99a7a, 0xbab09c, 0x8f9a86, 0xcfc4ad, 0xa89a80],
  brick: [0x8c5a44, 0x9a6a50, 0x7a4c3a, 0xa87c62],
  concrete: [0x99948a, 0x8a8b86, 0xa39885, 0x7d7d79, 0xab9f8e, 0x8e8a80],
  metal: [0x7c8286, 0x6f7a74, 0x8a7f70, 0x5f6b72, 0x9a9588],
  roof: [0x5e6b4a, 0x7a3e30, 0x5a4a40, 0x4c5257, 0x8a5236, 0x6b6f6a, 0x47563f, 0x6a3a2e],
};

function styleFor(rng: Rng, kind: 'house' | 'block' | 'tower' | 'industrial' | 'shop'): Style {
  switch (kind) {
    // village houses: mostly corrugated-metal roofs (green, rusty red, slate), some tiles; a few brick walls
    case 'house': { const brick = rng.chance(0.2); return { wall: brick ? Mat.Brick : Mat.Plaster, wallColor: rng.pick(brick ? PALETTE.brick : PALETTE.plaster), trim: 0xd8d2c4, roof: rng.chance(0.6) ? Mat.Metal : Mat.Roof, roofColor: rng.pick(PALETTE.roof) }; }
    case 'block': return { wall: Mat.Concrete, wallColor: rng.pick([...PALETTE.concrete, ...PALETTE.plaster.slice(0, 4)]), trim: 0xcccccc, roof: Mat.Roof, roofColor: rng.pick([0x6e6d69, 0x5f605c, 0x75706a]) }; // flat tar / felt roofs
    case 'tower': return { wall: Mat.Concrete, wallColor: rng.pick([0xb8b4aa, 0x9ea4a8, 0x8e8a82, 0xc2bcae, 0x7a8288]), trim: 0xcccccc, roof: Mat.Roof, roofColor: rng.pick([0x6a6b68, 0x5c5e5b]) };
    case 'industrial': return { wall: Mat.Metal, wallColor: rng.pick(PALETTE.metal), trim: 0x999999, roof: Mat.Metal, roofColor: rng.pick([0x7a7f82, 0x6a6f6c, 0x7e6a58]) }; // corrugated sheds
    case 'shop': return { wall: Mat.Plaster, wallColor: rng.pick(PALETTE.plaster), trim: 0xe8e4dc, roof: Mat.Roof, roofColor: rng.pick([0x6a6b68, 0x5c5e5b, 0x77726b]) };
  }
}

export interface Tree { x: number; y: number; z: number; s: number; kind: 0 | 1 | 2 } // 0 pine, 1 birch/leafy, 2 bush
/** A hinged door: its collision structure and closed angle. */
export interface DoorRec { sid: number; base: number; w: number; h: number; locked?: boolean }
/** An exterior ladder in world space: base on the wall face, outward normal, bottom and roof heights. */
export interface LadderRec { x: number; z: number; nx: number; nz: number; y0: number; y1: number; hatch?: boolean }
export interface AscenderRec { x: number; z: number; nx: number; nz: number; y0: number; y1: number; stops: number[] }
export interface WorldData {
  ascenders: AscenderRec[];
  /** interior light fixtures, xyz triples */
  lights: Float32Array;
  doors: DoorRec[];
  ladders: LadderRec[];
  hf: Heightfield;
  extra: TerrainExtras;
  col: CollisionWorld;
  trees: Tree[];
  masks: MapMasks;
  /** spots for buy stations, supply boxes, contracts */
  buyStations: { x: number; y: number; z: number; a: number }[];
  chests: { x: number; y: number; z: number }[];
  contracts: { x: number; y: number; z: number }[];
  groundLoot: { x: number; y: number; z: number; poi: string | null }[];
  vehicleSpawns: { x: number; y: number; z: number; a: number }[];
  wires: Float32Array;
  balloons: { x: number; y: number; z: number }[];
}

/** Occupancy raster at 1.5 m so buildings, landmarks and props don't overlap. */
class Occupancy {
  readonly res: number; readonly cell = 1.5; readonly g: Uint8Array;
  constructor(size: number) { this.res = Math.ceil(size / this.cell); this.g = new Uint8Array(this.res * this.res); }
  private forRect(cx: number, cz: number, a: number, w: number, d: number, pad: number, fn: (i: number) => boolean | void): boolean {
    const c = Math.cos(a), s = Math.sin(a), hw = w / 2 + pad, hd = d / 2 + pad, st = this.cell * 0.7;
    for (let v = -hd; v <= hd + 1e-6; v += st) for (let u = -hw; u <= hw + 1e-6; u += st) {
      const x = cx + u * c + v * s, z = cz - u * s + v * c;
      const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
      if (i < 0 || j < 0 || i >= this.res || j >= this.res) return false;
      if (fn(j * this.res + i) === false) return false;
    }
    return true;
  }
  /** Codes: 0 free, 1 building, 2 road, 3 road splat, 4 prop, 5 tree, 6 water / rail line (never). `roadOk` lets props and traced footprints sit on roads. */
  free(cx: number, cz: number, a: number, w: number, d: number, pad = 0, roadOk = false) { return this.forRect(cx, cz, a, w, d, pad, (i) => this.g[i] === 0 || (roadOk && (this.g[i] === 2 || this.g[i] === 3))); }
  mark(cx: number, cz: number, a: number, w: number, d: number, pad = 0, v = 1) { this.forRect(cx, cz, a, w, d, pad, (i) => { this.g[i] = Math.max(this.g[i], v); }); }
  markCircle(cx: number, cz: number, r: number, v = 1) { for (let z = cz - r; z <= cz + r; z += this.cell) for (let x = cx - r; x <= cx + r; x += this.cell) { if ((x - cx) ** 2 + (z - cz) ** 2 > r * r) continue; const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell); if (i >= 0 && j >= 0 && i < this.res && j < this.res) this.g[j * this.res + i] = Math.max(this.g[j * this.res + i], v); } }
  at(x: number, z: number) { const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell); return i < 0 || j < 0 || i >= this.res || j >= this.res ? 255 : this.g[j * this.res + i]; }
}

export interface GenContext {
  rng: Rng; hf: Heightfield; extra: TerrainExtras; masks: MapMasks; col: CollisionWorld; occ: Occupancy;
  /** Place a builder as a structure at world pos with rotation; flattens terrain under it. */
  place(b: Builder, kind: string, x: number, z: number, angle: number, opts?: { y?: number; flatten?: boolean; pad?: number; poi?: string; style?: number; lodColor?: number; mark?: boolean; skirt?: number; seat?: 'max' | 'graded' }): Structure;
  flatten(x: number, z: number, angle: number, w: number, d: number, y: number, skirt: number): void;
  footprintHeights(x: number, z: number, angle: number, w: number, d: number): { min: number; max: number; avg: number };
  buyStations: WorldData['buyStations']; chests: WorldData['chests']; contracts: WorldData['contracts']; vehicleSpawns: WorldData['vehicleSpawns'];
  wires: number[];
  balloons: { x: number; y: number; z: number }[];
}

export function generateWorld(masks: MapMasks, seed = 1): WorldData {
  const rng = new Rng(seed);
  const { hf, extra } = buildTerrain(masks);
  const col = new CollisionWorld(hf);
  // water surface raster (sea + unfrozen rivers) at 4 m: O(1) lookups for every player every tick
  const WR = 4, wn = Math.ceil(MAP_SIZE / WR), water = new Float32Array(wn * wn).fill(-1e9);
  for (const rv of extra.rivers) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [px, pz] of rv.pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
    for (let j = Math.max(0, Math.floor((z0 - 40) / WR)); j <= Math.min(wn - 1, Math.ceil((z1 + 40) / WR)); j++) for (let i = Math.max(0, Math.floor((x0 - 40) / WR)); i <= Math.min(wn - 1, Math.ceil((x1 + 40) / WR)); i++) {
      const w = waterSurfaceAt([rv], hf, (i + 0.5) * WR, (j + 0.5) * WR); if (w > water[j * wn + i]) water[j * wn + i] = w;
    }
  }
  col.waterAt = (x, z) => { const i = Math.floor(x / WR), j = Math.floor(z / WR); const r = i >= 0 && j >= 0 && i < wn && j < wn ? water[j * wn + i] : -1e9; return r > -1e8 ? r : hf.at(x, z) < 0 ? 0 : -Infinity; };
  const occ = new Occupancy(MAP_SIZE);
  // rivers and roads are off-limits for buildings
  for (let j = 0; j < occ.res; j++) for (let i = 0; i < occ.res; i++) {
    const x = (i + 0.5) * occ.cell, z = (j + 0.5) * occ.cell;
    if (masks.has(x, z, M_ROAD)) occ.g[j * occ.res + i] = 2;
    const k = Math.round(z / hf.step) * hf.res + Math.round(x / hf.step);
    if (extra.river[k] || hf.h[k] < 0.3) occ.g[j * occ.res + i] = 6; // water: never built on
    else if (extra.road[k] > 0.35) occ.g[j * occ.res + i] = 3;
  }
  // the freight line and a margin either side are off-limits too
  { const rp = extra.railPath; for (let i = 0; i < rp.length; i += 3) { const x = rp[i], z = rp[i + 2]; for (let dz = -8; dz <= 8; dz += occ.cell) for (let dx = -8; dx <= 8; dx += occ.cell) { const oi = Math.floor((x + dx) / occ.cell), oj = Math.floor((z + dz) / occ.cell); if (oi >= 0 && oj >= 0 && oi < occ.res && oj < occ.res) occ.g[oj * occ.res + oi] = 6; } } }
  const doors: DoorRec[] = [];
  const ladders: LadderRec[] = [];
  const ascenders: AscenderRec[] = [];
  const lights: number[] = [];
  const ctx: GenContext = {
    rng, hf, extra, masks, col, occ,
    buyStations: [], chests: [], contracts: [], vehicleSpawns: [], wires: [], balloons: [],
    footprintHeights(x, z, a, w, d) {
      const c = Math.cos(a), s = Math.sin(a);
      let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
      for (let v = -d / 2; v <= d / 2 + 0.01; v += Math.max(1.5, d / 6)) for (let u = -w / 2; u <= w / 2 + 0.01; u += Math.max(1.5, w / 6)) {
        const h = hf.at(x + u * c + v * s, z - u * s + v * c); mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; n++;
      }
      return { min: mn, max: mx, avg: sum / n };
    },
    flatten(x, z, a, w, d, y, skirt) {
      const c = Math.cos(a), s = Math.sin(a), R = Math.hypot(w, d) / 2 + skirt;
      const i0 = Math.max(0, Math.floor((x - R) / hf.step)), i1 = Math.min(hf.res - 1, Math.ceil((x + R) / hf.step));
      const j0 = Math.max(0, Math.floor((z - R) / hf.step)), j1 = Math.min(hf.res - 1, Math.ceil((z + R) / hf.step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = i * hf.step - x, pz = j * hf.step - z;
        const u = px * c - pz * s, v = px * s + pz * c;
        const ex = Math.max(0, Math.abs(u) - w / 2), ez = Math.max(0, Math.abs(v) - d / 2), e = Math.hypot(ex, ez);
        if (e > skirt) continue;
        const k = j * hf.res + i, t = smoothstep(skirt, 0, e);
        hf.h[k] = hf.h[k] + (y - hf.h[k]) * t;
      }
    },
    place(b, kind, x, z, angle, opts = {}) {
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (const p of b.parts) { if (p.y1 < -0.2 && p.y0 < -0.5 && p.y1 <= 0.1) { /* foundation */ } bx0 = Math.min(bx0, p.x0); bz0 = Math.min(bz0, p.z0); bx1 = Math.max(bx1, p.x1); bz1 = Math.max(bz1, p.z1); }
      const w = bx1 - bx0, d = bz1 - bz0, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      const wx = x + cx * c + cz * s, wz = z - cx * s + cz * c;
      let y = opts.y;
      // 'graded': on a slope the floor sits between the mean and the top of the ground (cut and fill), not on its top
      if (y === undefined) { const fh = ctx.footprintHeights(wx, wz, angle, w, d); y = opts.seat === 'graded' ? fh.avg + (fh.max - fh.avg) * 0.35 : fh.max; }
      if (opts.flatten !== false) ctx.flatten(wx, wz, angle, w, d, y - 0.15, opts.skirt ?? 4);
      if (opts.mark !== false) occ.mark(wx, wz, angle, w, d, opts.pad ?? 1.5, 1);
      const st = makeStructure(0, kind, x, y, z, angle, b.parts, b.ramps, b.loot);
      st.poi = opts.poi; st.style = opts.style; st.lodColor = opts.lodColor;
      const added = col.add(st);
      for (const a of (b as any).ascenders ?? []) {
        ascenders.push({ x: x + a.x * c + a.z * s, z: z - a.x * s + a.z * c, nx: a.nx * c + a.nz * s, nz: -a.nx * s + a.nz * c, y0: y + a.y0, y1: y + a.y1, stops: a.stops.map((v: number) => y + v) });
      }
      for (const [lx, ly, lz] of (b as any).lights ?? []) lights.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
      for (const l of (b as any).ladders ?? []) {
        const lx = x + l.x * c + l.z * s, lz = z - l.x * s + l.z * c, nx = l.nx * c + l.nz * s, nz = -l.nx * s + l.nz * c;
        ladders.push({ x: lx, z: lz, nx, nz, y0: y + l.y0, y1: y + l.y1, hatch: !!l.hatch });
      }
      // hinged door leaves: each its own small structure pivoting on its hinge
      for (const d of (b as any).doors ?? []) {
        const hx = x + d.x * c + d.z * s, hz = z - d.x * s + d.z * c, a = angle + d.angle;
        const ds = makeStructure(0, 'door', hx, y + d.y, hz, a, [{ x0: 0, y0: 0, z0: -0.025, x1: d.w, y1: d.h, z1: 0.025, mat: Mat.Wood, color: 0x6b5238 }]);
        col.add(ds); doors.push({ sid: ds.id, base: a, w: d.w, h: d.h, locked: !!d.locked });
      }
      return added;
    },
  };

  // 1) landmarks (hand-built POI centrepieces)
  buildLandmarks(ctx);

  // 2) every building on its real footprint (traced from the tac map: position, size, orientation, L / U wings)
  const roadField = roadDirectionField(masks);
  const placed = placeFootprints(ctx, roadField);
  void placed;

  // 4) street props: burnt cars along roads, barriers, containers
  const props = placeProps(ctx, roadField);

  // 4b) street lamps on urban road edges, power lines along the highways
  placeStreetFurniture(ctx);

  // 5) trees
  const trees = placeTrees(ctx);

  // 6) ground loot spots in every structure + chests
  const groundLoot: WorldData['groundLoot'] = [];
  for (const s of col.structures) {
    for (const [lx, ly, lz] of s.loot) {
      const wx = s.x + lx * s.cos + lz * s.sin, wz = s.z - lx * s.sin + lz * s.cos;
      groundLoot.push({ x: wx, y: s.y + ly, z: wz, poi: s.poi ?? null });
    }
  }
  // supply chests: a share of the loot spots become chests
  for (const g of groundLoot) if (rng.chance(0.16)) ctx.chests.push({ x: g.x, y: g.y, z: g.z });
  void placed; void props;
  // street furniture that landed on the line: nudge it off to the side
  {
    const rp = extra.railPath;
    for (const st of col.structures) {
      if (st.kind !== 'lamp' && st.kind !== 'prop' && st.kind !== 'pole') continue;
      let bd = Infinity, bi = 0;
      for (let i = 0; i < rp.length; i += 3) { const d = (rp[i] - st.x) ** 2 + (rp[i + 2] - st.z) ** 2; if (d < bd) { bd = d; bi = i; } }
      const d = Math.sqrt(bd), need = 3.2 + st.radius;
      if (d >= need) continue;
      const ox = d > 0.01 ? (st.x - rp[bi]) / d : 1, oz = d > 0.01 ? (st.z - rp[bi + 2]) / d : 0;
      st.x = rp[bi] + ox * (need + 0.5); st.z = rp[bi + 2] + oz * (need + 0.5); st.y = hf.at(st.x, st.z);
    }
  }
  col.finalize();
  // restore the track bed where later footprints (the Train Station, pads nearby) moved the ground under it
  {
    const rp = extra.railPath, n = hf.res, sp = hf.step, R = Math.ceil(4.5 / sp);
    for (let i = 0; i < rp.length; i += 3) {
      const x = rp[i], y = rp[i + 1] - 0.35, z = rp[i + 2];
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const ii = Math.round(x / sp) + di, jj = Math.round(z / sp) + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const d = Math.hypot(ii * sp - x, jj * sp - z), k = jj * n + ii;
        if (d <= 2.6) hf.h[k] = y; // bed: exact (cut or fill)
        else if (d <= 4.5) { const lim = (d - 2.6) * 1.2; hf.h[k] = Math.min(y + lim, Math.max(y - lim, hf.h[k])); } // shoulders: at most a 50° slope from the bed
      }
    }
  }
  return { doors, ladders, ascenders, lights: Float32Array.from(lights), hf, extra, col, trees, masks, buyStations: ctx.buyStations, chests: ctx.chests, contracts: ctx.contracts, groundLoot: groundLoot.filter((g) => !ctx.chests.includes(g as any)), vehicleSpawns: ctx.vehicleSpawns, wires: Float32Array.from(ctx.wires), balloons: ctx.balloons };
}

import { VERDANSK } from '../data/verdansk';
import { pointInPoly } from '../core/math';
const PLAY = VERDANSK.playable as unknown as [number, number][];
export function inPlayable(x: number, z: number) { return pointInPoly(x, z, PLAY); }

/**
 * 2020 village / suburban plot: a low fence (wooden picket, fieldstone or chain-link) about 3 m round the house
 * with a gap for the front gate, each side only where the ground is free; sometimes a garden shed at the back.
 * Low enough (≤1.1 m) to vault.
 */
function addYard(ctx: GenContext, x: number, z: number, ang: number, w: number, d: number) {
  const { rng, occ } = ctx, m = 3, hw = w / 2 + m, hd = d / 2 + m, c = Math.cos(ang), s = Math.sin(ang);
  const W = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const style = rng.pick(['picket', 'picket', 'stone', 'chain']);
  const col = style === 'picket' ? rng.pick([0x8a6a48, 0x6e5a44, 0xa89a80, 0x5a6a4a]) : style === 'stone' ? 0x8a8478 : 0x8a8f94;
  const hgt = style === 'stone' ? 0.9 : style === 'chain' ? 1.1 : 1.0;
  const b = new Builder(), y0 = ctx.hf.at(x, z);
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    // one side, split around blocked cells and the gate; boards/wall plus posts
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < n; i++) {
      const a0 = i / n, a1 = (i + 1) / n, sx0 = x0 + (x1 - x0) * a0, sz0 = z0 + (z1 - z0) * a0, sx1 = x0 + (x1 - x0) * a1, sz1 = z0 + (z1 - z0) * a1;
      const mx = (sx0 + sx1) / 2, mz = (sz0 + sz1) / 2;
      if (Math.abs(mx) < 1.6 && mz < -hd + 0.5) continue; // front gate
      const [wx, wz] = W(mx, mz); if (occ.at(wx, wz) !== 0 || ctx.hf.at(wx, wz) < 1) continue;
      const t = style === 'stone' ? 0.35 : 0.08, g = ctx.hf.at(wx, wz) - y0; // each segment sits on the ground under it
      if (Math.abs(sx1 - sx0) > Math.abs(sz1 - sz0)) b.box(Math.min(sx0, sx1), g - 0.3, mz - t / 2, Math.max(sx0, sx1), g + hgt, mz + t / 2, style === 'stone' ? Mat.Rock : style === 'chain' ? Mat.Metal : Mat.Wood, { color: col });
      else b.box(mx - t / 2, g - 0.3, Math.min(sz0, sz1), mx + t / 2, g + hgt, Math.max(sz0, sz1), style === 'stone' ? Mat.Rock : style === 'chain' ? Mat.Metal : Mat.Wood, { color: col });
      if (style !== 'stone') b.box(sx0 - 0.06, g - 0.3, sz0 - 0.06, sx0 + 0.06, g + hgt + 0.15, sz0 + 0.06, Mat.Wood, { color: 0x5a4a38 });
    }
  };
  run(-hw, -hd, hw, -hd); run(-hw, hd, hw, hd); run(-hw, -hd, -hw, hd); run(hw, -hd, hw, hd);
  // garden shed in a back corner
  if (rng.chance(0.4)) {
    const sx = rng.chance(0.5) ? -hw + 1.6 : hw - 1.6, sz = hd - 1.4, [wx, wz] = W(sx, sz);
    if (occ.at(wx, wz) === 0) { const g = ctx.hf.at(wx, wz) - y0; b.box(sx - 1.1, g - 0.3, sz - 0.9, sx + 1.1, g + 2.1, sz + 0.9, Mat.Wood, { color: rng.pick([0x6e5a44, 0x7a4a3a, 0x5a6a4a]) }); b.box(sx - 1.3, g + 2.1, sz - 1.1, sx + 1.3, g + 2.25, sz + 1.1, Mat.Roof, { color: 0x4a4f55 }); }
  }
  if (!b.parts.length) return;
  ctx.place(b, 'fence', x, z, ang, { y: y0, flatten: false, mark: false, lodColor: col });
  for (const [lx, lz, ww, dd] of [[0, -hd, 2 * hw, 0.6], [0, hd, 2 * hw, 0.6], [-hw, 0, 0.6, 2 * hd], [hw, 0, 0.6, 2 * hd]] as const) { const [wx, wz] = W(lx, lz); occ.mark(wx, wz, ang, ww, dd, 0, 4); }
}

/**
 * Buildings on the traced footprints. Each rectangle (or each wing of an L / U / T block) becomes one building of
 * exactly that size, turned so its front faces the nearest road; the archetype comes from the district and the
 * footprint (size, proportions). Footprints under a hand-built landmark are left to the landmark.
 */
function placeFootprints(ctx: GenContext, roadField: (x: number, z: number) => number | null): number {
  const { rng, occ, hf } = ctx;
  let n = 0;
  const pendingSteps: [Builder, Structure][] = [];
  for (const [fx, fz, fang, fw, fd, round, parts] of FOOTPRINTS) {
    if (!inPlayable(fx, fz) || hf.at(fx, fz) < 0.6) continue;
    if (!occ.free(fx, fz, fang, fw * 0.8, fd * 0.8, 0, true)) continue; // a landmark already stands here (roads under a footprint are the old trace)
    const { d: dist, poi } = districtAt(fx, fz);
    const c = Math.cos(fang), s = Math.sin(fang);
    // round footprints: storage tanks and silos are small; big round shapes (plazas, canopies, a bandstand) are not tanks
    if (round && Math.min(fw, fd) >= 3 && Math.max(fw, fd) <= 14) { placeTank(ctx, fx, fz, Math.min(fw, fd) / 2); n++; continue; }
    if (round && Math.max(fw, fd) > 14) continue;
    const rects: [number, number, number, number][] = parts ? parts : [[0, 0, fw, fd]];
    const area = rects.reduce((a, r) => a + r[2] * r[3], 0);
    const wingSeed = rng.next();
    for (const [u, v, w0, d0] of rects) {
      const x = fx + u * c + v * s, z = fz - u * s + v * c;
      // front toward the road: of the four quarter turns, the one whose -z faces the road, preferring the long side
      const want = roadField(x, z);
      let best = { a: fang, w: w0, d: d0, score: -Infinity };
      for (let k = 0; k < 4; k++) {
        const a = fang + (k * Math.PI) / 2, w = k % 2 ? d0 : w0, d = k % 2 ? w0 : d0;
        const face = want === null ? 0 : Math.cos(a - want);
        const score = face * 2 + (w >= d ? 0.6 : 0);
        if (score > best.score) best = { a, w, d, score };
      }
      const bb = buildingFor(rng, dist, best.w, best.d, area, wingSeed);
      if (!bb) continue;
      const st = ctx.place(bb.b, bb.kind, x, z, best.a, { poi: poi?.id, style: bb.style, lodColor: bb.lod, pad: 0.3, seat: 'graded', skirt: 7 });
      pendingSteps.push([bb.b, st]);
      if (bb.kind === 'house' && !parts && (dist === 'suburb' || dist === 'rural') && rng.chance(0.5)) addYard(ctx, x, z, best.a, best.w, best.d);
      n++;
    }
  }
  // steps last: a neighbour's grading can still lower the ground in front of a door
  for (const [b, st] of pendingSteps) addDoorSteps(ctx, b, st);
  return n;
}

/**
 * Buildings stand on the real (sloping) ground: where a ground-floor door still sits above the terrain outside it,
 * a flight of concrete steps runs down from the threshold (sloped Verdansk streets have them everywhere).
 */
function addDoorSteps(ctx: GenContext, b: Builder, st: Structure) {
  const c = Math.cos(st.angle), s = Math.sin(st.angle), done: [number, number][] = [];
  for (const d of (b as any).doors ?? []) {
    if (d.y > 0.8) continue; // upper-floor doors open onto balconies / gantries
    // door centre (building-local) and its two faces
    const lx = d.x + Math.cos(d.angle) * d.w / 2, lz = d.z - Math.sin(d.angle) * d.w / 2;
    if (done.some(([px, pz]) => Math.hypot(px - lx, pz - lz) < 1.6)) continue; // the other leaf of a double door
    done.push([lx, lz]);
    const nx = Math.sin(d.angle), nz = Math.cos(d.angle);
    let bestGap = 0, side = 1;
    const floorY = st.y + d.y;
    for (const sd of [1, -1]) {
      const ox = lx + nx * sd * 1.4, oz = lz + nz * sd * 1.4, wx = st.x + ox * c + oz * s, wz = st.z - ox * s + oz * c;
      if (!(wx > 2 && wz > 2 && wx < MAP_SIZE - 2 && wz < MAP_SIZE - 2)) continue; // (also NaN-safe)
      const g = floorY - ctx.hf.at(wx, wz); // (the collision grid is only built after generation: terrain is what is outside a door)
      if (g > bestGap) { bestGap = g; side = sd; }
    }
    // only where the ground falls away below the building's own base (house plinths and block porches have steps)
    if (bestGap - d.y < 0.45 || bestGap > 6) continue;
    // a stair (rendered as steps) going down and out from the threshold; its own frame: +z outward
    // on a steep bank the ground keeps falling: re-measure at the foot of the flight until it lands
    let run = Math.max(0.9, bestGap / 0.62);
    for (let it = 0; it < 4; it++) {
      const ox = lx + nx * side * (run + 0.4), oz = lz + nz * side * (run + 0.4), wx = st.x + ox * c + oz * s, wz = st.z - ox * s + oz * c;
      if (!(wx > 2 && wz > 2 && wx < MAP_SIZE - 2 && wz < MAP_SIZE - 2)) break;
      bestGap = Math.max(bestGap, floorY - ctx.hf.at(wx, wz)); run = Math.max(0.9, bestGap / 0.62);
    }
    if (bestGap > 8) continue;
    const hw = Math.max(0.7, d.w / 2 + 0.35);
    const sb = new Builder();
    sb.ramp(-hw, -bestGap, 0, hw, 0, run, 1, -1, Mat.Concrete, 0x9a968f);
    sb.box(-hw, -bestGap - 1, 0, hw, -bestGap + 0.02, run, Mat.Concrete, { color: 0x8a8680, noCollide: true }); // footing
    const ang = st.angle + d.angle + (side > 0 ? 0 : Math.PI); // the stair's +z = the door's outward face
    const wx = st.x + lx * c + lz * s, wz = st.z - lx * s + lz * c;
    ctx.place(sb, 'steps', wx, wz, ang, { y: floorY, flatten: false, mark: false });
  }
}

/** Archetype for one footprint rectangle (w = front, d = depth), never asking a builder for a size it can't do. */
function buildingFor(rng: Rng, dist: District, w: number, d: number, area: number, seed: number): { b: Builder; kind: string; style: number; lod: number } | null {
  if (w < 3 || d < 3) return null;
  // kiosks, sheds, garages, guard huts
  if (w * d < 28 || Math.min(w, d) < 4.5) {
    const st = styleFor(rng, 'house'), b = new Builder(), h = rng.range(2.6, 3.2);
    b.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, st.wall, { color: st.wallColor });
    b.box(-w / 2 - 0.2, h, -d / 2 - 0.2, w / 2 + 0.2, h + 0.2, d / 2 + 0.2, Mat.Roof, { color: 0x4a4f55 });
    return { b, kind: 'shed', style: 0, lod: st.wallColor };
  }
  const big = w * d, lean = Math.max(w, d) / Math.min(w, d);
  const ok = (minW: number, minD: number) => w >= minW && d >= minD;
  if (dist === 'downtown') {
    if (area > 900 && ok(15, 12)) { const st = styleFor(rng, 'tower'); return { b: block2020(rng, w, d, st, { kind: 'tower', floors: 6 + Math.floor(seed * 5), glass: true }), kind: 'tower', style: 2, lod: st.wallColor }; }
    if (big > 150 && ok(12, 9)) { const st = styleFor(rng, 'block'); return { b: block2020(rng, w, d, st, { kind: 'panel', floors: 4 + Math.floor(seed * 4) }), kind: 'block', style: 1, lod: st.wallColor }; }
    const st = styleFor(rng, 'shop'); return { b: shop(rng, w, d, st), kind: 'shop', style: 3, lod: st.wallColor };
  }
  if (dist === 'urban') {
    if (w >= 34 && d >= 9 && d <= 15 && lean > 2.4) { const st = styleFor(rng, 'block'); return { b: tenement2020(rng, w, d, st), kind: 'tenement', style: 1, lod: st.wallColor }; }
    if (big > 280 && ok(12, 9)) { const st = styleFor(rng, 'block'); return { b: block2020(rng, w, d, st, { kind: 'panel', floors: 3 + Math.floor(seed * 3) }), kind: 'block', style: 1, lod: st.wallColor }; }
    if (big > 110 && ok(10, 8)) { const st = styleFor(rng, seed < 0.5 ? 'shop' : 'block'); return seed < 0.5 ? { b: shop(rng, w, d, st), kind: 'shop', style: 3, lod: st.wallColor } : { b: block2020(rng, w, d, st, { kind: 'walkup', floors: 2 + Math.floor(seed * 2) }), kind: 'block', style: 1, lod: st.wallColor }; }
    const st = styleFor(rng, 'house'); return { b: house(rng, w, d, 2, st), kind: 'house', style: 0, lod: st.wallColor };
  }
  if (dist === 'industrial' || dist === 'airport') {
    if (big > 220) { const st = styleFor(rng, 'industrial'); return { b: warehouse(rng, w, d, big > 600 ? 9 : 7, st), kind: 'warehouse', style: 4, lod: st.wallColor }; }
    if (big > 90) { const st = styleFor(rng, 'industrial'); return { b: warehouse(rng, w, d, 5, st), kind: 'warehouse', style: 4, lod: st.wallColor }; }
    const st = styleFor(rng, 'house'); return { b: shop(rng, w, d, st), kind: 'shop', style: 3, lod: st.wallColor };
  }
  if (dist === 'military') {
    const st: Style = { wall: Mat.Concrete, wallColor: rng.pick([0x8c8a78, 0x7d806e, 0x9a947e]), trim: 0, roof: Mat.Roof, roofColor: 0x4f5446 };
    if (big > 300) return { b: warehouse(rng, w, d, 8, st, { hangar: seed < 0.5 }), kind: 'hangar', style: 4, lod: st.wallColor };
    return { b: apartment(rng, w, d, 2, st), kind: 'barracks', style: 1, lod: st.wallColor };
  }
  // suburbs and countryside: houses; big plain sheds are barns, mid-size blocks walk-ups
  const st = styleFor(rng, 'house');
  if (dist === 'suburb' && big > 230 && ok(12, 9) && lean < 2.2) { const s2 = styleFor(rng, 'block'); return { b: block2020(rng, w, d, s2, { kind: 'walkup', floors: 2 + Math.floor(seed * 2) }), kind: 'block', style: 1, lod: s2.wallColor }; }
  if (big > 230 || (big > 170 && lean > 2.2)) { const s2 = styleFor(rng, 'industrial'); return { b: warehouse(rng, w, d, 6, s2), kind: 'barn', style: 4, lod: s2.wallColor }; }
  return { b: house(rng, w, d, big > 85 && seed < 0.6 ? 2 : 1, st), kind: 'house', style: 0, lod: st.wallColor };
}

/** Round footprints: storage tanks / silos (steel cylinder with a ladder-free conical top). */
function placeTank(ctx: GenContext, x: number, z: number, r: number) {
  const b = new Builder(), h = r > 4 ? r * 1.4 : r * 3;
  b.box(-r, 0, -r, r, h, r, Mat.Metal, { color: 0x9aa0a4, shape: 'cyl' });
  b.box(-r * 0.85, h, -r * 0.85, r * 0.85, h + r * 0.35, r * 0.85, Mat.Metal, { color: 0x8a9094, shape: 'cyl' });
  ctx.place(b, 'tank', x, z, 0, { pad: 0.5 });
}

/** Angle so a building faces the nearest road (null when no road nearby). */
function roadDirectionField(masks: MapMasks) {
  return (x: number, z: number): number | null => {
    // gradient of road density: points towards the road
    const R = 24;
    let gx = 0, gz = 0, tot = 0;
    for (let dz = -R; dz <= R; dz += 3) for (let dx = -R; dx <= R; dx += 3) {
      if (dx * dx + dz * dz > R * R) continue;
      if (masks.has(x + dx, z + dz, M_ROAD)) { gx += dx; gz += dz; tot++; }
    }
    if (tot < 3) return null;
    const a = Math.atan2(gz, gx);
    // local frame: building front (-z local) should face the road: world dir of local -z = (-sin, -cos)
    // want (-sin(ang), -cos(ang)) ~ (cos a, sin a) -> ang = atan2(-cos a, -sin a)
    return Math.atan2(-Math.cos(a), -Math.sin(a));
  };
}

function placeProps(ctx: GenContext, roadField: (x: number, z: number) => number | null) {
  const { rng, masks, hf, occ, col } = ctx;
  let n = 0;
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(100, MAP_SIZE - 100), z = rng.range(100, MAP_SIZE - 150);
    if (!masks.has(x, z, M_ROAD) || !inPlayable(x, z)) continue;
    // cars sit at road edge: step away from road centre
    const a = roadField(x, z); if (a === null) continue;
    const y = hf.at(x, z);
    if (y < 0.5) continue;
    const b = new Builder();
    const kind = rng.next();
    if (kind < 0.7) {
      // wrecked car: body + cabin (2020 Verdansk streets are full of burnt-out cars)
      const col2 = rng.pick([0x3a3634, 0x4b3f36, 0x5a5048, 0x6b2e22, 0x2f3b4a, 0x7a7a70, 0x8a6a2a]);
      b.box(-2.1, 0.25, -0.9, 2.1, 1.0, 0.9, Mat.Metal, { color: col2 });
      b.box(-1.1, 1.0, -0.8, 1.0, 1.55, 0.8, Mat.Metal, { color: col2 });
      b.box(-1.9, 0, -0.95, -1.2, 0.6, 0.95, Mat.Dark, { color: 0x1a1a1a, noCollide: true });
      b.box(1.2, 0, -0.95, 1.9, 0.6, 0.95, Mat.Dark, { color: 0x1a1a1a, noCollide: true });
    } else if (kind < 0.85) {
      for (let k = 0; k < 3; k++) b.box(-3 + k * 2.05, 0, -0.3, -1.05 + k * 2.05, 0.9, 0.3, Mat.Concrete, { color: 0xb0aca4 }); // jersey barriers
    } else {
      const c = rng.pick([0x8a2b20, 0x2b5a8a, 0x2d6a3a, 0xa87a20, 0x6a6a6a, 0x5a3a6a]);
      b.box(-3, 0, -1.25, 3, 2.6, 1.25, Mat.Container, { color: c });
    }
    const ang = (a ?? 0) + Math.PI / 2 + (rng.next() - 0.5) * 0.5;
    if (!occ.free(x, z, ang, 5, 3, 0, true)) continue;
    const st = makeStructure(0, 'prop', x, y - 0.05, z, ang, b.parts);
    col.add(st); occ.mark(x, z, ang, 5, 3, 0.5, 4); n++;
  }
  return n;
}

/** Value noise in [0, 1] with smooth interpolation between hashed lattice points `cell` metres apart. */
function smoothNoise(x: number, z: number, cell: number, seed: number) {
  const fx = x / cell, fz = z / cell, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function placeTrees(ctx: GenContext): Tree[] {
  const { rng, hf, occ, extra, masks } = ctx;
  const trees: Tree[] = [];
  const N = 26000;
  for (let i = 0; i < N; i++) {
    const x = rng.range(0, MAP_SIZE), z = rng.range(0, MAP_SIZE);
    const y = hf.at(x, z);
    if (y < 1.5) continue;
    if (occ.at(x, z) !== 0) continue;
    if (masks.has(x, z, M_BUILT)) continue;
    const k = Math.round(z / hf.step) * hf.res + Math.round(x / hf.step);
    if (extra.road[k] > 0.1 || extra.river[k]) continue;
    // forest density: clumps via noise; denser in the hills and on the rim
    // smooth, domain-warped noise (the old per-cell hash made square forest patches)
    const wx = x + (smoothNoise(x, z, 140, 11) - 0.5) * 90, wz = z + (smoothNoise(x, z, 140, 13) - 0.5) * 90;
    const n = clamp((smoothNoise(wx, wz, 75, 3) * 0.6 + smoothNoise(wx, wz, 26, 5) * 0.3 + smoothNoise(x, z, 9, 7) * 0.1 - 0.5) * 1.9 + 0.5, 0, 1); // stretched back to the old spread
    const { d } = districtAt(x, z);
    const base = d === 'rural' ? 0.55 : d === 'suburb' ? 0.5 : d === 'downtown' ? 0.12 : 0.3;
    const nearMountain = clamp((y - 60) / 120, 0, 1);
    if (n < 1 - base - nearMountain * 0.2) continue;
    const slope = 1 - hf.normal(x, z)[1];
    if (slope > 0.35) continue;
    const kind: 0 | 1 | 2 = rng.chance(0.18) ? 2 : (z < 1500 || rng.chance(0.55)) ? 0 : 1;
    const s = kind === 2 ? rng.range(0.7, 1.4) : rng.range(0.8, 1.35);
    trees.push({ x, y, z, s, kind });
    if (kind !== 2 && inPlayable(x, z)) {
      // trunk collider
      const st = makeStructure(0, 'tree', x, y, z, 0, [{ x0: -0.25 * s, y0: 0, z0: -0.25 * s, x1: 0.25 * s, y1: 6 * s, z1: 0.25 * s, mat: Mat.Wood }]);
      ctx.col.add(st);
      occ.mark(x, z, 0, 1, 1, 0.5, 5);
    }
  }
  return trees;
}

export { riverQuery };
export type { Part };

function placeStreetFurniture(ctx: GenContext) {
  const { rng, masks, hf, occ, col } = ctx;
  // lamps: sample road-edge points in built-up districts
  let lamps = 0;
  for (let i = 0; i < 30000 && lamps < 900; i++) {
    const x = rng.range(100, MAP_SIZE - 100), z = rng.range(100, MAP_SIZE - 150);
    if (masks.has(x, z, M_ROAD)) continue;
    const dens = masks.density(x, z, 4, M_ROAD);
    if (dens < 0.25 || dens > 0.6) continue;
    const { d } = districtAt(x, z);
    if (d === 'rural' || d === 'military') continue;
    if ((occ.at(x, z) !== 0 && occ.at(x, z) !== 3) || !inPlayable(x, z)) continue;
    const y = hf.at(x, z); if (y < 1) continue;
    const b = new Builder();
    b.box(-0.09, 0, -0.09, 0.09, 7.5, 0.09, Mat.Metal, { color: 0x5a5e62 });
    b.box(-0.06, 7.3, -0.06, 1.6, 7.45, 0.06, Mat.Metal, { color: 0x5a5e62, noCollide: true });
    b.box(1.2, 7.1, -0.15, 1.8, 7.3, 0.15, Mat.Trim, { color: 0xe8e4d0, noCollide: true });
    const ang = rng.range(0, Math.PI * 2);
    col.add(makeStructure(0, 'lamp', x, y, z, ang, b.parts));
    occ.mark(x, z, 0, 1, 1, 1, 4); lamps++;
  }
  // power poles along the main roads (rural stretches)
  for (const r of VERDANSK.roads) {
    let carry = 0, prev: [number, number, number] | null = null;
    for (let s = 0; s < r.pts.length - 1; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
      const L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let t = carry; t < L; t += 55) {
        const x = ax + ((bx - ax) * t) / L + nx * 11, z = az + ((bz - az) * t) / L + nz * 11;
        const { d } = districtAt(x, z);
        if (d !== 'rural' && d !== 'suburb' || !inPlayable(x, z) || occ.at(x, z) !== 0 && occ.at(x, z) < 4) { prev = null; continue; }
        const y = hf.at(x, z); if (y < 1) { prev = null; continue; }
        const b = new Builder();
        b.box(-0.14, 0, -0.14, 0.14, 9, 0.14, Mat.Wood, { color: 0x5a4632 });
        b.box(-1.2, 8.2, -0.08, 1.2, 8.4, 0.08, Mat.Wood, { color: 0x5a4632, noCollide: true });
        const ang = Math.atan2(-(bz - az), bx - ax) + Math.PI / 2;
        if (prev) {
          // sagging wires to the previous pole (rendered as line segments)
          const [px, py, pz] = prev, c = Math.cos(ang), sn = Math.sin(ang);
          for (const off of [-1, 1]) {
            const ax2 = x + off * c, az2 = z - off * sn, bx2 = px + off * c, bz2 = pz - off * sn;
            const segs = 8;
            for (let k = 0; k < segs; k++) {
              const t0 = k / segs, t1 = (k + 1) / segs, sag = (tt: number) => -Math.sin(Math.PI * tt) * 1.3;
              ctx.wires.push(ax2 + (bx2 - ax2) * t0, y + 8.35 + (py - y) * t0 + sag(t0), az2 + (bz2 - az2) * t0, ax2 + (bx2 - ax2) * t1, y + 8.35 + (py - y) * t1 + sag(t1), az2 + (bz2 - az2) * t1);
            }
          }
        }
        col.add(makeStructure(0, 'pole', x, y, z, ang, b.parts));
        prev = [x, y, z];
      }
      carry = 0;
    }
  }
}
