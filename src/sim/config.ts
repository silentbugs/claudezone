/** Tunables. Values follow Warzone (2020) where known (see research notes), estimates otherwise. */
export const TICK = 1 / 60;
export const PLAYERS = 150;
export const SQUAD_SIZE = 3;

export const MOVE = {
  // walk comes from the held weapon (WeaponDef.walk); these are multipliers / fallbacks (Warzone 2020 data mine)
  walk: 4.9, sprintMul: 1.31, tacSprintMul: 1.57, crouchMul: 0.6, proneMul: 0.15, strafeMul: 0.7, strafeAdsMul: 0.8, backMul: 0.77, backAdsMul: 0.88,
  sprint: 6.4, tacSprint: 7.7, crouch: 2.9, prone: 0.75, ads: 2.4, downed: 1.1, swim: 3.0,
  accel: 38, airAccel: 6, friction: 12,
  gravity: 19, jumpV: 6.1,
  tacSprintTime: 2.0, tacSprintCooldown: 4.5,
  slideSpeed: 10.2, slideTime: 1.05, slideCooldown: 0.9,
  height: 1.8, crouchH: 1.25, proneH: 0.6, radius: 0.34, step: 0.55,
  mantleMax: 2.7,
  fallSafe: 5.5, fallLethal: 16,
};

export const HEALTH = { max: 100, plate: 50, maxArmor: 150, plateTime: 1.25, regenDelay: 5, regenRate: 40, stimRate: 160, carry: 5, carrySatchel: 8 };

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

import { BUY_ITEMS, BuyId } from '../data/buy';
export const PRICES = Object.fromEntries(BUY_ITEMS.map((b) => [b.id, b.price])) as Record<BuyId, number>;

export const CASH = { stack: [100, 200, 300, 500], chestCash: [100, 800] };

/**
 * Verdansk 2020 contracts (Activision "Contracts: Tips and Tricks", Jul 2020, plus the in-game cards):
 * Bounty: eliminate one marked enemy, a few minutes, target area shown as a yellow circle.
 * Scavenger: three supply boxes revealed one at a time; each box opened extends the timer; the last one holds
 * rarer loot and an armor satchel. Recon: 4 minutes to reach a zone and hold it (faster with more squadmates);
 * a flare goes up when you start; completion shows the next safe zone. Most Wanted: your position is shown to
 * every enemy; survive 3 minutes for a big payout and your fallen squadmates redeploy. Supply Run: 2 minutes to
 * reach a marked buy station; cash plus one purchase at 80 % off (a Self-Revive or buyback is free).
 */
export const CONTRACT = {
  bounty: { time: 150, reward: 1000 },
  scavenger: { time: 120, stepTime: 90, reward: 1000 },
  recon: { time: 240, reward: 1000, capture: 25, radius: 9 },
  mostwanted: { time: 180, reward: 3000 },
  supply: { time: 120, reward: 1000, discount: 0.2 },
};

export const LOOT_TIER_WEIGHTS = [50, 28, 14, 6, 2];
