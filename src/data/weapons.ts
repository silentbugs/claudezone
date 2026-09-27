/**
 * Weapon table. Numbers follow Warzone (2020) values where a source existed (see research notes);
 * the rest are estimates chosen to keep the real TTK relationships (ARs ~9 body shots on 250 HP,
 * heavy snipers one-shot headshot, SMGs fall off hard past ~15 m).
 */
export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'sniper' | 'marksman' | 'shotgun' | 'pistol' | 'launcher';
export type AmmoType = 'ar' | 'smg' | 'sniper' | 'shotgun' | 'pistol' | 'rocket';

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  ammo: AmmoType;
  /** damage bands: [range metres, chest damage]; last band extends forever */
  dmg: [number, number][];
  head: number; // multiplier
  limb: number;
  rpm: number;
  mag: number;
  magExt: number; // with extended mag (rare+ rarity)
  reload: number; // seconds
  adsTime: number; // seconds
  velocity: number; // m/s
  pellets?: number;
  spreadHip: number; // radians cone half-angle
  spreadAds: number;
  recoilV: number; // radians per shot vertical kick
  recoilH: number; // horizontal random
  auto: boolean;
  bolt?: boolean;
  zoom: number; // ADS fov multiplier (1 = none)
  scope?: boolean; // full-screen scope overlay
  mobility: number; // speed multiplier
  model: 'rifle' | 'bullpup' | 'smg' | 'lmg' | 'sniper' | 'shotgun' | 'pistol' | 'launcher' | 'marksman';
  splash?: { radius: number; damage: number };
  weight: number; // loot spawn weight
}

const cm = (m: number) => m; // clarity helper: metres

export const WEAPONS: WeaponDef[] = [
  { id: 'm4', name: 'M4A1', cls: 'ar', ammo: 'ar', dmg: [[cm(40), 28], [cm(70), 24], [999, 21]], head: 1.5, limb: 0.9, rpm: 833, mag: 30, magExt: 60, reload: 1.4, adsTime: 0.25, velocity: 880, spreadHip: 0.045, spreadAds: 0.0015, recoilV: 0.0042, recoilH: 0.0018, auto: true, zoom: 1.35, mobility: 0.95, model: 'rifle', weight: 10 },
  { id: 'grau', name: 'Grau 5.56', cls: 'ar', ammo: 'ar', dmg: [[cm(32), 29], [cm(60), 25], [999, 23]], head: 1.4, limb: 0.9, rpm: 750, mag: 30, magExt: 60, reload: 1.7, adsTime: 0.26, velocity: 1100, spreadHip: 0.045, spreadAds: 0.0012, recoilV: 0.0030, recoilH: 0.0010, auto: true, zoom: 1.35, mobility: 0.94, model: 'rifle', weight: 9 },
  { id: 'kilo', name: 'Kilo 141', cls: 'ar', ammo: 'ar', dmg: [[cm(40), 28], [cm(70), 24], [999, 22]], head: 1.5, limb: 0.9, rpm: 750, mag: 30, magExt: 60, reload: 1.35, adsTime: 0.267, velocity: 880, spreadHip: 0.045, spreadAds: 0.0013, recoilV: 0.0036, recoilH: 0.0012, auto: true, zoom: 1.35, mobility: 0.95, model: 'rifle', weight: 8 },
  { id: 'm13', name: 'M13', cls: 'ar', ammo: 'ar', dmg: [[cm(30), 28], [cm(60), 23], [999, 21]], head: 1.4, limb: 0.9, rpm: 857, mag: 30, magExt: 60, reload: 1.6, adsTime: 0.24, velocity: 910, spreadHip: 0.042, spreadAds: 0.0014, recoilV: 0.0033, recoilH: 0.0014, auto: true, zoom: 1.35, mobility: 0.96, model: 'rifle', weight: 7 },
  { id: 'ram7', name: 'RAM-7', cls: 'ar', ammo: 'ar', dmg: [[cm(30), 28], [cm(55), 24], [999, 22]], head: 1.4, limb: 0.9, rpm: 882, mag: 30, magExt: 50, reload: 1.6, adsTime: 0.245, velocity: 830, spreadHip: 0.04, spreadAds: 0.0016, recoilV: 0.0044, recoilH: 0.0018, auto: true, zoom: 1.3, mobility: 0.96, model: 'bullpup', weight: 6 },
  { id: 'fal', name: 'FAL', cls: 'ar', ammo: 'ar', dmg: [[cm(40), 54], [cm(70), 49], [999, 45]], head: 1.4, limb: 0.9, rpm: 625, mag: 20, magExt: 30, reload: 1.94, adsTime: 0.284, velocity: 875, spreadHip: 0.05, spreadAds: 0.001, recoilV: 0.0105, recoilH: 0.002, auto: false, zoom: 1.4, mobility: 0.93, model: 'rifle', weight: 5 },
  { id: 'oden', name: 'Oden', cls: 'ar', ammo: 'ar', dmg: [[cm(45), 60], [cm(80), 54], [999, 49]], head: 1.5, limb: 0.9, rpm: 390, mag: 20, magExt: 30, reload: 2.3, adsTime: 0.32, velocity: 790, spreadHip: 0.055, spreadAds: 0.0015, recoilV: 0.011, recoilH: 0.003, auto: true, zoom: 1.4, mobility: 0.9, model: 'bullpup', weight: 4 },
  { id: 'aug', name: 'AUG', cls: 'smg', ammo: 'smg', dmg: [[cm(15), 34], [cm(30), 30], [999, 26]], head: 1.4, limb: 0.9, rpm: 750, mag: 32, magExt: 60, reload: 1.57, adsTime: 0.25, velocity: 550, spreadHip: 0.032, spreadAds: 0.002, recoilV: 0.0032, recoilH: 0.0016, auto: true, zoom: 1.25, mobility: 0.99, model: 'bullpup', weight: 6 },
  { id: 'mp5', name: 'MP5', cls: 'smg', ammo: 'smg', dmg: [[cm(11), 34], [cm(25), 28], [999, 22]], head: 1.4, limb: 0.9, rpm: 800, mag: 30, magExt: 50, reload: 1.7, adsTime: 0.2, velocity: 470, spreadHip: 0.028, spreadAds: 0.0022, recoilV: 0.0028, recoilH: 0.0016, auto: true, zoom: 1.2, mobility: 1.0, model: 'smg', weight: 9 },
  { id: 'mp7', name: 'MP7', cls: 'smg', ammo: 'smg', dmg: [[cm(15), 25], [cm(30), 22], [999, 19]], head: 1.4, limb: 0.9, rpm: 950, mag: 40, magExt: 60, reload: 1.49, adsTime: 0.2, velocity: 540, spreadHip: 0.026, spreadAds: 0.0022, recoilV: 0.0022, recoilH: 0.0014, auto: true, zoom: 1.2, mobility: 1.0, model: 'smg', weight: 9 },
  { id: 'bruen', name: 'Bruen Mk9', cls: 'lmg', ammo: 'ar', dmg: [[cm(40), 32], [cm(80), 28], [999, 27]], head: 1.4, limb: 0.9, rpm: 750, mag: 60, magExt: 100, reload: 6.5, adsTime: 0.4, velocity: 830, spreadHip: 0.065, spreadAds: 0.0016, recoilV: 0.0030, recoilH: 0.0018, auto: true, zoom: 1.4, mobility: 0.88, model: 'lmg', weight: 4 },
  { id: 'mg34', name: 'MG34', cls: 'lmg', ammo: 'ar', dmg: [[cm(45), 36], [cm(80), 32], [999, 30]], head: 1.4, limb: 0.9, rpm: 880, mag: 50, magExt: 100, reload: 8, adsTime: 0.47, velocity: 900, spreadHip: 0.07, spreadAds: 0.0018, recoilV: 0.0045, recoilH: 0.0025, auto: true, zoom: 1.4, mobility: 0.86, model: 'lmg', weight: 3 },
  { id: 'hdr', name: 'HDR', cls: 'sniper', ammo: 'sniper', dmg: [[cm(45), 112], [999, 91]], head: 2.3, limb: 0.9, rpm: 31.5, mag: 5, magExt: 9, reload: 4.4, adsTime: 0.3, velocity: 1100, spreadHip: 0.08, spreadAds: 0, recoilV: 0.03, recoilH: 0.004, auto: false, bolt: true, zoom: 5.5, scope: true, mobility: 0.87, model: 'sniper', weight: 3 },
  { id: 'ax50', name: 'AX-50', cls: 'sniper', ammo: 'sniper', dmg: [[cm(45), 112], [999, 91]], head: 2.3, limb: 0.9, rpm: 40, mag: 5, magExt: 7, reload: 4.15, adsTime: 0.293, velocity: 950, spreadHip: 0.08, spreadAds: 0, recoilV: 0.03, recoilH: 0.004, auto: false, bolt: true, zoom: 5, scope: true, mobility: 0.88, model: 'sniper', weight: 3 },
  { id: 'kar98', name: 'Kar98k', cls: 'marksman', ammo: 'sniper', dmg: [[cm(45), 115], [999, 100]], head: 2.2, limb: 0.9, rpm: 47, mag: 5, magExt: 5, reload: 2.5, adsTime: 0.25, velocity: 810, spreadHip: 0.07, spreadAds: 0, recoilV: 0.025, recoilH: 0.003, auto: false, bolt: true, zoom: 3.2, scope: true, mobility: 0.93, model: 'marksman', weight: 4 },
  { id: 'm680', name: 'Model 680', cls: 'shotgun', ammo: 'shotgun', dmg: [[cm(6), 30], [cm(12), 18], [999, 6]], head: 1.2, limb: 1, rpm: 71, mag: 6, magExt: 8, reload: 3.3, adsTime: 0.23, velocity: 400, pellets: 8, spreadHip: 0.06, spreadAds: 0.045, recoilV: 0.03, recoilH: 0.005, auto: false, zoom: 1.15, mobility: 0.96, model: 'shotgun', weight: 4 },
  { id: 'deagle', name: '.50 GS', cls: 'pistol', ammo: 'pistol', dmg: [[cm(15), 60], [cm(30), 50], [999, 40]], head: 1.5, limb: 0.9, rpm: 300, mag: 7, magExt: 13, reload: 1.8, adsTime: 0.2, velocity: 450, spreadHip: 0.035, spreadAds: 0.003, recoilV: 0.02, recoilH: 0.004, auto: false, zoom: 1.15, mobility: 1.02, model: 'pistol', weight: 3 },
  { id: 'm1911', name: '1911', cls: 'pistol', ammo: 'pistol', dmg: [[cm(12), 35], [cm(25), 30], [999, 25]], head: 1.5, limb: 0.9, rpm: 460, mag: 8, magExt: 10, reload: 1.6, adsTime: 0.17, velocity: 400, spreadHip: 0.03, spreadAds: 0.003, recoilV: 0.012, recoilH: 0.003, auto: false, zoom: 1.12, mobility: 1.02, model: 'pistol', weight: 5 },
  { id: 'x16', name: 'X16', cls: 'pistol', ammo: 'pistol', dmg: [[cm(10), 30], [cm(22), 25], [999, 20]], head: 1.4, limb: 0.9, rpm: 600, mag: 15, magExt: 21, reload: 1.5, adsTime: 0.17, velocity: 400, spreadHip: 0.03, spreadAds: 0.003, recoilV: 0.008, recoilH: 0.003, auto: false, zoom: 1.12, mobility: 1.02, model: 'pistol', weight: 5 },
  { id: 'rpg', name: 'RPG-7', cls: 'launcher', ammo: 'rocket', dmg: [[999, 150]], head: 1, limb: 1, rpm: 30, mag: 1, magExt: 1, reload: 4.5, adsTime: 0.45, velocity: 120, spreadHip: 0.02, spreadAds: 0.004, recoilV: 0.03, recoilH: 0.004, auto: false, zoom: 1.3, mobility: 0.85, model: 'launcher', splash: { radius: 6, damage: 180 }, weight: 1.2 },
];
export const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w])) as Record<string, WeaponDef>;

export const enum Rarity { Common = 0, Uncommon = 1, Rare = 2, Epic = 3, Legendary = 4 }
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
export const RARITY_COLORS = ['#d8d8d8', '#5fd35f', '#4aa3ff', '#b45cff', '#ffb52e'];

/** Attachment effects scale with rarity: more attachments, better handling. */
export function rarityMods(r: number) {
  return {
    extMag: r >= 2,
    recoil: 1 - r * 0.07,
    spread: 1 - r * 0.05,
    range: 1 + r * 0.06,
    velocity: 1 + r * 0.08,
    ads: 1 - r * 0.02,
    scope: r >= 3,
  };
}

export const AMMO_PICKUP: Record<AmmoType, number> = { ar: 30, smg: 40, sniper: 5, shotgun: 8, pistol: 24, rocket: 1 };
export const AMMO_MAX: Record<AmmoType, number> = { ar: 240, smg: 240, sniper: 30, shotgun: 32, pistol: 120, rocket: 3 };

export function damageAt(def: WeaponDef, dist: number, rangeMul = 1): number {
  for (const [r, d] of def.dmg) if (dist <= r * rangeMul) return d;
  return def.dmg[def.dmg.length - 1][1];
}
