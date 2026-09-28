/**
 * Populates Verdansk: hand-built landmarks first, then procedural buildings wherever the traced
 * tac-map shows built-up ground (oriented to the nearest roads, styled by district), then trees,
 * wrecks and cover. Also flattens the terrain under every footprint.
 */
import { Rng, hash2 } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import { CollisionWorld, Heightfield, makeStructure, Mat, Structure, Part } from './collision';
import { Builder, house, apartment, tower, warehouse, shop, garageRow, Style } from './builder';
import { MapMasks, MAP_SIZE, M_BUILT, M_ROAD, M_SNOW, POIS, Poi } from './mapdata';
import { buildTerrain, riverQuery, TerrainExtras, waterSurfaceAt } from './terrain';
import { buildLandmarks } from './landmarks';

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

const PALETTE = {
  plaster: [0xd9cfbd, 0xc9bda6, 0xb8b2a4, 0xd4c7a1, 0xa9b3a8, 0xc4a98c, 0xe0dcd0, 0x9fa7ad],
  brick: [0x8c5a44, 0x9a6a50, 0x7a4c3a, 0xa87c62],
  concrete: [0xa39e96, 0x8f8b84, 0xb2ada4, 0x7f8084, 0x9a968c],
  metal: [0x7c8286, 0x6f7a74, 0x8a7f70, 0x5f6b72, 0x9a9588],
  roof: [0x8a6a5a, 0x7a5a48, 0x6a7078, 0x9a7a62, 0x80858a, 0x9a5a44, 0x6e6a64],
};

function styleFor(rng: Rng, kind: 'house' | 'block' | 'tower' | 'industrial' | 'shop'): Style {
  switch (kind) {
    case 'house': { const brick = rng.chance(0.3); return { wall: brick ? Mat.Brick : Mat.Plaster, wallColor: rng.pick(brick ? PALETTE.brick : PALETTE.plaster), trim: 0xe8e4dc, roof: Mat.Roof, roofColor: rng.pick(PALETTE.roof) }; }
    case 'block': return { wall: Mat.Concrete, wallColor: rng.pick([...PALETTE.concrete, ...PALETTE.plaster.slice(0, 4)]), trim: 0xcccccc, roof: Mat.Roof, roofColor: 0x9a9c9e };
    case 'tower': return { wall: Mat.Concrete, wallColor: rng.pick([0xb8b4aa, 0x9ea4a8, 0x8e8a82, 0xc2bcae, 0x7a8288]), trim: 0xcccccc, roof: Mat.Roof, roofColor: 0x8e9194 };
    case 'industrial': return { wall: Mat.Metal, wallColor: rng.pick(PALETTE.metal), trim: 0x999999, roof: Mat.Roof, roofColor: 0x9a9ea2 };
    case 'shop': return { wall: Mat.Plaster, wallColor: rng.pick(PALETTE.plaster), trim: 0xffffff, roof: Mat.Roof, roofColor: 0x8e9194 };
  }
}

export interface Tree { x: number; y: number; z: number; s: number; kind: 0 | 1 | 2 } // 0 pine, 1 birch/leafy, 2 bush
/** A hinged door: its collision structure and closed angle. */
export interface DoorRec { sid: number; base: number; w: number; h: number }
/** An exterior ladder in world space: base on the wall face, outward normal, bottom and roof heights. */
export interface LadderRec { x: number; z: number; nx: number; nz: number; y0: number; y1: number }
export interface WorldData {
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
  /** Codes: 0 free, 1 building, 2 road, 3 river/sea/road splat, 4 prop, 5 tree. `roadOk` lets props sit on roads. */
  free(cx: number, cz: number, a: number, w: number, d: number, pad = 0, roadOk = false) { return this.forRect(cx, cz, a, w, d, pad, (i) => this.g[i] === 0 || (roadOk && (this.g[i] === 2 || this.g[i] === 3))); }
  mark(cx: number, cz: number, a: number, w: number, d: number, pad = 0, v = 1) { this.forRect(cx, cz, a, w, d, pad, (i) => { this.g[i] = Math.max(this.g[i], v); }); }
  markCircle(cx: number, cz: number, r: number, v = 1) { for (let z = cz - r; z <= cz + r; z += this.cell) for (let x = cx - r; x <= cx + r; x += this.cell) { if ((x - cx) ** 2 + (z - cz) ** 2 > r * r) continue; const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell); if (i >= 0 && j >= 0 && i < this.res && j < this.res) this.g[j * this.res + i] = Math.max(this.g[j * this.res + i], v); } }
  at(x: number, z: number) { const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell); return i < 0 || j < 0 || i >= this.res || j >= this.res ? 255 : this.g[j * this.res + i]; }
}

export interface GenContext {
  rng: Rng; hf: Heightfield; extra: TerrainExtras; masks: MapMasks; col: CollisionWorld; occ: Occupancy;
  /** Place a builder as a structure at world pos with rotation; flattens terrain under it. */
  place(b: Builder, kind: string, x: number, z: number, angle: number, opts?: { y?: number; flatten?: boolean; pad?: number; poi?: string; style?: number; lodColor?: number; mark?: boolean }): Structure;
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
    if (extra.river[k] || hf.h[k] < 0.3 || extra.road[k] > 0.35) occ.g[j * occ.res + i] = 3;
  }
  // the freight line and a margin either side are off-limits too
  { const rp = extra.railPath; for (let i = 0; i < rp.length; i += 3) { const x = rp[i], z = rp[i + 2]; for (let dz = -8; dz <= 8; dz += occ.cell) for (let dx = -8; dx <= 8; dx += occ.cell) { const oi = Math.floor((x + dx) / occ.cell), oj = Math.floor((z + dz) / occ.cell); if (oi >= 0 && oj >= 0 && oi < occ.res && oj < occ.res) occ.g[oj * occ.res + oi] = 3; } } }
  const doors: DoorRec[] = [];
  const ladders: LadderRec[] = [];
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
      if (y === undefined) { const fh = ctx.footprintHeights(wx, wz, angle, w, d); y = fh.max; }
      if (opts.flatten !== false) ctx.flatten(wx, wz, angle, w, d, y - 0.15, 4);
      if (opts.mark !== false) occ.mark(wx, wz, angle, w, d, opts.pad ?? 1.5, 1);
      const st = makeStructure(0, kind, x, y, z, angle, b.parts, b.ramps, b.loot);
      st.poi = opts.poi; st.style = opts.style; st.lodColor = opts.lodColor;
      const added = col.add(st);
      for (const l of (b as any).ladders ?? []) {
        const lx = x + l.x * c + l.z * s, lz = z - l.x * s + l.z * c, nx = l.nx * c + l.nz * s, nz = -l.nx * s + l.nz * c;
        ladders.push({ x: lx, z: lz, nx, nz, y0: y + l.y0, y1: y + l.y1 });
      }
      // hinged door leaves: each its own small structure pivoting on its hinge
      for (const d of (b as any).doors ?? []) {
        const hx = x + d.x * c + d.z * s, hz = z - d.x * s + d.z * c, a = angle + d.angle;
        const ds = makeStructure(0, 'door', hx, y + d.y, hz, a, [{ x0: 0, y0: 0, z0: -0.025, x1: d.w, y1: d.h, z1: 0.025, mat: Mat.Wood, color: 0x6b5238 }]);
        col.add(ds); doors.push({ sid: ds.id, base: a, w: d.w, h: d.h });
      }
      return added;
    },
  };

  // 1) landmarks (hand-built POI centrepieces)
  buildLandmarks(ctx);

  // 2) procedural buildings on built-up ground
  const roadField = roadDirectionField(masks);
  const cands: [number, number][] = [];
  for (let z = 30; z < MAP_SIZE - 30; z += 5) for (let x = 30; x < MAP_SIZE - 30; x += 5) {
    if (masks.density(x, z, 3, M_BUILT) > 0.34) cands.push([x + (hash2(x, z, 7) - 0.5) * 3, z + (hash2(x, z, 9) - 0.5) * 3]);
  }
  // shuffle deterministically, but bias big-building districts first
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  let placed = 0;
  // largest footprints first, so big blocks claim the ground before houses fill the gaps
  for (let pass = 0; pass < 4; pass++) for (const [x, z] of cands) {
    if (occ.at(x, z) !== 0) continue;
    const { d: dist, poi } = districtAt(x, z);
    const sizes = sizeOptions(dist, rng);
    if (pass >= sizes.length) continue;
    const snowy = z < 1400 && masks.density(x, z, 12, M_SNOW) > 0.12;
    // the tac map's north is noisy (rock highlights read as buildings): only trust it near roads or POIs
    if (z < 1350 && (dist === 'rural' || !poi) && (roadField(x, z) === null || masks.density(x, z, 6, M_BUILT) < 0.55)) continue;
    const minBuilt = snowy ? 0.8 : z < 1350 && dist === 'rural' ? 0.7 : dist === 'downtown' ? 0.36 : 0.42;
    const ang = roadField(x, z) ?? (poi ? hash2(poi.x | 0, poi.z | 0) * Math.PI : rng.range(0, Math.PI));
    const [w, d] = sizes[pass];
    if (!occ.free(x, z, ang, w, d, 1.2)) continue;
    let built = 0, n = 0;
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let v = -d / 2; v <= d / 2; v += 3) for (let u = -w / 2; u <= w / 2; u += 3) { n++; if (masks.has(x + u * c + v * s, z - u * s + v * c, M_BUILT)) built++; }
    if (built / n < minBuilt) continue;
    const fh = ctx.footprintHeights(x, z, ang, w, d);
    if (fh.max - fh.min > Math.max(3.5, Math.min(w, d) * 0.25)) continue;
    const bb = makeBuilding(rng, dist, w, d, x, z);
    if (!bb) continue;
    ctx.place(bb.b, bb.kind, x, z, ang, { poi: poi?.id, style: bb.style, lodColor: bb.lod });
    placed++;
  }

  // 3) scattered rural houses/sheds where the map is empty but near roads (Verdansk countryside)
  for (let i = 0; i < 700; i++) {
    const x = rng.range(150, MAP_SIZE - 150), z = rng.range(1250, MAP_SIZE - 300);
    if (occ.at(x, z) !== 0) continue;
    const { d: dist } = districtAt(x, z);
    if (dist !== 'rural' && dist !== 'suburb') continue;
    if (masks.density(x, z, 15, M_SNOW) > 0.1) continue;
    const ang = roadField(x, z); if (ang === null) continue;
    if (hf.at(x, z) < 2 || hf.at(x, z) > 150) continue;
    const w = rng.range(7, 11), d = rng.range(6, 9);
    if (!occ.free(x, z, ang, w, d, 2)) continue;
    const fh = ctx.footprintHeights(x, z, ang, w, d); if (fh.max - fh.min > 3) continue;
    if (!inPlayable(x, z)) continue;
    ctx.place(house(rng, w, d, rng.chance(0.3) ? 2 : 1, styleFor(rng, 'house')), 'house', x, z, ang, { style: 0 });
    placed++;
  }

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
  col.finalize();
  void placed; void props;
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
  return { doors, ladders, hf, extra, col, trees, masks, buyStations: ctx.buyStations, chests: ctx.chests, contracts: ctx.contracts, groundLoot: groundLoot.filter((g) => !ctx.chests.includes(g as any)), vehicleSpawns: ctx.vehicleSpawns, wires: Float32Array.from(ctx.wires), balloons: ctx.balloons };
}

import { VERDANSK } from '../data/verdansk';
import { pointInPoly } from '../core/math';
const PLAY = VERDANSK.playable as unknown as [number, number][];
export function inPlayable(x: number, z: number) { return pointInPoly(x, z, PLAY); }

function sizeOptions(d: District, rng: Rng): [number, number][] {
  const r = (a: number, b: number) => rng.range(a, b);
  switch (d) {
    case 'downtown': return [[r(36, 52), r(13, 16)], [r(24, 34), r(12, 15)], [r(14, 20), r(11, 14)], [r(9, 13), r(8, 11)]];
    case 'urban': return [[r(30, 44), r(11, 13)], [r(18, 26), r(10, 13)], [r(12, 16), r(9, 12)], [r(8, 11), r(7, 10)]];
    case 'industrial': return [[r(34, 50), r(20, 28)], [r(22, 32), r(14, 20)], [r(12, 18), r(9, 14)], [r(8, 11), r(6, 9)]];
    case 'military': return [[r(30, 40), r(12, 16)], [r(18, 26), r(10, 12)], [r(9, 13), r(7, 10)]];
    case 'airport': return [[r(36, 50), r(22, 30)], [r(20, 28), r(12, 18)], [r(10, 14), r(8, 11)]];
    default: return [[r(10, 13), r(8, 11)], [r(8, 10), r(7, 9)], [r(6, 8), r(5, 7)]];
  }
}

function makeBuilding(rng: Rng, d: District, w: number, dd: number, x: number, z: number): { b: Builder; kind: string; style: number; lod: number } | null {
  const big = w * dd;
  if (d === 'downtown') {
    if (big > 380) { const st = styleFor(rng, 'tower'); return { b: tower(rng, w, dd, rng.int(5, 9), st), kind: 'tower', style: 2, lod: st.wallColor }; }
    if (big > 150) { const st = styleFor(rng, 'block'); return { b: apartment(rng, w, dd, rng.int(3, 6), st, { groundShop: rng.chance(0.5) }), kind: 'block', style: 1, lod: st.wallColor }; }
    const st = styleFor(rng, 'shop'); return { b: shop(rng, w, dd, st), kind: 'shop', style: 3, lod: st.wallColor };
  }
  if (d === 'urban') {
    if (big > 280) { const st = styleFor(rng, 'block'); return { b: apartment(rng, w, dd, rng.int(3, 5), st, { groundShop: rng.chance(0.3) }), kind: 'block', style: 1, lod: st.wallColor }; }
    if (big > 110) { const st = styleFor(rng, rng.chance(0.5) ? 'shop' : 'block'); return rng.chance(0.5) ? { b: apartment(rng, w, dd, 2, st), kind: 'block', style: 1, lod: st.wallColor } : { b: shop(rng, w, dd, st), kind: 'shop', style: 3, lod: st.wallColor }; }
    const st = styleFor(rng, 'house'); return { b: house(rng, w, dd, 2, st), kind: 'house', style: 0, lod: st.wallColor };
  }
  if (d === 'industrial' || d === 'airport') {
    if (big > 220) { const st = styleFor(rng, 'industrial'); return { b: warehouse(rng, w, dd, rng.range(7, 10), st), kind: 'warehouse', style: 4, lod: st.wallColor }; }
    if (big > 90) { const st = styleFor(rng, 'industrial'); return { b: warehouse(rng, w, dd, 5, st), kind: 'warehouse', style: 4, lod: st.wallColor }; }
    const st = styleFor(rng, 'house'); return { b: shop(rng, w, dd, st), kind: 'shop', style: 3, lod: st.wallColor };
  }
  if (d === 'military') {
    const st: Style = { wall: Mat.Concrete, wallColor: rng.pick([0x8c8a78, 0x7d806e, 0x9a947e]), trim: 0, roof: Mat.Roof, roofColor: 0x4f5446 };
    if (big > 300) return { b: warehouse(rng, w, dd, 8, st, { hangar: rng.chance(0.5) }), kind: 'hangar', style: 4, lod: st.wallColor };
    return { b: apartment(rng, w, dd, 2, st), kind: 'barracks', style: 1, lod: st.wallColor };
  }
  const st = styleFor(rng, 'house');
  if (d === 'suburb' && big > 130 && rng.chance(0.5)) { const s2 = styleFor(rng, 'block'); return { b: apartment(rng, w, dd, rng.int(2, 3), s2), kind: 'block', style: 1, lod: s2.wallColor }; }
  if (big > 150) { const s2 = styleFor(rng, 'industrial'); return { b: warehouse(rng, w, dd, 6, s2), kind: 'barn', style: 4, lod: s2.wallColor }; }
  return { b: house(rng, w, dd, rng.chance(0.55) ? 2 : 1, st), kind: 'house', style: 0, lod: st.wallColor };
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
    const n = hash2(Math.floor(x / 60), Math.floor(z / 60), 3) * 0.6 + hash2(Math.floor(x / 23), Math.floor(z / 23), 5) * 0.4;
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
