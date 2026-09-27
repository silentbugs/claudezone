/** Tunables. Values follow Warzone (2020) where known (see research notes), estimates otherwise. */
export const TICK = 1 / 60;
export const PLAYERS = 150;
export const SQUAD_SIZE = 3;

export const MOVE = {
  walk: 4.9, sprint: 7.1, tacSprint: 9.1, crouch: 2.6, prone: 1.0, ads: 2.6, downed: 1.1, swim: 3.0,
  accel: 38, airAccel: 6, friction: 12,
  gravity: 19, jumpV: 6.1,
  tacSprintTime: 3.6, tacSprintCooldown: 4.5,
  slideSpeed: 10.5, slideTime: 0.8, slideCooldown: 1.2,
  height: 1.8, crouchH: 1.25, proneH: 0.6, radius: 0.34, step: 0.55,
  mantleMax: 2.7,
  fallSafe: 5.5, fallLethal: 16,
};

export const HEALTH = { max: 100, plate: 50, maxArmor: 150, plateTime: 1.25, regenDelay: 5, regenRate: 60, carry: 5, carrySatchel: 8 };

export const DEPLOY = {
  planeAlt: 620, planeSpeed: 62,
  freefallH: 38, freefallFall: 52, diveFall: 68,
  chuteH: 13, chuteFall: 5.2,
  autoChuteAGL: 110, minChuteAGL: 12,
  redeployAlt: 520,
};

export const DOWNED = { health: 100, bleed: 30, reviveTime: 5, selfReviveTime: 5, revivedHealth: 30 };

export const GAS = { dps: 8.4, maskTime: 12 };

/** Circle phases (post 29 Apr 2020 patch): wait, close seconds and the next circle radius (m). */
export const CIRCLES: { wait: number; close: number; radius: number }[] = [
  { wait: 210, close: 270, radius: 1150 },
  { wait: 90, close: 215, radius: 640 },
  { wait: 75, close: 170, radius: 360 },
  { wait: 60, close: 110, radius: 200 },
  { wait: 60, close: 69, radius: 110 },
  { wait: 45, close: 50, radius: 55 },
  { wait: 30, close: 48, radius: 24 },
  { wait: 15, close: 105, radius: 0 },
];
/** Initial circle covers the whole playable map. */
export const INITIAL_RADIUS = 2100;

export const GULAG = { closesAfterCircle: 4, overtime: 30, flagTime: 3.5, rockDamage: 5, fightMax: 60 };

export const PRICES = {
  plates: 1500, turret: 2000, cluster: 3000, gasMask: 3000, airstrike: 3500, uav: 4000, selfRevive: 4500, buyback: 4500, munitions: 5000, loadout: 10000,
};

export const CASH = { stack: [100, 200, 300, 500], chestCash: [100, 800] };

export const CONTRACT = {
  bounty: { time: 300, reward: 1500 },
  scavenger: { time: 300, reward: 1000 },
  recon: { time: 240, reward: 1000, capture: 12 },
  mostWanted: { time: 180, reward: 2000 },
};

export const LOOT_TIER_WEIGHTS = [50, 28, 14, 6, 2];
