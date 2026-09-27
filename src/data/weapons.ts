/**
 * The Warzone (2020) arsenal: every Modern Warfare weapon available in Verdansk before December
 * 2020, plus the Black Ops Cold War weapons integrated on 16 Dec 2020. Damage bands, RPM, mags and
 * handling follow the launch-era stat sheets (see research notes); velocities are estimates.
 * Warzone ammo pools: Heavy (ARs, LMGs, EBR-14), Light (SMGs, pistols), Sniper, Shotgun, Rockets.
 */
export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'sniper' | 'marksman' | 'shotgun' | 'pistol' | 'launcher' | 'melee' | 'tactical';
export type AmmoType = 'heavy' | 'light' | 'sniper' | 'shotgun' | 'rocket';
export const AMMO_NAMES: Record<AmmoType, string> = { heavy: 'Heavy Ammo', light: 'Light Ammo', sniper: 'Sniper Ammo', shotgun: 'Shotgun Ammo', rocket: 'Rockets' };

/** Side-view silhouette, used for the first-person model, loot model and HUD icon. */
export interface Look {
  recv: number; barrel: number; guard: number; guardW?: number;
  mag: 'curve' | 'straight' | 'long' | 'box' | 'drum' | 'grip' | 'none' | 'tube' | 'top' | 'helical' | 'pan';
  magLen?: number; stock: 'full' | 'tube' | 'fold' | 'none' | 'wood' | 'thumbhole';
  bull?: boolean; wood?: boolean; jacket?: boolean; bipod?: boolean; scope?: 'tube' | 'aug' | 'none'; slide?: number; revolver?: boolean; tubeDia?: number; knife?: boolean; melee?: 'knife' | 'shield' | 'sticks' | 'kodachi';
}

export interface WeaponDef {
  id: string; name: string; cls: WeaponClass; ammo: AmmoType; family: 'MW' | 'CW'; season: string;
  dmg: [number, number][]; head: number; limb: number;
  rpm: number; mag: number; magExt: number; reload: number; adsTime: number; velocity: number;
  pellets?: number; burst?: number; burstRpm?: number;
  spreadHip: number; spreadAds: number; recoilV: number; recoilH: number;
  auto: boolean; bolt?: boolean; pump?: boolean;
  zoom: number; scope?: boolean; mobility: number;
  model: 'rifle' | 'bullpup' | 'smg' | 'lmg' | 'sniper' | 'shotgun' | 'pistol' | 'launcher' | 'marksman' | 'melee';
  look: Look;
  splash?: { radius: number; damage: number };
  melee?: { range: number; damage: number };
  weight: number;
}

type Row = [id: string, name: string, cls: WeaponClass, season: string, dmg: [number, number][], head: number, rpm: number, mag: number, magExt: number, reload: number, adsMs: number, vel: number, look: Look, extra?: Partial<WeaponDef>];

const CLS: Record<WeaponClass, { ammo: AmmoType; hip: number; ads: number; rv: number; rh: number; zoom: number; mob: number; model: WeaponDef['model']; weight: number }> = {
  ar: { ammo: 'heavy', hip: 0.045, ads: 0.0014, rv: 0.0038, rh: 0.0015, zoom: 1.35, mob: 0.95, model: 'rifle', weight: 1 },
  smg: { ammo: 'light', hip: 0.028, ads: 0.0022, rv: 0.0028, rh: 0.0016, zoom: 1.2, mob: 1.0, model: 'smg', weight: 1 },
  lmg: { ammo: 'heavy', hip: 0.065, ads: 0.0017, rv: 0.0036, rh: 0.002, zoom: 1.4, mob: 0.87, model: 'lmg', weight: 0.6 },
  marksman: { ammo: 'sniper', hip: 0.06, ads: 0.0006, rv: 0.018, rh: 0.003, zoom: 2.6, mob: 0.93, model: 'marksman', weight: 0.6 },
  sniper: { ammo: 'sniper', hip: 0.08, ads: 0, rv: 0.03, rh: 0.004, zoom: 5.5, mob: 0.87, model: 'sniper', weight: 0.45 },
  shotgun: { ammo: 'shotgun', hip: 0.06, ads: 0.045, rv: 0.03, rh: 0.005, zoom: 1.15, mob: 0.96, model: 'shotgun', weight: 0.6 },
  pistol: { ammo: 'light', hip: 0.03, ads: 0.003, rv: 0.012, rh: 0.003, zoom: 1.12, mob: 1.02, model: 'pistol', weight: 0.8 },
  launcher: { ammo: 'rocket', hip: 0.02, ads: 0.004, rv: 0.03, rh: 0.004, zoom: 1.3, mob: 0.85, model: 'launcher', weight: 0.25 },
  melee: { ammo: 'light', hip: 0, ads: 0, rv: 0, rh: 0, zoom: 1, mob: 1.05, model: 'melee', weight: 0.15 },
  tactical: { ammo: 'heavy', hip: 0.05, ads: 0.0012, rv: 0.009, rh: 0.002, zoom: 1.45, mob: 0.94, model: 'rifle', weight: 0.8 },
};

// look presets
const L = {
  m4: { recv: 0.36, barrel: 0.34, guard: 0.26, mag: 'curve', magLen: 0.15, stock: 'tube' },
  ak: { recv: 0.4, barrel: 0.34, guard: 0.24, mag: 'curve', magLen: 0.19, stock: 'full', wood: true },
  bull: { recv: 0.52, barrel: 0.2, guard: 0.16, mag: 'curve', magLen: 0.14, stock: 'none', bull: true },
  smg: { recv: 0.3, barrel: 0.12, guard: 0.18, mag: 'curve', magLen: 0.17, stock: 'tube' },
  pist: (s: number, rev = false): Look => ({ recv: 0.19, barrel: 0, guard: 0, mag: 'none', stock: 'none', slide: s, revolver: rev }),
} as const;
const lk = (base: Partial<Look>, o: Partial<Look> = {}): Look => ({ recv: 0.36, barrel: 0.3, guard: 0.25, mag: 'curve', stock: 'full', ...base, ...o } as Look);

const R = (a: number, b: number): [number, number] => [a, b];
const INF = 999;

const ROWS: Row[] = [
  // ------------------------------------------------ Assault rifles (MW)
  ['kilo', 'Kilo 141', 'ar', 'Launch', [R(32.5, 28), R(55, 23), R(INF, 18)], 1.5, 751, 30, 60, 1.34, 267, 830, lk(L.m4, { mag: 'straight', stock: 'full', guardW: 0.062 })],
  ['fal', 'FAL', 'ar', 'Launch', [R(45, 54), R(INF, 40)], 1.35, 480, 20, 30, 1.94, 284, 880, lk({ recv: 0.42, barrel: 0.42, guard: 0.3, mag: 'straight', magLen: 0.13, stock: 'full' }), { auto: false }],
  ['m4', 'M4A1', 'ar', 'Launch', [R(30, 28), R(50, 22), R(INF, 18)], 1.5, 800, 30, 60, 1.39, 250, 880, lk(L.m4)],
  ['fr556', 'FR 5.56', 'ar', 'Launch', [R(32.5, 40), R(INF, 32)], 1.6, 1250, 30, 60, 2.38, 317, 900, lk(L.bull, { recv: 0.5 }), { burst: 3, burstRpm: 451, auto: false }],
  ['oden', 'Oden', 'ar', 'Launch', [R(32.5, 62), R(INF, 46)], 1.25, 410, 20, 30, 1.95, 367, 750, lk(L.bull, { recv: 0.58, barrel: 0.3, mag: 'straight', guardW: 0.075 })],
  ['m13', 'M13', 'ar', 'Launch', [R(37.5, 24), R(INF, 19)], 1.5, 900, 30, 60, 1.3, 250, 840, lk(L.m4, { recv: 0.32, barrel: 0.24, stock: 'fold' })],
  ['scar', 'FN Scar 17', 'ar', 'Launch', [R(32.5, 35), R(INF, 32)], 1.6, 575, 20, 30, 1.44, 350, 850, lk({ recv: 0.4, barrel: 0.38, guard: 0.3, mag: 'straight', magLen: 0.13, stock: 'fold' })],
  ['ak47', 'AK-47', 'ar', 'Launch', [R(27.5, 42), R(INF, 38)], 1.33, 555, 30, 40, 1.38, 300, 720, lk(L.ak)],
  ['ram7', 'RAM-7', 'ar', 'Season 1', [R(27.5, 28), R(47.5, 23), R(INF, 18)], 1.5, 860, 30, 50, 1.62, 234, 850, lk(L.bull)],
  ['grau', 'Grau 5.56', 'ar', 'Season 2', [R(31.5, 29), R(55, 23), R(INF, 18)], 1.5, 730, 30, 60, 1.32, 234, 910, lk(L.m4, { guard: 0.36, stock: 'fold' })],
  ['amax', 'CR-56 AMAX', 'ar', 'Season 4', [R(20, 35), R(40, 32), R(60, 28), R(INF, 24)], 1.6, 630, 30, 45, 2.0, 300, 850, lk(L.ak, { wood: false, stock: 'fold' })],
  ['an94', 'AN-94', 'ar', 'Season 5', [R(25, 29), R(45, 24), R(65, 22), R(INF, 18)], 1.6, 571, 30, 60, 1.52, 280, 850, lk(L.ak, { wood: false, mag: 'curve', stock: 'fold', barrel: 0.36 })],
  ['asval', 'AS VAL', 'ar', 'Season 6', [R(31.25, 30), R(INF, 23)], 1.57, 885, 20, 30, 1.5, 250, 520, lk({ recv: 0.34, barrel: 0.22, guard: 0.22, guardW: 0.07, mag: 'straight', magLen: 0.12, stock: 'fold', jacket: true })],
  // ------------------------------------------------ Submachine guns (MW)
  ['aug', 'AUG', 'smg', 'Launch', [R(12.5, 34), R(25, 22), R(35, 18), R(INF, 16)], 1.6, 740, 25, 32, 1.57, 250, 600, lk(L.bull, { scope: 'aug' })],
  ['p90', 'P90', 'smg', 'Launch', [R(10, 25), R(20, 18), R(30, 16), R(INF, 13)], 1.6, 900, 50, 50, 2.09, 200, 550, lk({ recv: 0.46, barrel: 0.06, guard: 0.1, mag: 'top', stock: 'none', bull: true })],
  ['mp5', 'MP5', 'smg', 'Launch', [R(9.5, 34), R(22, 22), R(INF, 19)], 1.45, 800, 30, 45, 1.7, 200, 500, lk(L.smg)],
  ['uzi', 'Uzi', 'smg', 'Launch', [R(10, 34), R(20, 22), R(30, 19), R(INF, 17)], 1.6, 600, 32, 50, 1.47, 184, 450, lk({ recv: 0.26, barrel: 0.08, guard: 0.08, mag: 'grip', magLen: 0.18, stock: 'fold' })],
  ['bizon', 'PP19 Bizon', 'smg', 'Launch', [R(10, 34), R(20, 22), R(30, 18), R(INF, 17)], 1.6, 660, 64, 84, 1.72, 234, 450, lk(L.ak, { wood: false, mag: 'helical', stock: 'fold', barrel: 0.14 })],
  ['mp7', 'MP7', 'smg', 'Launch', [R(15, 25), R(30, 18), R(45, 16), R(INF, 14)], 1.6, 950, 40, 60, 1.3, 200, 550, lk({ recv: 0.24, barrel: 0.1, guard: 0.1, mag: 'grip', magLen: 0.2, stock: 'fold' })],
  ['striker', 'Striker 45', 'smg', 'Season 2', [R(22.5, 34), R(40, 25), R(50, 22), R(INF, 19)], 1.6, 603, 25, 45, 1.7, 200, 470, lk(L.smg, { mag: 'straight', guard: 0.22, stock: 'full' })],
  ['fennec', 'Fennec', 'smg', 'Season 4', [R(9, 22), R(15, 18), R(25, 16), R(INF, 13)], 1.8, 1085, 25, 40, 2.1, 184, 460, lk({ recv: 0.34, barrel: 0.08, guard: 0.12, guardW: 0.07, mag: 'straight', magLen: 0.12, stock: 'fold' })],
  ['iso', 'ISO', 'smg', 'Season 5', [R(15, 25), R(INF, 21)], 1.5, 882, 20, 50, 1.3, 200, 500, lk(L.smg, { mag: 'straight', stock: 'fold' })],
  // ------------------------------------------------ Light machine guns (MW)
  ['pkm', 'PKM', 'lmg', 'Launch', [R(40, 34), R(INF, 30)], 1.35, 750, 100, 200, 7.9, 434, 825, lk({ recv: 0.48, barrel: 0.5, guard: 0.1, mag: 'box', stock: 'thumbhole', wood: true, bipod: true })],
  ['sa87', 'SA87', 'lmg', 'Launch', [R(50, 34), R(INF, 30)], 1.35, 600, 30, 60, 2.24, 434, 850, lk(L.bull, { recv: 0.6, barrel: 0.32, mag: 'straight', bipod: true })],
  ['m91', 'M91', 'lmg', 'Launch', [R(45, 34), R(INF, 30)], 1.35, 660, 100, 150, 6.09, 450, 880, lk({ recv: 0.46, barrel: 0.46, guard: 0.3, mag: 'box', stock: 'full', bipod: true })],
  ['mg34', 'MG34', 'lmg', 'Launch', [R(32.5, 34), R(INF, 30)], 1.35, 870, 50, 100, 7.76, 467, 800, lk({ recv: 0.42, barrel: 0.5, guard: 0.3, guardW: 0.05, mag: 'drum', stock: 'wood', wood: true, jacket: true, bipod: true })],
  ['holger', 'Holger-26', 'lmg', 'Season 1', [R(45, 28), R(65, 23), R(INF, 18)], 1.5, 720, 100, 100, 2.52, 450, 850, lk(L.m4, { mag: 'drum', stock: 'full', bipod: true })],
  ['bruen', 'Bruen Mk9', 'lmg', 'Season 3', [R(40, 31), R(70, 28), R(INF, 22)], 1.48, 752, 100, 200, 7.77, 450, 880, lk({ recv: 0.46, barrel: 0.46, guard: 0.3, guardW: 0.065, mag: 'box', stock: 'full', bipod: true })],
  ['finn', 'FiNN LMG', 'lmg', 'Season 5', [R(40, 28), R(70, 22), R(INF, 21)], 1.3, 630, 75, 100, 4.92, 450, 880, lk({ recv: 0.44, barrel: 0.4, guard: 0.28, mag: 'box', stock: 'full', bipod: true })],
  // ------------------------------------------------ Marksman rifles (MW)
  ['ebr', 'EBR-14', 'marksman', 'Launch', [R(INF, 60)], 2.75, 262, 10, 20, 1.34, 317, 900, lk({ recv: 0.42, barrel: 0.46, guard: 0.3, mag: 'straight', magLen: 0.1, stock: 'full' }), { ammo: 'heavy', auto: false, zoom: 2.2 }],
  ['mk2', 'MK2 Carbine', 'marksman', 'Launch', [R(40, 108), R(INF, 90)], 1.35, 90, 6, 6, 3.4, 267, 850, lk({ recv: 0.36, barrel: 0.4, guard: 0.3, mag: 'tube', stock: 'wood', wood: true }), { auto: false, bolt: true, zoom: 1.5 }],
  ['kar98', 'Kar98k', 'marksman', 'Launch', [R(INF, 86)], 2.0, 40, 5, 5, 3.56, 367, 790, lk({ recv: 0.5, barrel: 0.5, guard: 0.4, guardW: 0.05, mag: 'none', stock: 'wood', wood: true, scope: 'tube' }), { auto: false, bolt: true, zoom: 3.2, scope: true }],
  ['crossbow', 'Crossbow', 'marksman', 'Season 1', [R(INF, 101)], 2.97, 14, 1, 1, 3.2, 300, 100, lk({ recv: 0.44, barrel: 0.1, guard: 0.2, mag: 'none', stock: 'thumbhole' }), { auto: false, bolt: true, zoom: 1.6 }],
  ['sks', 'SKS', 'marksman', 'Season 3', [R(40, 48), R(INF, 46)], 3.64, 315, 20, 30, 1.55, 300, 750, lk({ recv: 0.4, barrel: 0.44, guard: 0.32, mag: 'straight', magLen: 0.1, stock: 'wood', wood: true }), { auto: false, zoom: 1.6 }],
  ['spr', 'SP-R 208', 'marksman', 'Season 6', [R(40, 94), R(INF, 50)], 3.0, 47, 5, 10, 2.0, 400, 800, lk({ recv: 0.5, barrel: 0.5, guard: 0.36, mag: 'straight', magLen: 0.08, stock: 'full', scope: 'tube' }), { auto: false, bolt: true, zoom: 3.6, scope: true }],
  // ------------------------------------------------ Sniper rifles (MW)
  ['dragunov', 'Dragunov', 'sniper', 'Launch', [R(INF, 136)], 1.03, 170, 10, 20, 2.14, 257, 830, lk({ recv: 0.5, barrel: 0.52, guard: 0.3, mag: 'curve', magLen: 0.1, stock: 'thumbhole', wood: true, scope: 'tube' }), { auto: false, zoom: 4.2, scope: true }],
  ['hdr', 'HDR', 'sniper', 'Launch', [R(45, 112), R(INF, 91)], 1.91, 32, 5, 9, 2.72, 300, 1000, lk({ recv: 0.45, barrel: 0.7, guard: 0.3, mag: 'straight', magLen: 0.09, stock: 'full', scope: 'tube', bipod: true }), { auto: false, bolt: true, scope: true }],
  ['ax50', 'AX-50', 'sniper', 'Launch', [R(45, 112), R(INF, 91)], 1.91, 40, 5, 9, 2.27, 293, 880, lk({ recv: 0.45, barrel: 0.62, guard: 0.28, mag: 'straight', magLen: 0.1, stock: 'full', scope: 'tube' }), { auto: false, bolt: true, scope: true, zoom: 5 }],
  ['rytec', 'Rytec AMR', 'sniper', 'Season 4', [R(INF, 90)], 3.0, 165, 5, 5, 3.09, 400, 1000, lk({ recv: 0.5, barrel: 0.66, guard: 0.3, guardW: 0.07, mag: 'straight', magLen: 0.12, stock: 'full', scope: 'tube', bipod: true }), { auto: false, scope: true }],
  // ------------------------------------------------ Shotguns (MW) — damage per pellet
  ['m680', 'Model 680', 'shotgun', 'Launch', [R(5, 40), R(10, 24), R(INF, 6)], 1.1, 75, 8, 12, 3.3, 310, 400, lk({ recv: 0.3, barrel: 0.52, guard: 0.14, mag: 'tube', stock: 'wood', wood: true }), { pellets: 8, auto: false, pump: true }],
  ['r90', 'R9-0', 'shotgun', 'Launch', [R(5, 26), R(10, 16), R(INF, 5)], 1.1, 280, 14, 18, 3.0, 290, 400, lk({ recv: 0.34, barrel: 0.44, guard: 0.16, mag: 'tube', stock: 'full' }), { pellets: 8, auto: false, burst: 2, burstRpm: 280, pump: true }],
  ['725', '725', 'shotgun', 'Launch', [R(8, 38), R(16, 22), R(INF, 5)], 1.1, 154, 2, 2, 1.32, 300, 400, lk({ recv: 0.24, barrel: 0.58, guard: 0.2, mag: 'none', stock: 'wood', wood: true }), { pellets: 8, auto: false }],
  ['origin', 'Origin 12', 'shotgun', 'Launch', [R(5, 26), R(10, 16), R(INF, 5)], 1.1, 250, 8, 25, 1.34, 300, 400, lk({ recv: 0.36, barrel: 0.36, guard: 0.2, mag: 'straight', magLen: 0.12, stock: 'fold' }), { pellets: 8, auto: false }],
  ['vlk', 'VLK Rogue', 'shotgun', 'Season 2', [R(5, 38), R(10, 20), R(INF, 4)], 1.1, 135, 8, 12, 1.9, 300, 400, lk({ recv: 0.38, barrel: 0.36, guard: 0.22, guardW: 0.07, mag: 'straight', magLen: 0.1, stock: 'full' }), { pellets: 8, auto: false }],
  ['jak12', 'JAK-12', 'shotgun', 'Season 6', [R(3.3, 26), R(10, 12), R(INF, 1)], 1.1, 315, 8, 32, 1.64, 300, 400, lk({ recv: 0.36, barrel: 0.34, guard: 0.22, mag: 'drum', stock: 'fold' }), { pellets: 8 }],
  // ------------------------------------------------ Handguns (MW)
  ['x16', 'X16', 'pistol', 'Launch', [R(12, 42), R(25, 28), R(INF, 23)], 1.7, 300, 13, 26, 1.1, 100, 380, L.pist(0.04), { auto: false }],
  ['m1911', '1911', 'pistol', 'Launch', [R(12, 42), R(25, 28), R(INF, 23)], 1.7, 280, 7, 15, 1.02, 107, 300, L.pist(0.035), { auto: false }],
  ['357', '.357', 'pistol', 'Launch', [R(15, 77), R(30, 48), R(INF, 47)], 1.47, 130, 6, 6, 2.0, 167, 400, L.pist(0.045, true), { auto: false }],
  ['m19', 'M19', 'pistol', 'Launch', [R(12, 42), R(25, 28), R(INF, 23)], 1.7, 300, 17, 32, 1.07, 100, 380, L.pist(0.038), { auto: false }],
  ['deagle', '.50 GS', 'pistol', 'Launch', [R(15, 77), R(30, 65), R(INF, 55)], 1.47, 175, 7, 13, 1.2, 160, 450, L.pist(0.05), { auto: false }],
  ['renetti', 'Renetti', 'pistol', 'Season 3', [R(12, 41), R(25, 28), R(INF, 18)], 1.78, 315, 15, 27, 1.03, 110, 380, L.pist(0.038), { auto: false }],
  // ------------------------------------------------ Launchers (MW)
  ['rpg', 'RPG-7', 'launcher', 'Launch', [R(INF, 150)], 1, 30, 1, 1, 4.5, 450, 110, lk({ recv: 0.2, barrel: 0.9, guard: 0, mag: 'none', stock: 'none', tubeDia: 0.045 }), { auto: false, splash: { radius: 6.5, damage: 180 } }],
  ['pila', 'PILA', 'launcher', 'Launch', [R(INF, 150)], 1, 30, 1, 1, 4.49, 500, 140, lk({ recv: 0.2, barrel: 1.0, guard: 0, mag: 'none', stock: 'none', tubeDia: 0.06 }), { auto: false, splash: { radius: 6, damage: 155 } }],
  ['strela', 'Strela-P', 'launcher', 'Launch', [R(INF, 150)], 1, 30, 1, 1, 4.46, 450, 220, lk({ recv: 0.2, barrel: 0.95, guard: 0, mag: 'none', stock: 'none', tubeDia: 0.05 }), { auto: false, splash: { radius: 5, damage: 100 } }],
  ['jokr', 'JOKR', 'launcher', 'Launch', [R(INF, 150)], 1, 30, 1, 1, 2.07, 550, 120, lk({ recv: 0.2, barrel: 1.0, guard: 0, mag: 'none', stock: 'none', tubeDia: 0.07 }), { auto: false, splash: { radius: 5.5, damage: 160 } }],
  ['mgl', 'MGL-32', 'launcher', 'Loot', [R(INF, 60)], 1, 200, 6, 6, 6, 350, 60, lk({ recv: 0.3, barrel: 0.3, guard: 0.1, mag: 'drum', stock: 'fold', tubeDia: 0.03 }), { auto: false, splash: { radius: 5, damage: 150 }, weight: 0.08 }],
  // ------------------------------------------------ Melee
  ['knife', 'Combat Knife', 'melee', 'Launch', [R(INF, 0)], 1, 70, 0, 0, 0, 100, 0, { recv: 0.25, barrel: 0, guard: 0, mag: 'none', stock: 'none', knife: true, melee: 'knife' }, { melee: { range: 2.3, damage: 135 } }],
  ['riotshield', 'Riot Shield', 'melee', 'Launch', [R(INF, 0)], 1, 60, 0, 0, 0, 100, 0, { recv: 0.25, barrel: 0, guard: 0, mag: 'none', stock: 'none', knife: true, melee: 'shield' }, { melee: { range: 2.4, damage: 75 }, mobility: 0.9 }],
  ['kali', 'Kali Sticks', 'melee', 'Season 4', [R(INF, 0)], 1, 90, 0, 0, 0, 100, 0, { recv: 0.25, barrel: 0, guard: 0, mag: 'none', stock: 'none', knife: true, melee: 'sticks' }, { melee: { range: 2.2, damage: 90 }, mobility: 1.07 }],
  ['kodachi', 'Dual Kodachis', 'melee', 'Season 5', [R(INF, 0)], 1, 80, 0, 0, 0, 100, 0, { recv: 0.25, barrel: 0, guard: 0, mag: 'none', stock: 'none', knife: true, melee: 'kodachi' }, { melee: { range: 2.4, damage: 125 }, mobility: 1.06 }],
  // ------------------------------------------------ Black Ops Cold War (Dec 16 2020 integration)
  ['xm4', 'XM4', 'ar', 'Cold War', [R(40, 30), R(INF, 25)], 1.4, 722, 30, 60, 1.6, 270, 860, lk(L.m4, { stock: 'full' }), { family: 'CW' }],
  ['ak47cw', 'AK-47 (Cold War)', 'ar', 'Cold War', [R(35, 38), R(INF, 30)], 1.4, 600, 30, 60, 1.7, 300, 740, lk(L.ak), { family: 'CW' }],
  ['krig', 'Krig 6', 'ar', 'Cold War', [R(45, 33), R(INF, 27)], 1.4, 652, 30, 60, 1.7, 290, 860, lk(L.bull, { recv: 0.5 }), { family: 'CW' }],
  ['qbz', 'QBZ-83', 'ar', 'Cold War', [R(40, 32), R(INF, 26)], 1.4, 681, 30, 60, 1.7, 280, 850, lk(L.m4, { mag: 'straight', stock: 'fold' }), { family: 'CW' }],
  ['ffar', 'FFAR 1', 'ar', 'Cold War', [R(15, 30), R(INF, 22)], 1.4, 909, 25, 50, 1.8, 260, 800, lk(L.m4, { recv: 0.4, mag: 'straight', stock: 'full' }), { family: 'CW' }],
  ['groza', 'Groza', 'ar', 'Cold War', [R(35, 34), R(INF, 28)], 1.4, 750, 30, 60, 1.8, 270, 750, lk(L.bull, { recv: 0.48, barrel: 0.18 }), { family: 'CW' }],
  ['m16', 'M16', 'tactical', 'Cold War', [R(40, 40), R(INF, 32)], 1.4, 800, 30, 60, 1.8, 290, 900, lk(L.m4, { barrel: 0.46, stock: 'full' }), { family: 'CW', burst: 3, burstRpm: 350, auto: false }],
  ['augcw', 'AUG (Cold War)', 'tactical', 'Cold War', [R(45, 54), R(INF, 44)], 1.4, 857, 30, 54, 1.8, 290, 900, lk(L.bull, { scope: 'aug' }), { family: 'CW', burst: 4, burstRpm: 240, auto: false }],
  ['type63', 'Type 63', 'tactical', 'Cold War', [R(45, 68), R(INF, 55)], 1.4, 327, 25, 50, 1.9, 300, 800, lk(L.ak, { stock: 'wood', barrel: 0.46 }), { family: 'CW', auto: false }],
  ['dmr14', 'DMR 14', 'tactical', 'Cold War', [R(45, 58), R(INF, 48)], 1.4, 361, 20, 40, 1.9, 300, 900, lk({ recv: 0.4, barrel: 0.44, guard: 0.3, mag: 'straight', magLen: 0.12, stock: 'wood', wood: true }), { family: 'CW', auto: false }],
  ['mp5cw', 'MP5 (Cold War)', 'smg', 'Cold War', [R(12, 32), R(INF, 23)], 1.4, 857, 30, 50, 1.8, 200, 480, lk(L.smg), { family: 'CW' }],
  ['milano', 'Milano 821', 'smg', 'Cold War', [R(12, 32), R(INF, 23)], 1.4, 800, 30, 50, 1.8, 210, 480, lk(L.smg, { mag: 'straight', stock: 'fold' }), { family: 'CW' }],
  ['ak74u', 'AK-74u', 'smg', 'Cold War', [R(12, 38), R(INF, 27)], 1.4, 697, 30, 50, 1.8, 220, 520, lk(L.ak, { barrel: 0.12, guard: 0.16, stock: 'fold', wood: true }), { family: 'CW' }],
  ['ksp', 'KSP 45', 'smg', 'Cold War', [R(18, 50), R(INF, 35)], 1.4, 722, 30, 48, 1.8, 210, 500, lk(L.smg, { mag: 'straight', stock: 'full' }), { family: 'CW', burst: 3, burstRpm: 280, auto: false }],
  ['bullfrog', 'Bullfrog', 'smg', 'Cold War', [R(12, 34), R(INF, 24)], 1.4, 750, 50, 85, 2.0, 220, 470, lk(L.ak, { wood: false, mag: 'helical', stock: 'fold', barrel: 0.12 }), { family: 'CW' }],
  ['mac10', 'MAC-10', 'smg', 'Cold War', [R(11, 27), R(INF, 22)], 1.4, 1111, 32, 53, 1.7, 180, 450, lk({ recv: 0.22, barrel: 0.08, guard: 0.06, mag: 'grip', magLen: 0.18, stock: 'fold' }), { family: 'CW' }],
  ['stoner', 'Stoner 63', 'lmg', 'Cold War', [R(45, 38), R(INF, 30)], 1.4, 722, 75, 150, 5.5, 400, 860, lk({ recv: 0.44, barrel: 0.42, guard: 0.3, mag: 'box', stock: 'full', bipod: true }), { family: 'CW' }],
  ['rpd', 'RPD', 'lmg', 'Cold War', [R(45, 38), R(INF, 32)], 1.4, 625, 75, 150, 6.5, 450, 820, lk({ recv: 0.44, barrel: 0.5, guard: 0.3, mag: 'drum', stock: 'wood', wood: true, bipod: true }), { family: 'CW' }],
  ['m60', 'M60', 'lmg', 'Cold War', [R(45, 50), R(INF, 40)], 1.4, 517, 100, 150, 7, 480, 850, lk({ recv: 0.46, barrel: 0.52, guard: 0.3, mag: 'box', stock: 'full', bipod: true }), { family: 'CW' }],
  ['pelington', 'Pelington 703', 'sniper', 'Cold War', [R(INF, 110)], 2.0, 54, 5, 9, 3.0, 330, 950, lk({ recv: 0.5, barrel: 0.6, guard: 0.36, mag: 'none', stock: 'wood', wood: true, scope: 'tube' }), { family: 'CW', auto: false, bolt: true, scope: true }],
  ['tundra', 'LW3 Tundra', 'sniper', 'Cold War', [R(INF, 110)], 2.0, 50, 5, 9, 3.0, 320, 1100, lk({ recv: 0.48, barrel: 0.62, guard: 0.3, mag: 'straight', magLen: 0.08, stock: 'full', scope: 'tube' }), { family: 'CW', auto: false, bolt: true, scope: true }],
  ['m82', 'M82', 'sniper', 'Cold War', [R(INF, 110)], 1.6, 180, 5, 9, 3.4, 420, 950, lk({ recv: 0.52, barrel: 0.66, guard: 0.3, guardW: 0.07, mag: 'straight', magLen: 0.12, stock: 'full', scope: 'tube', bipod: true }), { family: 'CW', auto: false, scope: true }],
  ['hauer', 'Hauer 77', 'shotgun', 'Cold War', [R(6, 36), R(12, 20), R(INF, 5)], 1.1, 70, 5, 9, 3.2, 300, 400, lk({ recv: 0.3, barrel: 0.5, guard: 0.14, mag: 'tube', stock: 'full' }), { family: 'CW', pellets: 8, auto: false, pump: true }],
  ['gallo', 'Gallo SA12', 'shotgun', 'Cold War', [R(6, 26), R(12, 14), R(INF, 4)], 1.1, 230, 7, 12, 2.2, 300, 400, lk({ recv: 0.34, barrel: 0.46, guard: 0.18, mag: 'tube', stock: 'full' }), { family: 'CW', pellets: 8, auto: false }],
  ['streetsweeper', 'Streetsweeper', 'shotgun', 'Cold War', [R(6, 17), R(12, 10), R(INF, 3)], 1.1, 300, 12, 18, 2.8, 310, 400, lk({ recv: 0.32, barrel: 0.3, guard: 0.14, mag: 'drum', stock: 'fold' }), { family: 'CW', pellets: 8, auto: false }],
  ['1911cw', '1911 (Cold War)', 'pistol', 'Cold War', [R(12, 34), R(INF, 25)], 1.6, 400, 8, 14, 1.3, 110, 320, L.pist(0.036), { family: 'CW', auto: false }],
  ['magnum', 'Magnum', 'pistol', 'Cold War', [R(15, 66), R(INF, 50)], 1.5, 200, 6, 8, 2.2, 170, 400, L.pist(0.045, true), { family: 'CW', auto: false }],
  ['diamatti', 'Diamatti', 'pistol', 'Cold War', [R(12, 25), R(INF, 18)], 1.6, 800, 15, 30, 1.3, 110, 380, L.pist(0.04), { family: 'CW', burst: 3, burstRpm: 300, auto: false }],
  ['cigma', 'Cigma 2', 'launcher', 'Cold War', [R(INF, 150)], 1, 30, 1, 1, 4.5, 500, 150, lk({ recv: 0.2, barrel: 1.0, guard: 0, mag: 'none', stock: 'none', tubeDia: 0.06 }), { family: 'CW', auto: false, splash: { radius: 5.5, damage: 150 } }],
  ['m79', 'M79', 'launcher', 'Cold War', [R(INF, 60)], 1, 60, 1, 1, 2.5, 350, 70, lk({ recv: 0.24, barrel: 0.32, guard: 0.1, mag: 'none', stock: 'wood', wood: true, tubeDia: 0.035 }), { family: 'CW', auto: false, splash: { radius: 5, damage: 150 }, weight: 0.12 }],
];

export const WEAPONS: WeaponDef[] = ROWS.map(([id, name, cls, season, dmg, head, rpm, mag, magExt, reload, adsMs, vel, look, extra]) => {
  const c = CLS[cls];
  const auto = extra?.auto ?? (cls === 'ar' || cls === 'smg' || cls === 'lmg');
  const burst = extra?.burst;
  // recoil scales with damage per shot; heavy hitters kick harder
  const perShot = dmg[0][1] * (extra?.pellets ?? 1);
  const rv = cls === 'ar' || cls === 'smg' || cls === 'lmg' || cls === 'tactical' ? c.rv * (0.55 + perShot / 45) : c.rv;
  return {
    id, name, cls, ammo: c.ammo, family: 'MW', season, dmg, head, limb: 0.9, rpm, mag, magExt, reload, adsTime: adsMs / 1000, velocity: vel,
    spreadHip: c.hip * (cls === 'smg' ? 1 : 1), spreadAds: c.ads, recoilV: rv, recoilH: c.rh,
    auto, zoom: c.zoom, mobility: c.mob * (cls === 'ar' ? 1 - (look.recv - 0.36) * 0.2 : 1), model: look.bull ? 'bullpup' : c.model, look,
    weight: c.weight * (season === 'Cold War' ? 0.6 : 1),
    ...(burst ? { burst } : {}),
    ...extra,
  } as WeaponDef;
});
export const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w])) as Record<string, WeaponDef>;

export const CLASS_NAMES: Record<WeaponClass, string> = { ar: 'Assault Rifle', smg: 'Submachine Gun', lmg: 'Light Machine Gun', sniper: 'Sniper Rifle', marksman: 'Marksman Rifle', shotgun: 'Shotgun', pistol: 'Handgun', launcher: 'Launcher', melee: 'Melee', tactical: 'Tactical Rifle' };

export const enum Rarity { Common = 0, Uncommon = 1, Rare = 2, Epic = 3, Legendary = 4, Loadout = 5 }
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Loadout'];
export const RARITY_COLORS = ['#d8d8d8', '#5fd35f', '#4aa3ff', '#b45cff', '#ffb52e', '#ff6fb5'];
/** Attachments per tier (2020): 0 / 1 / 3 / 4 / 5; custom loadout guns carry 5. */
export const RARITY_ATTACH = [0, 1, 3, 4, 5, 5];

/** Attachment effects scale with rarity: more attachments, better handling. */
export function rarityMods(r: number) {
  const k = Math.min(r, 4);
  return { extMag: r >= 2, recoil: 1 - k * 0.07, spread: 1 - k * 0.05, range: 1 + k * 0.06, velocity: 1 + k * 0.08, ads: 1 - k * 0.02, scope: r >= 3 };
}

const ATTACH_POOL: Record<string, string[]> = {
  muzzle: ['Monolithic Suppressor', 'Tactical Suppressor', 'Compensator', 'Muzzle Brake', 'Flash Guard'],
  barrel: ['Long Barrel', 'Heavy Barrel', 'Extended Barrel', 'Lightweight Barrel', 'Ranger Barrel'],
  underbarrel: ['Commando Foregrip', 'Merc Foregrip', 'Ranger Foregrip', 'Tactical Foregrip'],
  optic: ['Holographic Sight', 'Reflex Sight', 'VLK 3.0x Optic', 'Integral Hybrid', 'Canted Hybrid'],
  mag: ['Extended Mag', 'Large Mag', 'Drum Mag'],
  stock: ['Stock Pad', 'Tactical Stock', 'No Stock', 'Skeleton Stock'],
  laser: ['Tac Laser', '1mW Laser', '5mW Laser'],
  grip: ['Rubberized Grip Tape', 'Stippled Grip Tape'],
};
/** Deterministic attachment list for a loot gun (for the item card). */
export function attachmentsFor(id: string, rarity: number, seed = 0): string[] {
  const n = RARITY_ATTACH[rarity] ?? 0, slots = ['muzzle', 'barrel', 'optic', 'mag', 'underbarrel', 'stock', 'laser', 'grip'];
  const out: string[] = []; let h = seed * 7919 + id.length * 31;
  for (let i = 0; i < slots.length && out.length < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const slot = slots[(i + (h % 3)) % slots.length];
    const pool = ATTACH_POOL[slot]; const pick = pool[h % pool.length];
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}
const BLUEPRINTS = ['Crocodile', 'Warden', 'Dauntless', 'Scourge', 'Obsidian', 'Last Hope', 'Ice Drake', 'Tiger', 'Nightshade', 'Oni', 'Carnage', 'Vendetta', 'Hollow', 'Wraith', 'Ember', 'Sentinel'];
export const blueprintName = (id: string, rarity: number) => (rarity >= 2 ? BLUEPRINTS[(id.charCodeAt(0) * 7 + id.length * 13 + rarity) % BLUEPRINTS.length] : '');

export const AMMO_PICKUP: Record<AmmoType, number> = { heavy: 30, light: 40, sniper: 5, shotgun: 8, rocket: 1 };
export const AMMO_MAX: Record<AmmoType, number> = { heavy: 300, light: 300, sniper: 40, shotgun: 40, rocket: 3 };

export function damageAt(def: WeaponDef, dist: number, rangeMul = 1): number {
  for (const [r, d] of def.dmg) if (dist <= r * rangeMul) return d;
  return def.dmg[def.dmg.length - 1][1];
}

/** The Shield Turret's mounted gun (not loot). */
WEAPON.turretgun = { ...WEAPON.pkm, id: 'turretgun', name: 'Shield Turret', dmg: [[60, 34], [999, 30]], mag: 9999, magExt: 9999, reload: 0, spreadHip: 0.01, spreadAds: 0.003, recoilV: 0.0012, recoilH: 0.0008, mobility: 0, weight: 0 };
