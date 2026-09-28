/**
 * The whole Battle Royale, headless and deterministic: 150 players in trios, C-130 infil, gas
 * circles, loot, supply boxes, buy stations, contracts, downs/revives, Gulag, redeploys.
 * Humans and bots fill the same Intent and go through the same code.
 */
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import type { WorldData } from '../world/mapgen';
import { inPlayable } from '../world/mapgen';
import { MAP_SIZE, POIS } from '../world/mapdata';
import { GULAG_POS, GULAG_SPAWNS, GULAG_BALCONY_Z, GULAG_ARENAS, gulagArena } from '../world/landmarks';
import { WEAPON, AMMO_MAX, AmmoType } from '../data/weapons';
import { Train } from './train';
import { Doors } from './doors';
import { PLAYERS, SQUAD_SIZE, HEALTH, DEPLOY, DOWNED, GAS, CIRCLES, INITIAL_RADIUS, GULAG, PRICES, CONTRACT } from './config';
import { Bullet, Chest, emptyIntent, Explosion, Item, ItemKind, Phase, Player, SimEvent, Stance, Throwable } from './types';
import { movePlayer, eyeHeight } from './movement';
import { weaponTick, updateBullets, updateThrowables, throwItem, aimDir } from './combat';
import { randomItem, chestContents, tryPickup, dropBag, magSize } from './loot';
import { BotBrain, botThink } from './bots';
import { Mat, RayHit, makeStructure } from '../world/collision';
import type { BuyId } from '../data/buy';
import { Vehicle, VehicleType, VEHICLES, makeVehicle, updateVehicles, enterVehicle, exitVehicle, vehicleOf } from './vehicles';
import { M_ROAD } from '../world/mapdata';
import { NavGrid } from './nav';

export interface CircleState { phase: number; closing: boolean; t: number; cx: number; cz: number; r: number; nx: number; nz: number; nr: number; sx: number; sz: number; sr: number; done: boolean }
export interface Contract { id: number; kind: 'bounty' | 'scavenger' | 'recon'; x: number; y: number; z: number; taken: boolean }
export interface ActiveContract { kind: Contract['kind']; squad: number; t: number; target?: number; step?: number; chest?: number; zx?: number; zz?: number; zy?: number; progress?: number }
export interface GulagFight { arena: number; a: number; b: number; t: number; flagT: number; flagOwner: number; overtime: boolean }
export interface BuyStation { id: number; x: number; y: number; z: number }
export interface LoadoutCrate { id: number; squad: number; x: number; y: number; z: number; land: number; taken: Set<number> }

const NAMES = ['Ghost', 'Price', 'Gaz', 'Nikolai', 'Farah', 'Alex', 'Mace', 'Zane', 'Krueger', 'Grinch', 'Azur', 'Bale', 'Raines', 'Otter', 'Charly', 'Wyatt', 'Talon', 'Minotaur', 'Iskra', 'Mara', 'Ronin', 'Syd', 'Domino', 'Wolf', 'Rook', 'Nomad', 'Viper', 'Hawk', 'Bishop', 'Kilo', 'Echo', 'Sierra', 'Reaper', 'Havoc', 'Blaze', 'Frost', 'Shadow', 'Spectre', 'Jackal', 'Cobra', 'Onyx', 'Banshee', 'Dagger', 'Rogue', 'Maverick', 'Striker', 'Titan', 'Ember', 'Venom', 'Warden'];

/** Counter UAV jamming radius (m) */
export const COUNTER_UAV_R = 400;

export class Sim {
  rng: Rng;
  time = 0;
  players: Player[] = [];
  items: Item[] = [];
  chests: Chest[] = [];
  train: Train | null = null;
  doors: Doors | null = null;
  private ladderGrid = new Map<number, number[]>();
  private ladderOut: number[] = [];
  laddersNear(x: number, z: number): number[] {
    const o = this.ladderOut; o.length = 0;
    const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = this.ladderGrid.get((cx + i) * 4096 + cz + j); if (a) for (const v of a) o.push(v); }
    return o;
  }
  private doorTmp: any[] = [];
  bullets: Bullet[] = [];
  throwables: Throwable[] = [];
  fires: { x: number; y: number; z: number; r: number; t: number; owner: number }[] = [];
  smokes: { x: number; y: number; z: number; t: number }[] = [];
  pending: Explosion[] = [];
  events: SimEvent[] = [];
  nextId = 1;
  localId = 0;
  plane = { x: 0, y: 0, z: 0, dx: 1, dz: 0, t: 0, dur: 0, sx: 0, sz: 0, canJump: false, active: true };
  circle: CircleState;
  gulag = { fights: [] as GulagFight[], queue: [] as number[], closed: false, idle: 0 };
  buyStations: BuyStation[] = [];
  contracts: Contract[] = [];
  active: ActiveContract[] = [];
  crates: LoadoutCrate[] = [];
  brains: BotBrain[] = [];
  vehicles: Vehicle[] = [];
  boxes: { id: number; kind: 'munitions' | 'armorBox'; x: number; y: number; z: number; squad: number; used: Set<number>; until: number }[] = [];
  turrets: { id: number; x: number; y: number; z: number; yaw: number; squad: number; user: number; health: number; struct: number }[] = [];
  nav: NavGrid;
  aliveCount = PLAYERS;
  over = false; winner = -1;
  squadUav = new Map<number, { until: number; x: number; z: number }>();
  /** active Counter UAVs: enemies within COUNTER_UAV_R have their minimap scrambled */
  counterUavs: { squad: number; x: number; z: number; until: number }[] = [];
  /** enemy pings ("enemy spotted"): a red marker where the enemy was, shared with the squad for a few seconds */
  enemyPings: { squad: number; by: number; target: number; x: number; y: number; z: number; until: number }[] = [];
  squadReveal = new Set<number>(); // squads that see the next circle early (recon)
  placementCounter = 0;
  private itemGrid = new Map<number, Item[]>();
  itemById = new Map<number, Item>();
  private falling: Item[] = [];
  private pGrid = new Map<number, Player[]>();

  warmup = 0;
  /** 1 = Solos, 2 = Duos, 3 = Trios */
  squadSize = SQUAD_SIZE;
  constructor(public world: WorldData, seed = 1, opts: { humans?: number; players?: number; warmup?: number; squadSize?: number } = {}) {
    this.squadSize = opts.squadSize ?? SQUAD_SIZE;
    this.rng = new Rng(seed);
    this.nav = (world as any).__nav ?? ((world as any).__nav = new NavGrid(world.col));
    const n = opts.players ?? PLAYERS;
    for (let i = 0; i < n; i++) this.players.push(this.makePlayer(i, Math.floor(i / this.squadSize), i >= (opts.humans ?? 1)));
    this.players[0].name = 'You';
    this.brains = this.players.map((p) => new BotBrain(p.id, this.rng.next()));
    // plane path: a random chord through the map's middle third
    const a = this.rng.range(0, Math.PI * 2), c = MAP_SIZE / 2;
    const ox = c + this.rng.range(-400, 400), oz = c + this.rng.range(-300, 300);
    const dx = Math.cos(a), dz = Math.sin(a), L = 2400;
    this.plane.sx = ox - dx * L; this.plane.sz = oz - dz * L; this.plane.dx = dx; this.plane.dz = dz; this.plane.dur = (2 * L) / DEPLOY.planeSpeed;
    this.plane.x = this.plane.sx; this.plane.z = this.plane.sz; this.plane.y = DEPLOY.planeAlt;
    // loot
    for (const g of world.groundLoot) if (this.rng.chance(0.7)) this.addItem(randomItem(this, g.x, g.y, g.z));
    for (const ch of world.chests) this.chests.push({ id: this.nextId++, x: ch.x, y: ch.y, z: ch.z, opened: false, legendary: this.rng.chance(0.06) });
    this.doors = new Doors(this);
    // ladder lookup grid (32 m cells)
    (world.ladders ?? []).forEach((l, i) => { const k = Math.floor(l.x / 32) * 4096 + Math.floor(l.z / 32); const a = this.ladderGrid.get(k); if (a) a.push(i); else this.ladderGrid.set(k, [i]); });
    // the freight train, starting at a random point on its loop, with its loot caches
    world.col.dyn = world.col.dyn.filter((d) => d.kind !== 'train'); // the world object is shared between matches
    const rp = (world.extra as any).railPath as Float32Array | undefined;
    if (rp && rp.length > 30) {
      this.train = new Train(this, rp, this.rng.range(0, 1e5));
      for (const [ci, lx, lz, leg] of Train.CACHES) { const ch: any = { id: this.nextId++, x: 0, y: 0, z: 0, opened: false, legendary: leg, train: [ci, lx, lz] }; this.chests.push(ch); }
      this.train.update(0);
    }
    for (const b of world.buyStations) { const p = this.snapToFree(b.x, b.z); if (p) this.buyStations.push({ id: this.nextId++, ...p }); }
    for (const c2 of world.contracts) { const p = this.snapToFree(c2.x, c2.z); if (p) this.contracts.push({ id: this.nextId++, kind: this.rng.pick(['bounty', 'scavenger', 'recon'] as const), ...p, taken: false }); }
    this.spawnVehicles();
    // circle 0 = whole map; the first "next" circle is revealed immediately
    this.circle = { phase: 0, closing: false, t: CIRCLES[0].wait, cx: 1640, cz: 1780, r: INITIAL_RADIUS, nx: 0, nz: 0, nr: 0, sx: 0, sz: 0, sr: 0, done: false };
    this.pickNextCircle();
    this.warmup = opts.warmup ?? 0;
    if (this.warmup > 0) { this.plane.active = false; for (const p of this.players) this.warmupSpawn(p); }
  }

  get inWarmup() { return this.time < this.warmup; }
  /** Warm-up: drop straight onto Verdansk with a random gun; respawn on death. */
  private warmupSpawn(p: Player) {
    let x = 0, z = 0;
    for (let i = 0; i < 50; i++) { const q = POIS[this.rng.int(0, POIS.length - 1)]; x = q.x + this.rng.range(-q.r, q.r); z = q.z + this.rng.range(-q.r, q.r); if (this.world.hf.at(x, z) > 1 && inPlayable(x, z)) break; }
    const s = this.snapToFree(x, z) ?? { x, y: this.world.hf.at(x, z), z };
    p.x = p.px = s.x; p.z = p.pz = s.z; p.y = p.py = s.y + 0.1; p.vx = p.vy = p.vz = 0; p.fallStartY = p.y;
    p.phase = Phase.Alive; p.alive = true; p.health = 100; p.armor = 150; p.onGround = true; p.stance = Stance.Stand;
    const gun = this.rng.pick(['m4', 'kilo', 'grau', 'mp5', 'mp7', 'm13', 'aug', 'ram7']);
    p.weapons = [{ id: gun, rarity: 1, mag: magSize(gun, 1) }, { id: 'm1911', rarity: 0, mag: 8 }]; p.cur = 0;
    p.ammo = { heavy: 240, light: 240, sniper: 20, shotgun: 20, rocket: 0 };
    (p as any).respawnAt = undefined;
  }
  private endWarmup() {
    this.bullets.length = 0; this.throwables.length = 0; this.fires.length = 0; this.smokes.length = 0; this.pending.length = 0;
    for (const p of this.players) {
      if ((p as any).vehicle !== undefined) exitVehicle(this, p);
      Object.assign(p, { phase: Phase.Plane, alive: true, health: 100, armor: 0, plates: 0, kills: 0, damage: 0, cash: 0, lethal: null, tactical: null, killstreak: null, fieldUpgrade: null, selfRevive: false, hasMask: false, gasMask: 0, gulagUsed: false, stance: Stance.Stand, reloadT: 0, plateT: 0, swapT: 0, ads: 0, downT: 0, reviveBy: -1, killedBy: -1 });
      p.weapons = [{ id: 'x16', rarity: 0, mag: 13 }, null]; p.cur = 0; p.ammo = { heavy: 0, light: 30, sniper: 0, shotgun: 0, rocket: 0 };
      this.brains[p.id].target = -1; this.brains[p.id].goal = 'drop'; this.brains[p.id].dropX = 0;
    }
    for (const v of this.vehicles) v.seats = v.seats.map(() => -1);
    this.plane.active = true; this.plane.t = 0;
    this.aliveCount = this.players.length;
    this.emit({ t: 'announce', text: '__infil__' });
  }

  private spawnVehicles() {
    const kinds: VehicleType[] = [];
    for (let i = 0; i < 22; i++) kinds.push('atv');
    for (let i = 0; i < 12; i++) kinds.push('suv');
    for (let i = 0; i < 10; i++) kinds.push('rover');
    for (let i = 0; i < 6; i++) kinds.push('truck');
    const hf = this.world.hf, masks = this.world.masks;
    let tries = 0;
    for (const k of kinds) {
      while (tries++ < 20000) {
        const x = this.rng.range(250, MAP_SIZE - 250), z = this.rng.range(300, MAP_SIZE - 300);
        if (!masks.has(x, z, M_ROAD) || !inPlayable(x, z)) continue;
        const d = VEHICLES[k];
        if (!this.world.col.fits(x, hf.at(x, z) + 0.3, z, d.hgt, d.len * 0.55)) continue;
        if (this.vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 60)) continue;
        this.vehicles.push(makeVehicle(this.nextId++, k, x, hf.at(x, z), z, this.rng.range(0, Math.PI * 2)));
        break;
      }
    }
    // helicopters on open ground at a few POIs (airport apron, military base, stadium lot, TV station, port, farmland)
    for (const [x, z] of [[1060, 1335], [1620, 640], [2010, 1740], [1720, 1500], [2440, 2560], [2600, 2240], [700, 2320]] as [number, number][]) {
      const p = this.snapToFree(x, z); if (!p) continue;
      if (!this.world.col.fits(p.x, p.y + 0.3, p.z, 3, 5)) continue;
      this.vehicles.push(makeVehicle(this.nextId++, 'heli', p.x, p.y, p.z, this.rng.range(0, 6.28)));
    }
  }

  private makePlayer(id: number, squad: number, bot: boolean): Player {
    return {
      id, name: bot ? `${this.rng.pick(NAMES)}${this.rng.int(1, 99)}` : 'You', squad, bot,
      x: 0, y: DEPLOY.planeAlt, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, pyaw: 0, yaw: 0, pitch: 0,
      phase: Phase.Plane, onGround: false, groundY: 0, fallStartY: 0,
      stance: Stance.Stand, sprinting: false, tacSprint: 0, tacCooldown: 0, slideT: 0, slideCd: 0, slideDx: 0, slideDz: 0,
      swimming: false, mantleT: 0, mantleY: 0,
      health: 100, armor: 0, plates: 0, maxPlates: HEALTH.carry,
      weapons: [{ id: 'x16', rarity: 0, mag: 13 }, null], cur: 0,
      ammo: { heavy: 0, light: 30, sniper: 0, shotgun: 0, rocket: 0 },
      lethal: null, tactical: null, killstreak: null, fieldUpgrade: null, turret: -1, stash: null, selfRevive: false, gasMask: 0, hasMask: false,
      cash: 0, kills: 0, damage: 0,
      fireCd: 0, reloadT: 0, swapT: 0, plateT: 0, ads: 0, recoil: 0, recoilYaw: 0, bloom: 0, boltT: 0,
      lastHit: -99, lastDamaged: -99, stunT: 0, flashT: 0,
      downT: 0, reviveT: 0, reviveBy: -1,
      gulagUsed: false, deadAt: -1, killedBy: -1,
      interactT: 0, interactTarget: -1,
      intent: emptyIntent(), lastShot: -99, lastStep: 0, uavUntil: 0, bountyOn: 0, contractId: -1,
      alive: true, placement: 0, gulagSlot: -1, triggerHeld: false, stanceT: 0, sprintOut: 0, burstLeft: 0, meleeCd: 0, prevSprint: false, loadoutUsed: false, spectating: -1,
    };
  }

  emit(e: SimEvent) { this.events.push(e); }

  // ------------------------------------------------------------ spatial helpers
  private key(x: number, z: number, c: number) { return (Math.floor(z / c) + 64) * 4096 + Math.floor(x / c) + 64; }
  addItem(it: Item) { this.items.push(it); this.itemById.set(it.id, it); if (it.vy !== undefined) this.falling.push(it); const k = this.key(it.x, it.z, 8); let a = this.itemGrid.get(k); if (!a) this.itemGrid.set(k, (a = [])); a.push(it); return it; }
  removeItem(it: Item) { this.itemById.delete(it.id); const k = this.key(it.x, it.z, 8); const a = this.itemGrid.get(k); if (a) { const i = a.indexOf(it); if (i >= 0) a.splice(i, 1); } }
  itemsNear(x: number, z: number, r: number, out: Item[] = []): Item[] {
    out.length = 0;
    for (let cz = Math.floor((z - r) / 8); cz <= Math.floor((z + r) / 8); cz++) for (let cx = Math.floor((x - r) / 8); cx <= Math.floor((x + r) / 8); cx++) {
      const a = this.itemGrid.get((cz + 64) * 4096 + cx + 64); if (!a) continue;
      for (const it of a) if (it.alive && (it.x - x) ** 2 + (it.z - z) ** 2 <= r * r) out.push(it);
    }
    return out;
  }
  dropItem(it: Partial<Item>, x: number, y: number, z: number) {
    const g = this.world.col.groundAt(x, z, y + 1.5);
    return this.addItem({ id: this.nextId++, alive: true, x, y: g + 0.05, z, ...it } as Item);
  }
  private rebuildPlayerGrid() {
    this.pGrid.clear();
    for (const p of this.players) {
      if (!p.alive && p.phase !== Phase.Downed) continue;
      const k = this.key(p.x, p.z, 32); let a = this.pGrid.get(k); if (!a) this.pGrid.set(k, (a = [])); a.push(p);
    }
  }
  private pnBuf: Player[] = [];
  playersNear(x: number, z: number, r: number): Player[] {
    const out = this.pnBuf; out.length = 0;
    for (let cz = Math.floor((z - r) / 32); cz <= Math.floor((z + r) / 32); cz++) for (let cx = Math.floor((x - r) / 32); cx <= Math.floor((x + r) / 32); cx++) {
      const a = this.pGrid.get((cz + 64) * 4096 + cx + 64); if (!a) continue;
      for (const p of a) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= (r + 1) ** 2) out.push(p);
    }
    return out.slice();
  }
  /** Ground position near (x,z) that is outside buildings and on land. */
  snapToFree(x: number, z: number): { x: number; y: number; z: number } | null {
    const col = this.world.col;
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4, d = i * 1.5;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const g = this.world.hf.at(px, pz);
      if (g < 0.5 || col.waterAt(px, pz) > g) continue;
      const top = col.groundAt(px, pz, g + 200, 0.6);
      if (top > g + 0.3) continue; // under/in a structure
      if (!col.fits(px, g, pz, 2, 0.8)) continue;
      return { x: px, y: g, z: pz };
    }
    return null;
  }

  // ------------------------------------------------------------ main tick
  tick(dt: number) {
    if (this.over) { this.time += dt; return; }
    const wasWarm = this.inWarmup;
    this.time += dt;
    if (wasWarm && !this.inWarmup) this.endWarmup();
    if (this.inWarmup) for (const p of this.players) if ((p as any).respawnAt !== undefined && this.time >= (p as any).respawnAt) this.warmupSpawn(p);
    this.train?.update(dt);
    this.doors?.update(dt);
    this.rebuildPlayerGrid();
    this.updatePlane(dt);
    // bots think in staggered slices (10 Hz each)
    const slice = Math.floor(this.time * 60) % 6;
    for (const p of this.players) {
      if (!p.bot || (!p.alive && p.phase !== Phase.Downed)) continue;
      botThink(this, this.brains[p.id], p, dt, p.id % 6 === slice);
    }
    for (const p of this.players) {
      p.px = p.x; p.py = p.y; p.pz = p.z; p.pyaw = p.yaw;
      if (p.phase === Phase.Dead || p.phase === Phase.Spectate) continue;
      const veh = (p as any).vehicle !== undefined ? vehicleOf(this, p) : null;
      if (veh) { p.yaw = p.intent.yaw; p.pitch = clamp(p.intent.pitch, -1.5, 1.5); } else movePlayer(this, p, dt);
      if ((p.phase === Phase.Alive || p.phase === Phase.Gulag) && (!veh || (p as any).seat > 0)) weaponTick(this, p, dt);
      else { p.ads = 0; p.reloadT = 0; }
      this.playerUpkeep(p, dt);
    }
    updateVehicles(this, dt);
    updateBullets(this, dt);
    updateThrowables(this, dt);
    this.updateExplosions(dt);
    if (!this.inWarmup) { this.updateCircle(dt); this.updateGulag(dt); this.updateContracts(dt); }
    this.updateCrates(dt);
    this.settleItems(dt);
    if (!this.inWarmup) this.checkWin();
  }

  private updatePlane(dt: number) {
    const pl = this.plane;
    if (!pl.active) return;
    pl.t += dt;
    pl.x = pl.sx + pl.dx * DEPLOY.planeSpeed * pl.t; pl.z = pl.sz + pl.dz * DEPLOY.planeSpeed * pl.t;
    // doors open once over the island
    pl.canJump = pl.x > 80 && pl.z > 80 && pl.x < MAP_SIZE - 80 && pl.z < MAP_SIZE - 80;
    if (pl.t > pl.dur + 30) pl.active = false;
  }

  private playerUpkeep(p: Player, dt: number) {
    const it = p.intent;
    // regen
    if (p.phase === Phase.Alive || p.phase === Phase.Gulag) {
      // stim: skips the regen delay and heals fast (cancelled by damage, not by gas); otherwise 5 s delay then 40 HP/s
      const P = p as any;
      if (P.stimUntil > this.time && p.health < HEALTH.max) p.health = Math.min(HEALTH.max, p.health + HEALTH.stimRate * dt);
      else if (this.time - p.lastDamaged > HEALTH.regenDelay && p.health < HEALTH.max && !this.inGas(p)) p.health = Math.min(HEALTH.max, p.health + HEALTH.regenRate * dt);
    }
    // gas
    if ((p.phase === Phase.Alive || p.phase === Phase.Downed || p.phase === Phase.Freefall || p.phase === Phase.Chute) && this.inGas(p)) {
      if (p.hasMask && p.gasMask > 0) { p.gasMask -= dt; if (p.gasMask <= 0) { p.hasMask = false; } }
      else { this.damage(p, GAS.dps * dt, -2, 'gas', false, true); if (Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) this.emit({ t: 'gas', p: p.id }); }
    }
    // downed bleed-out, self revive, being revived
    if (p.phase === Phase.Downed) {
      p.downT -= dt;
      if (it.selfRevive && p.selfRevive && p.reviveBy < 0) { p.reviveBy = p.id; p.reviveT = 0; }
      if (p.reviveBy >= 0) {
        const r = this.players[p.reviveBy];
        const ok = r.id === p.id ? p.selfRevive : r.phase === Phase.Alive && r.intent.interact && Math.hypot(r.x - p.x, r.z - p.z) < 2.5;
        if (ok) { p.reviveT += dt; p.downT += dt; if (p.reviveT >= DOWNED.reviveTime) this.revive(p); }
        else { p.reviveBy = -1; p.reviveT = 0; }
      }
      if (p.phase === Phase.Downed && p.downT <= 0) this.kill(p, p.killedBy, 'bleed', false, true);
      return;
    }
    if (p.phase !== Phase.Alive && p.phase !== Phase.Gulag && p.phase !== Phase.GulagWait) return;
    // equipment
    if (it.lethal) { it.lethal = false; if (p.lethal && p.lethal.n > 0 && p.phase !== Phase.GulagWait) { throwItem(this, p, p.lethal.type); if (--p.lethal.n <= 0) p.lethal = null; } }
    if (it.tactical) {
      it.tactical = false;
      if (p.phase === Phase.GulagWait) throwItem(this, p, 'rock');
      else if (p.tactical && p.tactical.n > 0) {
        if (p.tactical.type === 'stim') { (p as any).stimUntil = this.time + 1.2; p.tacCooldown = 0; this.emit({ t: 'stim', p: p.id }); }
        else if (p.tactical.type === 'heartbeat') { (p as any).heartbeatUntil = this.time + 12; }
        else throwItem(this, p, p.tactical.type);
        if (--p.tactical.n <= 0) p.tactical = null;
      }
    }
    if (it.killstreak) { it.killstreak = false; if (p.killstreak && p.phase === Phase.Alive && p.turret < 0) this.useKillstreak(p); }
    if ((it as any).fieldUpgrade) { (it as any).fieldUpgrade = false; this.deployFieldUpgrade(p); }
    if (p.turret >= 0) { const t = this.turrets.find((q) => q.id === p.turret); if (!t) this.unmanTurret(p); else { p.x = t.x + Math.sin(t.yaw) * 0.9; p.z = t.z + Math.cos(t.yaw) * 0.9; p.vx = p.vz = 0; } }
    if (p.phase === Phase.GulagWait) return;
    // auto pickups
    if (p.phase === Phase.Alive && !this.inWarmup) for (const itm of this.itemsNear(p.x, p.z, 1.6)) if (Math.abs(itm.y - p.y) < 1.6 && (itm.kind === ItemKind.Ammo || itm.kind === ItemKind.Plate || itm.kind === ItemKind.Cash)) tryPickup(this, p, itm, false);
    // interact (edge + hold)
    const press = it.interact && !(p as any).prevInteract;
    (p as any).prevInteract = it.interact;
    if (it.interact && p.phase === Phase.Alive && !this.inWarmup) this.interact(p, press, dt); else p.interactT = 0;
  }

  /** What the player is looking at to interact with (for prompts and for the action). */
  interactTarget(p: Player): { kind: 'door' | 'revive' | 'chest' | 'item' | 'buy' | 'contract' | 'crate' | 'vehicle' | 'exit' | 'balloon' | 'box' | 'turret' | 'unman'; id: number; label: string } | null {
    if (p.turret >= 0) return { kind: 'unman', id: p.turret, label: 'Leave Shield Turret' };
    if ((p as any).vehicle !== undefined) return { kind: 'exit', id: (p as any).vehicle, label: 'Exit vehicle' };
    for (const q of this.playersNear(p.x, p.z, 2.5)) if (q.squad === p.squad && q.id !== p.id && q.phase === Phase.Downed) return { kind: 'revive', id: q.id, label: `Revive ${q.name}` };
    const d = aimDir(p, [0, 0, 0]);
    let best: { kind: any; id: number; label: string; s: number } | null = null;
    const ey = p.y + eyeHeight(p);
    const consider = (kind: string, id: number, label: string, x: number, y: number, z: number, r: number, minDot = 0.6) => {
      const dx = x - p.x, dy = y - ey, dz = z - p.z, dist = Math.hypot(dx, dy, dz);
      if (dist > r) return;
      const dot = (dx * d[0] + dy * d[1] + dz * d[2]) / Math.max(0.01, dist);
      const s = dot * 2 - dist * 0.3;
      if (dot > minDot && (!best || s > best.s)) best = { kind, id, label, s };
    };
    for (const c of this.chests) if (!c.opened && Math.abs(c.x - p.x) < 3 && Math.abs(c.z - p.z) < 3) consider('chest', c.id, 'Open Supply Box', c.x, c.y + 0.4, c.z, 2.8);
    for (const itm of this.itemsNear(p.x, p.z, 2.6)) consider('item', itm.id, `Pick up ${(itemLabelLazy)(itm)}`, itm.x, itm.y + 0.2, itm.z, 2.8);
    for (const b of this.buyStations) if (Math.abs(b.x - p.x) < 4 && Math.abs(b.z - p.z) < 4) consider('buy', b.id, 'Use Buy Station', b.x, b.y + 1.2, b.z, 3.5);
    for (const c of this.contracts) if (!c.taken && Math.abs(c.x - p.x) < 3 && Math.abs(c.z - p.z) < 3) consider('contract', c.id, `Accept ${c.kind[0].toUpperCase() + c.kind.slice(1)} Contract`, c.x, c.y + 0.7, c.z, 2.8);
    if ((p as any).vehicle === undefined) for (const v of this.vehicles) if (v.alive && Math.abs(v.x - p.x) < 6 && Math.abs(v.z - p.z) < 6 && v.seats.some((q) => q < 0)) consider('vehicle', v.id, `Enter ${VEHICLES[v.type].name}`, v.x, v.y + 1, v.z, VEHICLES[v.type].len / 2 + 2.5, -0.2);
    for (const b of this.boxes) if (b.squad === p.squad && !b.used.has(p.id) && Math.abs(b.x - p.x) < 3 && Math.abs(b.z - p.z) < 3) consider('box', b.id, b.kind === 'armorBox' ? 'Use Armor Box' : 'Use Munitions Box', b.x, b.y + 0.4, b.z, 2.8, -0.3);
    for (const t of this.turrets) if (t.user < 0 && Math.abs(t.x - p.x) < 3 && Math.abs(t.z - p.z) < 3) consider('turret', t.id, 'Use Shield Turret', t.x, t.y + 1, t.z, 2.8, -0.3);
    this.world.balloons.forEach((b, i) => { if (Math.abs(b.x - p.x) < 4 && Math.abs(b.z - p.z) < 4) consider('balloon', i, 'Use Redeploy Balloon', b.x, b.y + 1.2, b.z, 3.5, -0.5); });
    for (const cr of this.crates) if (cr.squad === p.squad && this.time >= cr.land && !cr.taken.has(p.id) && Math.abs(cr.x - p.x) < 3 && Math.abs(cr.z - p.z) < 3) consider('crate', cr.id, 'Open Loadout Drop', cr.x, cr.y + 0.6, cr.z, 3);
    // doors (lowest priority: only when nothing else is in reach)
    if (!best && this.doors) for (const st of this.world.col.near(p.x, p.z, 2.4, this.doorTmp)) {
      if (st.kind !== 'door') continue; const i = this.doors.byStructure.get(st.id); if (i === undefined) continue;
      const w = this.world.doors[i].w, open = Math.abs(this.doors.open[i]) > 0.15;
      consider('door', i, open ? 'Close Door' : p.ads > 0.5 ? 'Crack Door' : 'Open Door', st.x + st.cos * w / 2, st.y + 1.1, st.z - st.sin * w / 2, 2.2, 0.55);
    }
    return best ? { kind: (best as any).kind, id: (best as any).id, label: (best as any).label } : null;
  }

  private interact(p: Player, press: boolean, dt: number) {
    const t = this.interactTarget(p);
    if (!t) { p.interactT = 0; return; }
    if (t.kind === 'revive') { const q = this.players[t.id]; if (q.reviveBy < 0) { q.reviveBy = p.id; q.reviveT = 0; } return; }
    if (!press) return;
    if (t.kind === 'chest') { const c = this.chests.find((c2) => c2.id === t.id)!; c.opened = true; for (const itm of chestContents(this, c.x, c.y, c.z, c.legendary)) this.addItem(itm); this.emit({ t: 'chest', p: p.id, x: c.x, y: c.y, z: c.z }); }
    else if (t.kind === 'item') { const itm = this.itemById.get(t.id); if (itm) tryPickup(this, p, itm, true); }
    else if (t.kind === 'door') this.doors?.interact(t.id, p);
    else if (t.kind === 'buy') { if (!p.bot) this.emit({ t: 'announce', text: '__buy__', squad: p.squad }); else (p as any).atBuy = t.id; }
    else if (t.kind === 'contract') this.acceptContract(p, t.id);
    else if (t.kind === 'vehicle') { const v = this.vehicles.find((q) => q.id === t.id); if (v) enterVehicle(this, p, v); }
    else if (t.kind === 'exit') exitVehicle(this, p);
    else if (t.kind === 'balloon') this.launch(p);
    else if (t.kind === 'box') this.useBox(p, t.id);
    else if (t.kind === 'turret') this.manTurret(p, t.id);
    else if (t.kind === 'unman') this.unmanTurret(p);
    else if (t.kind === 'crate') { const cr = this.crates.find((c) => c.id === t.id)!; cr.taken.add(p.id); if (!p.bot) this.emit({ t: 'announce', text: '__loadout__', squad: p.squad }); else this.applyLoadout(p, this.rng.int(0, LOADOUTS.length - 1)); }
    void dt;
  }

  /** Field upgrades: drop a squad box in front of you. */
  deployFieldUpgrade(p: Player) {
    if (!p.fieldUpgrade || p.phase !== Phase.Alive) return;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), x = p.x + fx * 1.4, z = p.z + fz * 1.4;
    this.boxes.push({ id: this.nextId++, kind: p.fieldUpgrade, x, y: this.world.col.groundAt(x, z, p.y + 1), z, squad: p.squad, used: new Set(), until: this.time + 120 });
    this.emit({ t: 'throw', p: p.id, type: p.fieldUpgrade });
    p.fieldUpgrade = null;
  }
  private useBox(p: Player, id: number) {
    const b = this.boxes.find((q) => q.id === id); if (!b) return;
    b.used.add(p.id);
    if (b.kind === 'armorBox') { p.armor = HEALTH.maxArmor; p.plates = p.maxPlates; this.emit({ t: 'plate', p: p.id, done: true }); }
    else { refill(p); if (p.lethal) p.lethal.n = 2; else p.lethal = { type: 'frag', n: 1 }; if (p.tactical) p.tactical.n = 2; else p.tactical = { type: 'stun', n: 1 }; this.emit({ t: 'pickup', p: p.id, kind: ItemKind.Ammo, label: 'Ammo and equipment refilled' }); }
  }
  /** Shield Turret: a mounted gun behind a bullet-proof shield. */
  deployTurret(p: Player) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), x = p.x + fx * 1.2, z = p.z + fz * 1.2, y = this.world.col.groundAt(x, z, p.y + 1);
    const shield = makeStructure(0, 'turret', x, y, z, p.yaw, [{ x0: -0.8, y0: 0.45, z0: -0.55, x1: 0.8, y1: 1.55, z1: -0.45, mat: Mat.Metal, color: 0x5a6048 }, { x0: -0.15, y0: 0, z0: -0.15, x1: 0.15, y1: 0.9, z1: 0.15, mat: Mat.Metal, color: 0x3a3e40 }]);
    shield.id = 100000 + this.turrets.length; this.world.col.dyn.push(shield);
    this.turrets.push({ id: this.nextId++, x, y, z, yaw: p.yaw, squad: p.squad, user: -1, health: 700, struct: shield.id });
    this.manTurret(p, this.turrets[this.turrets.length - 1].id);
  }
  private manTurret(p: Player, id: number) {
    const t = this.turrets.find((q) => q.id === id); if (!t || t.user >= 0) return;
    t.user = p.id; p.turret = id; p.stash = p.weapons; p.weapons = [{ id: 'turretgun', rarity: 0, mag: 9999 }, null]; p.cur = 0; p.stance = Stance.Stand;
    p.x = t.x + Math.sin(t.yaw) * 0.9; p.z = t.z + Math.cos(t.yaw) * 0.9; p.vx = p.vz = 0;
  }
  unmanTurret(p: Player) {
    const t = this.turrets.find((q) => q.id === p.turret); if (t) t.user = -1;
    p.turret = -1; if (p.stash) { p.weapons = p.stash; p.stash = null; p.cur = 0; }
  }

  /** Redeploy balloon: shoot up into the sky, then freefall and parachute as usual. */
  launch(p: Player) {
    p.phase = Phase.Freefall; p.y += 2; p.vy = 58; p.vx *= 0.3; p.vz *= 0.3; (p as any).launchT = 2.4; p.stance = Stance.Stand;
    this.emit({ t: 'jump', p: p.id }); this.emit({ t: 'chute', p: p.id });
  }

  // ------------------------------------------------------------ damage
  inGas(p: Player) { const c = this.circle; return Math.hypot(p.x - c.cx, p.z - c.cz) > c.r && p.phase !== Phase.Gulag && p.phase !== Phase.GulagWait && p.phase !== Phase.Plane && !this.inWarmup; }

  damage(v: Player, amount: number, attacker: number, weapon: string, head: boolean, bypassArmor: boolean, hx?: number, hy?: number, hz?: number) {
    if (!v.alive || amount <= 0) return;
    if (v.phase === Phase.Plane || v.phase === Phase.Dead || v.phase === Phase.Spectate || v.phase === Phase.GulagWait) return;
    const att = attacker >= 0 ? this.players[attacker] : null;
    if (att && att.squad === v.squad && att.id !== v.id) return; // no friendly fire
    if (att && v.phase === Phase.Gulag !== (att.phase === Phase.Gulag) && weapon !== 'rock') return;
    v.lastDamaged = this.time;
    if (weapon !== 'gas') (v as any).stimUntil = 0; // damage cancels a stim
    if (att) v.killedBy = att.id;
    if (v.phase === Phase.Downed) {
      v.health -= amount;
      if (att) att.damage += amount;
      this.emit({ t: 'hit', attacker, victim: v.id, dmg: amount, head, armorBroke: false, armorHit: false, kill: v.health <= 0, down: false, x: hx ?? v.x, y: hy ?? v.y + 0.4, z: hz ?? v.z });
      if (v.health <= 0) this.kill(v, attacker, weapon, head, true);
      return;
    }
    let armorHit = false, armorBroke = false;
    if (!bypassArmor && v.armor > 0) {
      const a = Math.min(v.armor, amount); v.armor -= a; amount -= a; armorHit = true;
      if (v.armor <= 0) armorBroke = true;
      if (att) att.damage += a;
    }
    v.health -= amount; if (att) att.damage += amount;
    if (v.plateT > 0 && armorHit) { /* plating continues under fire */ }
    const lethal = v.health <= 0;
    let down = false;
    if (lethal) {
      if (v.phase === Phase.Gulag) { this.kill(v, attacker, weapon, head, false); }
      else if (this.squadHasStanding(v.squad, v.id) && !this.inWarmup) { down = true; this.downPlayer(v, attacker, weapon); }
      else this.kill(v, attacker, weapon, head, false);
    }
    if (att || attacker === -1) this.emit({ t: 'hit', attacker, victim: v.id, dmg: amount, head, armorBroke, armorHit, kill: lethal && !down, down, x: hx ?? v.x, y: hy ?? v.y + 1, z: hz ?? v.z });
  }

  private squadHasStanding(squad: number, except: number) {
    for (const q of this.players) if (q.squad === squad && q.id !== except && (q.phase === Phase.Alive || q.phase === Phase.Freefall || q.phase === Phase.Chute || q.phase === Phase.Plane)) return true;
    return false;
  }
  private downPlayer(v: Player, attacker: number, weapon: string) {
    if (v.turret >= 0) this.unmanTurret(v);
    if ((v as any).vehicle !== undefined) exitVehicle(this, v);
    v.phase = Phase.Downed; v.health = DOWNED.health; v.armor = 0; v.downT = DOWNED.bleed; v.reviveBy = -1; v.reviveT = 0;
    v.plateT = 0; v.reloadT = 0; v.ads = 0; v.stance = Stance.Prone; v.sprinting = false; v.slideT = 0;
    this.emit({ t: 'down', victim: v.id, attacker, w: weapon });
  }
  revive(p: Player) {
    if (p.reviveBy === p.id) p.selfRevive = false;
    p.phase = Phase.Alive; p.health = DOWNED.revivedHealth; p.stance = Stance.Stand; p.reviveBy = -1; p.reviveT = 0; p.lastDamaged = this.time;
    this.emit({ t: 'revive', p: p.id });
  }

  kill(v: Player, attacker: number, weapon: string, head: boolean, finish: boolean) {
    if (v.turret >= 0) this.unmanTurret(v);
    if ((v as any).vehicle !== undefined) exitVehicle(this, v);
    if (this.inWarmup) { this.emit({ t: 'kill', victim: v.id, attacker, w: weapon, head, finish, x: v.x, y: v.y, z: v.z, yaw: v.yaw }); if (attacker >= 0) this.players[attacker].kills++; v.phase = Phase.Dead; (v as any).respawnAt = this.time + 3; return; }
    const inGulag = v.phase === Phase.Gulag;
    v.health = 0; v.armor = 0;
    const att = attacker >= 0 ? this.players[attacker] : null;
    if (att && att.squad !== v.squad) att.kills++;
    this.emit({ t: 'kill', victim: v.id, attacker, w: weapon, head, finish, x: v.x, y: v.y, z: v.z, yaw: v.yaw });
    this.checkBounty(v, attacker);
    if (inGulag) { this.gulagResult(v.id); return; }
    dropBag(this, v);
    v.deadAt = this.time;
    // Gulag: first death while the Gulag is open
    if (!v.gulagUsed && !this.gulag.closed) {
      v.gulagUsed = true;
      v.phase = Phase.GulagWait;
      this.gulag.queue.push(v.id);
      this.placeOnBalcony(v);
      this.emit({ t: 'gulag', p: v.id, msg: 'enter' });
    } else {
      v.phase = Phase.Dead; v.alive = false;
    }
    // squad wipe: everyone left downed dies
    if (!this.squadHasStanding(v.squad, -1)) {
      for (const q of this.players) if (q.squad === v.squad && q.phase === Phase.Downed) this.kill(q, q.killedBy, 'bleed', false, true);
      if (!this.players.some((q) => q.squad === v.squad && (q.phase === Phase.GulagWait || q.phase === Phase.Gulag))) this.emit({ t: 'squadwipe', squad: v.squad });
    }
    this.aliveCount = this.players.filter((q) => q.alive).length;
  }

  explode(x: number, y: number, z: number, r: number, dmg: number, owner: number, kind: Explosion['kind']) {
    this.emit({ t: 'explosion', x, y, z, r, kind });
    for (const v of this.vehicles) if (v.alive) { const d = Math.hypot(v.x - x, v.y - y, v.z - z); if (d < r + 2) v.health -= dmg * 3 * (1 - d / (r + 2)); }
    for (const p of this.playersNear(x, z, r)) {
      const d = Math.hypot(p.x - x, p.y + 1 - y, p.z - z);
      if (d > r) continue;
      if (!this.world.col.los(x, y + 0.3, z, p.x, p.y + 1, p.z) && d > 1.5) continue;
      this.damage(p, dmg * Math.pow(1 - d / r, 0.8), owner, kind, false, false, p.x, p.y + 1, p.z);
    }
  }
  private updateExplosions(dt: number) {
    for (const e of this.pending) { e.delay -= dt; if (e.delay <= 0) this.explode(e.x, e.y, e.z, e.r, e.dmg, e.owner, e.kind); }
    this.pending = this.pending.filter((e) => e.delay > 0);
  }

  /** The enemy under (or right next to) p's crosshair with a clear line of sight, if any. */
  pingTarget(p: Player, maxD = 350): Player | null {
    const d = aimDir(p, [0, 0, 0]), ey = p.y + eyeHeight(p);
    let best: Player | null = null, ba = Infinity;
    for (const q of this.playersNear(p.x, p.z, maxD)) {
      if (q.squad === p.squad || !q.alive || (q.phase !== Phase.Alive && q.phase !== Phase.Downed && q.phase !== Phase.Chute && q.phase !== Phase.Freefall)) continue;
      const ty = q.y + (q.phase === Phase.Downed || q.stance === Stance.Prone ? 0.4 : q.stance === Stance.Crouch ? 1.0 : 1.3);
      const vx = q.x - p.x, vy = ty - ey, vz = q.z - p.z, dist = Math.hypot(vx, vy, vz); if (dist < 1) continue;
      const ang = Math.acos(Math.min(1, (vx * d[0] + vy * d[1] + vz * d[2]) / dist));
      if (ang > Math.max(0.045, Math.atan(1.2 / dist)) || ang >= ba) continue;
      if (!this.world.col.los(p.x, ey, p.z, q.x, ty, q.z)) continue;
      best = q; ba = ang;
    }
    return best;
  }
  pingEnemy(p: Player, q: Player) {
    this.enemyPings = this.enemyPings.filter((e) => e.until > this.time && !(e.squad === p.squad && e.target === q.id));
    this.enemyPings.push({ squad: p.squad, by: p.id, target: q.id, x: q.x, y: q.y, z: q.z, until: this.time + 6 });
    this.emit({ t: 'eping', squad: p.squad, by: p.id, target: q.id, x: q.x, y: q.y, z: q.z });
  }

  /** 0..1 how badly an enemy Counter UAV jams this player's HUD (any >0 scrambles the minimap). */
  jamLevel(p: Player): number {
    let j = 0;
    for (const c of this.counterUavs) {
      if (c.until <= this.time || c.squad === p.squad) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < COUNTER_UAV_R) j = Math.max(j, 0.25 + 0.75 * (1 - d / COUNTER_UAV_R));
    }
    return j;
  }

  // ------------------------------------------------------------ killstreaks & buying
  private hitBuf: RayHit = { t: 0, nx: 0, ny: 0, nz: 0, structure: -1, part: -1, mat: Mat.Rock, terrain: false, water: false };
  aimPoint(p: Player, maxD = 600): [number, number, number] {
    const d = aimDir(p, [0, 0, 0]), ey = p.y + eyeHeight(p);
    const t = this.world.col.raycast(p.x, ey, p.z, d[0], d[1], d[2], maxD, this.hitBuf) ? this.hitBuf.t : Math.min(maxD, 150);
    return [p.x + d[0] * t, ey + d[1] * t, p.z + d[2] * t];
  }
  useKillstreak(p: Player, tx?: number, tz?: number) {
    const k = p.killstreak!; p.killstreak = null;
    if (k === 'uav') { this.squadUav.set(p.squad, { until: this.time + 40, x: p.x, z: p.z }); this.emit({ t: 'uav', squad: p.squad }); return; }
    if (k === 'cuav') { this.counterUavs.push({ squad: p.squad, x: p.x, z: p.z, until: this.time + 40 }); this.emit({ t: 'cuav', squad: p.squad }); return; }
    if (k === 'turret') { this.deployTurret(p); return; }
    let [x, , z] = this.aimPoint(p);
    if (tx !== undefined && tz !== undefined) { x = tx; z = tz; }
    const g = this.world.hf.at(x, z);
    this.emit({ t: 'marker', x, z, kind: k, squad: p.squad, dur: 6 });
    if (k === 'cluster') for (let i = 0; i < 12; i++) this.pending.push({ x: x + this.rng.range(-18, 18), y: g + 0.5, z: z + this.rng.range(-18, 18), r: 8, dmg: 140, owner: p.id, delay: 3.5 + i * 0.22, kind: 'cluster' });
    else for (let i = 0; i < 3; i++) { const o = (i - 1) * 14; const a = p.yaw; this.pending.push({ x: x - Math.sin(a) * o, y: g + 0.5, z: z - Math.cos(a) * o, r: 14, dmg: 260, owner: p.id, delay: 4.5 + i * 0.35, kind: 'airstrike' }); }
  }

  /** Buy-station purchase. Returns an error string or null. */
  buy(p: Player, item: BuyId, arg?: number): string | null {
    const price = PRICES[item];
    if (this.squadSize === 1 && (item === 'buyback' || item === 'selfRevive')) return 'Not available in Solos';
    if (p.cash < price) return 'Not enough cash';
    switch (item) {
      case 'plates': if (p.plates >= p.maxPlates) return 'Plates full'; p.plates = p.maxPlates; break;
      case 'uav': case 'cuav': case 'cluster': case 'airstrike': case 'turret': if (p.killstreak) return 'Already carrying a killstreak'; p.killstreak = item; break;
      case 'munitions': case 'armorBox': if (p.fieldUpgrade) return 'Already carrying a field upgrade'; p.fieldUpgrade = item; break;
      case 'gasMask': if (p.hasMask && p.gasMask >= GAS.maskTime) return 'Already have a gas mask'; p.hasMask = true; p.gasMask = GAS.maskTime; break;
      case 'selfRevive': if (p.selfRevive) return 'Already have a Self-Revive Kit'; p.selfRevive = true; break;
      case 'buyback': {
        const mate = this.players.find((q) => q.squad === p.squad && q.id !== p.id && q.phase === Phase.Dead && (arg === undefined || q.id === arg));
        if (!mate) return 'No teammates to buy back';
        p.cash -= price; this.redeploy(mate); this.emit({ t: 'buy', p: p.id, item }); return null;
      }
      case 'loadout': {
        const g = this.world.col.groundAt(p.x + 4, p.z, p.y + 3);
        this.crates.push({ id: this.nextId++, squad: p.squad, x: p.x + 4, y: g, z: p.z, land: this.time + 12, taken: new Set() });
        this.emit({ t: 'marker', x: p.x + 4, z: p.z, kind: 'loadout', squad: p.squad, dur: 12 });
        break;
      }
    }
    p.cash -= price;
    this.emit({ t: 'buy', p: p.id, item });
    return null;
  }

  applyLoadout(p: Player, idx: number) {
    const L = LOADOUTS[idx % LOADOUTS.length];
    for (const [i, id] of L.guns.entries()) {
      const old = p.weapons[i];
      if (old) this.dropItem({ kind: ItemKind.Weapon, weapon: old.id, rarity: old.rarity, mag: old.mag }, p.x + (i ? 1 : -1), p.y, p.z);
      p.weapons[i] = { id, rarity: 4, mag: magSize(id, 4) };
      const am = WEAPON[id].ammo; p.ammo[am] = Math.max(p.ammo[am], Math.min(AMMO_MAX[am], magSize(id, 4) * 3));
    }
    p.cur = 0; p.lethal = { type: L.lethal, n: 1 }; p.tactical = { type: L.tactical, n: 2 };
    p.loadoutUsed = true;
  }

  // ------------------------------------------------------------ circle
  private pickNextCircle() {
    const c = this.circle, spec = CIRCLES[c.phase];
    const nr = spec.radius;
    for (let i = 0; i < 200; i++) {
      const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * Math.max(0, c.r - nr) * (c.phase === 0 ? 0.55 : 0.95);
      const x = c.cx + Math.cos(a) * d, z = c.cz + Math.sin(a) * d;
      if (this.world.hf.at(x, z) < 1 || !inPlayable(x, z)) continue;
      c.nx = x; c.nz = z; c.nr = nr; return;
    }
    c.nx = c.cx; c.nz = c.cz; c.nr = nr;
  }
  private updateCircle(dt: number) {
    const c = this.circle;
    if (c.done) return;
    c.t -= dt;
    if (!c.closing) {
      if (c.t <= 0) { c.closing = true; c.t = CIRCLES[c.phase].close; c.sx = c.cx; c.sz = c.cz; c.sr = c.r; this.emit({ t: 'circle', phase: c.phase, closing: true }); if (c.phase + 1 >= GULAG.closesAfterCircle && !this.gulag.closed) { this.gulag.closed = true; this.emit({ t: 'gulag', p: -1, msg: 'closed' }); } }
    } else {
      const T = CIRCLES[c.phase].close, k = clamp(1 - c.t / T, 0, 1);
      c.cx = c.sx + (c.nx - c.sx) * k; c.cz = c.sz + (c.nz - c.sz) * k; c.r = c.sr + (c.nr - c.sr) * k;
      if (c.t <= 0) {
        c.closing = false; c.phase++;
        if (c.phase >= CIRCLES.length) { c.done = true; c.r = 0; return; }
        c.t = CIRCLES[c.phase].wait; this.pickNextCircle();
        this.emit({ t: 'circle', phase: c.phase, closing: false });
      }
    }
  }

  // ------------------------------------------------------------ gulag
  private placeOnBalcony(p: Player) {
    const side = this.rng.chance(0.5) ? 1 : -1;
    p.x = GULAG_POS.x + this.rng.range(-18, 18); p.z = GULAG_POS.z + side * (GULAG_BALCONY_Z + 1); p.y = GULAG_POS.y + 4.5;
    p.vx = p.vy = p.vz = 0; p.health = 100; p.armor = 0; p.stance = Stance.Stand; p.onGround = true;
    p.yaw = side > 0 ? 0 : Math.PI; p.intent.yaw = p.yaw;
    p.weapons = [null, null];
  }
  fightOf(id: number) { return this.gulag.fights.find((f) => f.a === id || f.b === id) ?? null; }
  private updateGulag(dt: number) {
    const g = this.gulag;
    g.queue = g.queue.filter((id) => this.players[id].phase === Phase.GulagWait);
    // start fights in free arenas
    while (g.queue.length >= 2 && g.fights.length < GULAG_ARENAS) {
      const used = new Set(g.fights.map((f) => f.arena)); let arena = 0; while (used.has(arena)) arena++;
      this.startGulagFight(arena, g.queue.shift()!, g.queue.shift()!);
    }
    if (g.queue.length === 1) { g.idle += dt; if (g.idle > 25 || g.closed) { const id = g.queue.shift()!; g.idle = 0; this.emit({ t: 'gulag', p: id, msg: 'win' }); this.redeploy(this.players[id]); } }
    else g.idle = 0;
    for (const f of [...g.fights]) {
      f.t += dt;
      const A = this.players[f.a], B = this.players[f.b], c = gulagArena(f.arena);
      if (f.t > GULAG.overtime) {
        if (!f.overtime) { f.overtime = true; this.emit({ t: 'gulag', p: A.id, msg: 'overtime' }); this.emit({ t: 'gulag', p: B.id, msg: 'overtime' }); }
        const onA = Math.hypot(A.x - c.x, A.z - c.z) < 2.5, onB = Math.hypot(B.x - c.x, B.z - c.z) < 2.5;
        if (onA !== onB) { const o = onA ? A.id : B.id; if (f.flagOwner !== o) { f.flagOwner = o; f.flagT = 0; } f.flagT += dt; if (f.flagT >= GULAG.flagTime) { this.gulagResult(o === A.id ? B.id : A.id); continue; } }
        else { f.flagOwner = -1; f.flagT = 0; }
        if (f.t > GULAG.overtime + 30) { // nobody took the flag: both lose
          g.fights.splice(g.fights.indexOf(f), 1);
          for (const p of [A, B]) { p.phase = Phase.Dead; p.alive = false; this.emit({ t: 'gulag', p: p.id, msg: 'lose' }); }
          this.aliveCount = this.players.filter((q) => q.alive).length;
        }
      }
    }
  }
  private startGulagFight(arena: number, a: number, b: number) {
    const f: GulagFight = { arena, a, b, t: 0, flagT: 0, flagOwner: -1, overtime: false };
    this.gulag.fights.push(f);
    const kit = this.rng.pick(GULAG_KITS), c = gulagArena(arena);
    [a, b].forEach((id, i) => {
      const p = this.players[id];
      const [sx, sy, sz] = GULAG_SPAWNS[i];
      p.phase = Phase.Gulag; p.x = c.x + sx; p.y = c.y + sy; p.z = c.z + sz;
      p.yaw = i === 0 ? -Math.PI / 2 : Math.PI / 2; p.intent.yaw = p.yaw; p.pitch = 0; p.intent.pitch = 0;
      p.health = 100; p.armor = 0; p.plates = 0; p.stance = Stance.Stand; p.vx = p.vy = p.vz = 0;
      p.weapons = [{ id: kit.gun, rarity: 0, mag: magSize(kit.gun, 0) }, null]; p.cur = 0;
      p.ammo[WEAPON[kit.gun].ammo] = magSize(kit.gun, 0) * 4;
      p.lethal = { type: kit.lethal, n: 1 }; p.tactical = { type: kit.tactical, n: 1 };
      this.emit({ t: 'gulag', p: id, msg: 'fight' });
    });
  }
  private gulagResult(loserId: number) {
    const g = this.gulag;
    const f = this.fightOf(loserId); if (!f) return;
    g.fights.splice(g.fights.indexOf(f), 1);
    const winId = loserId === f.a ? f.b : f.a;
    const loser = this.players[loserId], win = this.players[winId];
    loser.phase = Phase.Dead; loser.alive = false; loser.weapons = [null, null];
    this.emit({ t: 'gulag', p: loserId, msg: 'lose' });
    if (win) { this.emit({ t: 'gulag', p: winId, msg: 'win' }); this.redeploy(win); }
    this.aliveCount = this.players.filter((q) => q.alive).length;
  }

  /** Back into Verdansk from the sky over the current circle (Gulag win or buyback). */
  redeploy(p: Player) {
    const c = this.circle;
    const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * c.r * 0.7;
    p.x = clamp(c.cx + Math.cos(a) * d, 50, MAP_SIZE - 50); p.z = clamp(c.cz + Math.sin(a) * d, 50, MAP_SIZE - 50);
    p.y = this.world.hf.at(p.x, p.z) + DEPLOY.redeployAlt;
    p.phase = Phase.Freefall; p.alive = true; p.health = 100; p.armor = 0; p.vx = p.vz = 0; p.vy = -20;
    p.weapons = [{ id: 'x16', rarity: 0, mag: 13 }, null]; p.cur = 0; p.ammo.light = Math.max(p.ammo.light, 30);
    p.gulagUsed = true;
    this.emit({ t: 'redeploy', p: p.id });
    this.aliveCount = this.players.filter((q) => q.alive).length;
  }

  // ------------------------------------------------------------ contracts
  private acceptContract(p: Player, id: number) {
    if (this.active.some((a) => a.squad === p.squad)) { if (!p.bot) this.emit({ t: 'announce', text: 'Your squad already has an active contract', squad: p.squad }); return; }
    const c = this.contracts.find((k) => k.id === id)!; c.taken = true;
    const a: ActiveContract = { kind: c.kind, squad: p.squad, t: CONTRACT[c.kind].time };
    if (c.kind === 'bounty') {
      let best: Player | null = null, bd = Infinity;
      for (const q of this.players) if (q.alive && q.squad !== p.squad && q.phase === Phase.Alive) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d > 80 && d < bd) { bd = d; best = q; } }
      if (!best) { c.taken = false; return; }
      a.target = best.id; best.bountyOn = this.time + a.t;
      this.emit({ t: 'announce', text: 'A bounty has been placed on you', squad: best.squad });
    } else if (c.kind === 'scavenger') { a.step = 0; this.spawnScavChest(a, p.x, p.z); }
    else { const s = this.snapToFree(p.x + this.rng.range(-220, 220), p.z + this.rng.range(-220, 220)) ?? { x: p.x + 100, y: p.y, z: p.z }; a.zx = s.x; a.zz = s.z; a.zy = s.y; a.progress = 0; }
    this.active.push(a);
    this.emit({ t: 'contract', p: p.id, kind: c.kind, msg: 'start' });
  }
  private spawnScavChest(a: ActiveContract, x: number, z: number) {
    const s = this.snapToFree(x + this.rng.range(-160, 160), z + this.rng.range(-160, 160)) ?? { x: x + 60, y: this.world.hf.at(x + 60, z), z };
    const ch: Chest = { id: this.nextId++, x: s.x, y: s.y, z: s.z, opened: false, legendary: a.step === 2 };
    this.chests.push(ch); a.chest = ch.id;
  }
  private updateContracts(dt: number) {
    for (const a of this.active) {
      a.t -= dt;
      const squad = this.players.filter((q) => q.squad === a.squad);
      if (!squad.some((q) => q.alive)) a.t = -1;
      if (a.kind === 'scavenger') {
        const ch = this.chests.find((c) => c.id === a.chest);
        if (ch?.opened) {
          a.step!++;
          if (a.step! >= 3) { this.reward(a, CONTRACT.scavenger.reward); a.t = -2; }
          else { this.spawnScavChest(a, ch.x, ch.z); this.emit({ t: 'contract', p: squad[0].id, kind: 'scavenger', msg: 'progress' }); }
        }
      } else if (a.kind === 'recon') {
        const inside = squad.some((q) => q.phase === Phase.Alive && Math.hypot(q.x - a.zx!, q.z - a.zz!) < 8);
        if (inside) { a.progress! += dt; if (a.progress! >= CONTRACT.recon.capture) { this.reward(a, CONTRACT.recon.reward); this.squadReveal.add(a.squad); a.t = -2; } }
      } else if (a.kind === 'bounty') {
        const tgt = this.players[a.target!];
        if (!tgt.alive || tgt.phase === Phase.GulagWait) { a.t = Math.min(a.t, -1); }
      }
      if (a.t <= 0 && a.t > -2) this.emit({ t: 'contract', p: squad[0].id, kind: a.kind, msg: a.t === -2 ? 'done' : 'fail' });
    }
    this.active = this.active.filter((a) => a.t > 0);
  }
  private checkBounty(v: Player, attacker: number) {
    if (attacker < 0) return;
    const att = this.players[attacker];
    const a = this.active.find((x) => x.kind === 'bounty' && x.target === v.id && x.squad === att.squad);
    if (a) { this.reward(a, CONTRACT.bounty.reward); a.t = -2; this.emit({ t: 'contract', p: att.id, kind: 'bounty', msg: 'done' }); }
  }
  private reward(a: ActiveContract, cash: number) {
    for (const q of this.players) if (q.squad === a.squad && q.alive) q.cash += cash;
    this.emit({ t: 'announce', text: `Contract complete  +$${cash}`, squad: a.squad });
  }

  private updateCrates(dt: number) { void dt; this.crates = this.crates.filter((c) => this.time < c.land + 120); if (this.boxes.length) this.boxes = this.boxes.filter((b) => b.until > this.time); }

  private settleItems(dt: number) {
    for (const it of this.falling) {
      if (it.vy === undefined || !it.alive) continue;
      it.vy -= 15 * dt; it.y += it.vy * dt;
      const g = this.world.col.groundAt(it.x, it.z, it.y + 0.5);
      if (it.y <= g + 0.05) { it.y = g + 0.05; it.vy = undefined; }
    }
    if (this.falling.length) this.falling = this.falling.filter((i) => i.vy !== undefined && i.alive);
    if (Math.floor(this.time) % 10 === 0 && Math.floor(this.time - dt) % 10 !== 0) this.items = this.items.filter((i) => i.alive);
  }

  private checkWin() {
    const squads = new Set<number>();
    for (const p of this.players) if (p.alive && p.phase !== Phase.GulagWait && p.phase !== Phase.Gulag) squads.add(p.squad);
    if (squads.size <= 1 && this.time > 5) {
      this.over = true; this.winner = squads.size ? [...squads][0] : -1;
      this.emit({ t: 'win', squad: this.winner });
    }
  }

  /** Squads still in the game (for the HUD). */
  squadsLeft() { const s = new Set<number>(); for (const p of this.players) if (p.alive) s.add(p.squad); return s.size; }
}

function refill(p: Player) { for (const k of Object.keys(AMMO_MAX) as AmmoType[]) p.ammo[k] = AMMO_MAX[k]; }

export const LOADOUTS = [
  { name: 'Grau + MP5', guns: ['grau', 'mp5'], lethal: 'semtex' as const, tactical: 'stun' as const },
  { name: 'M4A1 + MP7', guns: ['m4', 'mp7'], lethal: 'frag' as const, tactical: 'heartbeat' as const },
  { name: 'Kilo 141 + HDR', guns: ['kilo', 'hdr'], lethal: 'knife' as const, tactical: 'stim' as const },
  { name: 'RAM-7 + AUG', guns: ['ram7', 'aug'], lethal: 'semtex' as const, tactical: 'flash' as const },
  { name: 'Bruen + MP5', guns: ['bruen', 'mp5'], lethal: 'frag' as const, tactical: 'stun' as const },
  { name: 'Kar98k + MP7', guns: ['kar98', 'mp7'], lethal: 'knife' as const, tactical: 'smoke' as const },
];
const GULAG_KITS = [
  { gun: 'm1911', lethal: 'frag' as const, tactical: 'flash' as const },
  { gun: 'deagle', lethal: 'knife' as const, tactical: 'stun' as const },
  { gun: 'm680', lethal: 'frag' as const, tactical: 'smoke' as const },
  { gun: 'x16', lethal: 'semtex' as const, tactical: 'stun' as const },
  { gun: 'mp7', lethal: 'knife' as const, tactical: 'flash' as const },
];
import { itemLabel } from './loot';
const itemLabelLazy = (it: Item) => itemLabel(it);
void POIS;
