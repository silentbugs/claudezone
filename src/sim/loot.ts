/** Loot tables, ground spawns, supply boxes, pickup and death drops. */
import { WEAPONS, WEAPON, AMMO_PICKUP, AMMO_MAX, AMMO_NAMES, rarityMods, AmmoType } from '../data/weapons';
import { Item, ItemKind, Player, LethalType, TacticalType, KillstreakType, Phase } from './types';
import { LOOT_TIER_WEIGHTS, HEALTH, CASH } from './config';
import type { Sim } from './sim';
import type { Rng } from '../core/rng';

export const LETHALS: LethalType[] = ['frag', 'semtex', 'knife', 'molotov', 'c4'];
export const TACTICALS: TacticalType[] = ['stun', 'flash', 'smoke', 'heartbeat', 'stim'];
export const LETHAL_NAMES: Record<string, string> = { frag: 'Frag Grenade', semtex: 'Semtex', knife: 'Throwing Knife', molotov: 'Molotov Cocktail', c4: 'C4', claymore: 'Claymore' };
export const TACTICAL_NAMES: Record<string, string> = { stun: 'Stun Grenade', flash: 'Flash Grenade', smoke: 'Smoke Grenade', heartbeat: 'Heartbeat Sensor', stim: 'Stim' };
export const KILLSTREAK_NAMES: Record<string, string> = { uav: 'UAV', cuav: 'Counter UAV', cluster: 'Cluster Strike', airstrike: 'Precision Airstrike', turret: 'Shield Turret' };
export const FIELD_UPGRADE_NAMES: Record<string, string> = { munitions: 'Munitions Box', armorBox: 'Armor Box' };

export function rollRarity(rng: Rng, bonus = 0): number {
  const w = LOOT_TIER_WEIGHTS.map((v, i) => v * (1 + bonus * i));
  const tot = w.reduce((a, b) => a + b, 0); let r = rng.next() * tot;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}
export function rollWeapon(rng: Rng, bonus = 0): { id: string; rarity: number } {
  const w = rng.weighted(WEAPONS, (d) => d.weight);
  return { id: w.id, rarity: rollRarity(rng, bonus) };
}
export function magSize(id: string, rarity: number) { const d = WEAPON[id]; return rarityMods(rarity).extMag ? d.magExt : d.mag; }

export function itemLabel(it: Item): string {
  switch (it.kind) {
    case ItemKind.Weapon: return WEAPON[it.weapon!].name;
    case ItemKind.Ammo: return AMMO_NAMES[it.ammo!];
    case ItemKind.Plate: return 'Armor Plate';
    case ItemKind.Cash: return `$${it.n}`;
    case ItemKind.Lethal: return LETHAL_NAMES[it.lethal!];
    case ItemKind.Tactical: return TACTICAL_NAMES[it.tactical!];
    case ItemKind.Killstreak: return KILLSTREAK_NAMES[it.killstreak!];
    case ItemKind.SelfRevive: return 'Self-Revive Kit';
    case ItemKind.GasMask: return 'Gas Mask';
    case ItemKind.Satchel: return 'Armor Satchel';
  }
}

/** A random ground-loot item at a spot. */
export function randomItem(sim: Sim, x: number, y: number, z: number, bonus = 0): Item {
  const rng = sim.rng, r = rng.next();
  const base = { id: sim.nextId++, x, y, z, alive: true } as Item;
  if (r < 0.28) { const w = rollWeapon(rng, bonus); return { ...base, kind: ItemKind.Weapon, weapon: w.id, rarity: w.rarity, mag: magSize(w.id, w.rarity) }; }
  if (r < 0.52) { const a = rng.pick(['heavy', 'heavy', 'heavy', 'light', 'light', 'light', 'sniper', 'shotgun'] as AmmoType[]); return { ...base, kind: ItemKind.Ammo, ammo: a, n: AMMO_PICKUP[a] }; }
  if (r < 0.67) return { ...base, kind: ItemKind.Plate, n: 1 };
  if (r < 0.82) return { ...base, kind: ItemKind.Cash, n: rng.pick(CASH.stack) };
  if (r < 0.89) return { ...base, kind: ItemKind.Lethal, lethal: rng.pick(LETHALS), n: 1 };
  if (r < 0.95) return { ...base, kind: ItemKind.Tactical, tactical: rng.pick(TACTICALS), n: 1 };
  if (r < 0.975) return { ...base, kind: ItemKind.Killstreak, killstreak: rng.pick(['uav', 'uav', 'cluster', 'airstrike'] as KillstreakType[]) };
  if (r < 0.978) return { ...base, kind: ItemKind.GasMask };
  if (r < 0.985) return { ...base, kind: ItemKind.SelfRevive };
  return { ...base, kind: ItemKind.Satchel };
}

/** Supply box contents: a weapon, ammo, plates, cash and a chance of equipment. */
export function chestContents(sim: Sim, x: number, y: number, z: number, legendary: boolean): Item[] {
  const rng = sim.rng, out: Item[] = [];
  const spot = (i: number, n: number) => { const a = (i / n) * Math.PI * 2 + rng.next() * 0.5, d = 0.8 + rng.next() * 0.5; return [x + Math.cos(a) * d, y + 0.1, z + Math.sin(a) * d] as const; };
  const n = legendary ? 6 : rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const [ix, iy, iz] = spot(i, n);
    const base = { id: sim.nextId++, x: ix, y: iy, z: iz, alive: true, vy: 3 } as Item;
    if (i === 0) { const w = rollWeapon(rng, legendary ? 3 : 0.6); out.push({ ...base, kind: ItemKind.Weapon, weapon: w.id, rarity: legendary ? Math.max(3, w.rarity) : w.rarity, mag: magSize(w.id, w.rarity) }); }
    else if (i === 1) { const a = rng.pick(['heavy', 'light', 'sniper', 'shotgun'] as AmmoType[]); out.push({ ...base, kind: ItemKind.Ammo, ammo: a, n: AMMO_PICKUP[a] * 2 }); }
    else if (i === 2) out.push({ ...base, kind: ItemKind.Plate, n: 1 });
    else if (i === 3) out.push({ ...base, kind: ItemKind.Cash, n: rng.int(CASH.chestCash[0] / 100, CASH.chestCash[1] / 100) * 100 });
    else {
      const r = rng.next();
      if (r < 0.35) out.push({ ...base, kind: ItemKind.Lethal, lethal: rng.pick(LETHALS), n: 1 });
      else if (r < 0.65) out.push({ ...base, kind: ItemKind.Tactical, tactical: rng.pick(TACTICALS), n: 1 });
      else if (r < 0.68) out.push({ ...base, kind: ItemKind.Plate, n: 1 });
      else if (r < 0.8) out.push({ ...base, kind: ItemKind.Satchel }); // armor satchels mostly come from supply boxes
      else if (r < 0.92) out.push({ ...base, kind: ItemKind.Killstreak, killstreak: rng.pick(['uav', 'cluster', 'airstrike'] as KillstreakType[]) });
      else out.push({ ...base, kind: rng.chance(0.5) ? ItemKind.SelfRevive : ItemKind.GasMask });
    }
  }
  return out;
}

/** Auto-pickup (ammo, plates, cash) and interact pickup (everything else). Returns true if taken. */
export function tryPickup(sim: Sim, p: Player, it: Item, explicit: boolean): boolean {
  if (!it.alive) return false;
  let took = false;
  switch (it.kind) {
    case ItemKind.Ammo: {
      const cap = AMMO_MAX[it.ammo!] - p.ammo[it.ammo!]; if (cap <= 0) break;
      const t = Math.min(cap, it.n!); p.ammo[it.ammo!] += t; it.n! -= t; took = it.n! <= 0; if (!took) { sim.emit({ t: 'pickup', p: p.id, kind: it.kind, label: `+${t} ${AMMO_NAMES[it.ammo!]}` }); return false; }
      break;
    }
    case ItemKind.Plate: if (p.plates < p.maxPlates) { p.plates++; took = true; } break;
    case ItemKind.Cash: p.cash += it.n!; took = true; break;
    case ItemKind.Satchel: if (!explicit) return false; p.maxPlates = HEALTH.carrySatchel; took = true; break;
    case ItemKind.SelfRevive: if (!explicit || p.selfRevive) return false; p.selfRevive = true; took = true; break;
    case ItemKind.GasMask: if (!explicit || p.hasMask) return false; p.hasMask = true; p.gasMask = 12; took = true; break;
    case ItemKind.Lethal:
      if (p.lethal && p.lethal.type === it.lethal) { if (p.lethal.n >= 2) return false; p.lethal.n++; took = true; }
      else if (explicit || !p.lethal) { if (p.lethal) sim.dropItem({ kind: ItemKind.Lethal, lethal: p.lethal.type, n: p.lethal.n }, it.x, it.y, it.z); p.lethal = { type: it.lethal!, n: 1 }; took = true; }
      break;
    case ItemKind.Tactical:
      if (p.tactical && p.tactical.type === it.tactical) { if (p.tactical.n >= 2) return false; p.tactical.n++; took = true; }
      else if (explicit || !p.tactical) { if (p.tactical) sim.dropItem({ kind: ItemKind.Tactical, tactical: p.tactical.type, n: p.tactical.n }, it.x, it.y, it.z); p.tactical = { type: it.tactical!, n: 1 }; took = true; }
      break;
    case ItemKind.Killstreak: if (!explicit && p.killstreak) return false; if (p.killstreak) sim.dropItem({ kind: ItemKind.Killstreak, killstreak: p.killstreak }, it.x, it.y, it.z); p.killstreak = it.killstreak!; took = true; break;
    case ItemKind.Weapon: {
      if (!explicit) {
        // auto-take into an empty slot only
        const empty = p.weapons.findIndex((w) => !w);
        if (empty < 0) return false;
        p.weapons[empty] = { id: it.weapon!, rarity: it.rarity!, mag: it.mag! };
        if (!p.weapons[p.cur]) { p.cur = empty; pickupRaise(p); }
        took = true; break;
      }
      const empty = p.weapons.findIndex((w) => !w);
      const slot = empty >= 0 ? empty : p.cur;
      const old = p.weapons[slot];
      if (old) sim.dropItem({ kind: ItemKind.Weapon, weapon: old.id, rarity: old.rarity, mag: old.mag }, p.x, p.y + 0.1, p.z);
      p.weapons[slot] = { id: it.weapon!, rarity: it.rarity!, mag: it.mag! };
      p.cur = slot; p.reloadT = 0; pickupRaise(p);
      // top up a mag of reserve for the new gun if empty-handed on ammo
      const am = WEAPON[it.weapon!].ammo; if (p.ammo[am] < magSize(it.weapon!, it.rarity!)) p.ammo[am] = Math.min(AMMO_MAX[am], p.ammo[am] + magSize(it.weapon!, it.rarity!));
      took = true; break;
    }
  }
  if (took) { it.alive = false; sim.removeItem(it); sim.emit({ t: 'pickup', p: p.id, kind: it.kind, label: itemLabel(it) }); }
  return took;
}

/** Picking up a gun: a quick raise from below (no drop half - the old gun is already on the ground), ~0.4 s. */
function pickupRaise(p: Player) {
  const P = p as any; p.swapT = 0.4; P.swapDur = 0.4; P.swapDrop = 0; P.swapFrom = -1;
}

/** Everything a dead player carried spills out in a pile. */
export function dropBag(sim: Sim, p: Player) {
  const items: Partial<Item>[] = [];
  for (const w of p.weapons) if (w) items.push({ kind: ItemKind.Weapon, weapon: w.id, rarity: w.rarity, mag: w.mag });
  items.push({ kind: ItemKind.Plate, n: 1 }); items.push({ kind: ItemKind.Plate, n: 1 });
  for (let i = 0; i < Math.min(3, p.plates); i++) items.push({ kind: ItemKind.Plate, n: 1 });
  if (p.cash > 0) items.push({ kind: ItemKind.Cash, n: p.cash });
  // ammo (2020): some of what they carried, and always at least a box for each gun they had, so a kill restocks you
  const carried = new Set(p.weapons.filter((w) => w).map((w) => WEAPON[w!.id].ammo as AmmoType));
  for (const [k, v] of Object.entries(p.ammo) as [AmmoType, number][]) {
    const n = Math.min(v, AMMO_PICKUP[k] * 2), min = carried.has(k) ? AMMO_PICKUP[k] : 0;
    if (Math.max(n, min) > 0) items.push({ kind: ItemKind.Ammo, ammo: k, n: Math.max(n, min) });
  }
  if (p.lethal) items.push({ kind: ItemKind.Lethal, lethal: p.lethal.type, n: p.lethal.n });
  if (p.tactical) items.push({ kind: ItemKind.Tactical, tactical: p.tactical.type, n: p.tactical.n });
  if (p.killstreak) items.push({ kind: ItemKind.Killstreak, killstreak: p.killstreak });
  if (p.selfRevive) items.push({ kind: ItemKind.SelfRevive });
  items.forEach((it, i) => {
    const a = (i / items.length) * Math.PI * 2, d = 0.7 + (i % 3) * 0.45;
    sim.dropItem(it, p.x + Math.cos(a) * d, p.y + 0.3, p.z + Math.sin(a) * d);
  });
  p.weapons = [null, null]; p.cash = 0; p.plates = 0; p.lethal = null; p.tactical = null; p.killstreak = null; p.selfRevive = false;
  for (const k of Object.keys(p.ammo)) (p.ammo as any)[k] = 0;

}
