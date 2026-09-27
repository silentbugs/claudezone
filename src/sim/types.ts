import type { AmmoType } from '../data/weapons';

export const enum Phase { Lobby, Plane, Freefall, Chute, Alive, Downed, Dead, Gulag, GulagWait, Spectate }
export const enum Stance { Stand, Crouch, Prone }

export interface WeaponSlot { id: string; rarity: number; mag: number }

export type LethalType = 'frag' | 'semtex' | 'knife' | 'molotov' | 'c4' | 'claymore';
export type TacticalType = 'stun' | 'flash' | 'smoke' | 'heartbeat' | 'stim';
export type KillstreakType = 'uav' | 'cluster' | 'airstrike' | 'turret';
export type FieldUpgrade = 'munitions' | 'armorBox';

export interface Intent {
  mx: number; mz: number; // move axes: mx strafe right, mz forward
  yaw: number; pitch: number;
  fire: boolean; ads: boolean; sprint: boolean; jump: boolean; crouch: boolean; prone: boolean;
  reload: boolean; interact: boolean; plate: boolean; swap: boolean; lethal: boolean; tactical: boolean;
  killstreak: boolean; selfRevive: boolean; slot: number; // 0 none, 1/2 select weapon
  markX?: number; markZ?: number; // map target for killstreaks
}
export const emptyIntent = (): Intent => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: false, plate: false, swap: false, lethal: false, tactical: false, killstreak: false, selfRevive: false, slot: 0 });

export interface Player {
  id: number; name: string; squad: number; bot: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  px: number; py: number; pz: number; pyaw: number; // previous tick (render interpolation)
  yaw: number; pitch: number;
  phase: Phase;
  onGround: boolean; groundY: number; fallStartY: number;
  stance: Stance; sprinting: boolean; tacSprint: number; tacCooldown: number; slideT: number; slideCd: number; slideDx: number; slideDz: number;
  swimming: boolean; mantleT: number; mantleY: number;
  health: number; armor: number; plates: number; maxPlates: number;
  weapons: (WeaponSlot | null)[]; cur: number;
  ammo: Record<AmmoType, number>;
  lethal: { type: LethalType; n: number } | null;
  tactical: { type: TacticalType; n: number } | null;
  killstreak: KillstreakType | null;
  fieldUpgrade: FieldUpgrade | null;
  turret: number; // id of the manned shield turret, or -1
  stash: (WeaponSlot | null)[] | null;
  selfRevive: boolean; gasMask: number; hasMask: boolean;
  cash: number; kills: number; damage: number;
  fireCd: number; reloadT: number; swapT: number; plateT: number; ads: number; recoil: number; recoilYaw: number; bloom: number; boltT: number;
  lastHit: number; lastDamaged: number; stunT: number; flashT: number;
  downT: number; reviveT: number; reviveBy: number;
  gulagUsed: boolean; deadAt: number; killedBy: number;
  interactT: number; interactTarget: number;
  intent: Intent;
  lastShot: number; lastStep: number;
  uavUntil: number; // this player's squad has UAV when > time (stored per player for simplicity)
  bountyOn: number; contractId: number;
  alive: boolean;
  placement: number;
  gulagSlot: number;
  triggerHeld: boolean;
  stanceT: number;
  sprintOut: number;
  burstLeft: number;
  meleeCd: number;
  prevSprint: boolean;
  loadoutUsed: boolean;
  spectating: number;
}

export const enum ItemKind { Weapon, Ammo, Plate, Cash, Lethal, Tactical, Killstreak, SelfRevive, GasMask, Satchel }
export interface Item {
  id: number; kind: ItemKind;
  x: number; y: number; z: number;
  weapon?: string; rarity?: number; mag?: number;
  ammo?: AmmoType; n?: number;
  lethal?: LethalType; tactical?: TacticalType; killstreak?: KillstreakType;
  alive: boolean;
  vy?: number; // tossed items settle
}

export interface Chest { id: number; x: number; y: number; z: number; opened: boolean; legendary: boolean }

export interface Bullet {
  owner: number; weapon: string; rarity: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  dist: number; dmgMul: number; life: number;
  tracer: boolean;
  rocket?: boolean;
}

export interface Throwable { id: number; owner: number; type: LethalType | TacticalType | 'rock'; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; stuck: boolean; alive: boolean }

export interface Explosion { x: number; y: number; z: number; r: number; dmg: number; owner: number; delay: number; kind: 'frag' | 'rocket' | 'cluster' | 'airstrike' | 'c4' | 'vehicle' }

export type SimEvent =
  | { t: 'shot'; p: number; w: string; x: number; y: number; z: number; dx: number; dy: number; dz: number; suppressed?: boolean }
  | { t: 'tracer'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; p: number }
  | { t: 'impact'; x: number; y: number; z: number; nx: number; ny: number; nz: number; mat: number; water: boolean }
  | { t: 'hit'; attacker: number; victim: number; dmg: number; head: boolean; armorBroke: boolean; armorHit: boolean; kill: boolean; down: boolean; x: number; y: number; z: number }
  | { t: 'down'; victim: number; attacker: number; w: string }
  | { t: 'kill'; victim: number; attacker: number; w: string; head: boolean; finish: boolean }
  | { t: 'revive'; p: number }
  | { t: 'plate'; p: number; done: boolean }
  | { t: 'reload'; p: number; w: string }
  | { t: 'pickup'; p: number; kind: ItemKind; label: string }
  | { t: 'chest'; p: number; x: number; y: number; z: number }
  | { t: 'jump'; p: number }
  | { t: 'chute'; p: number }
  | { t: 'land'; p: number; hard: boolean }
  | { t: 'explosion'; x: number; y: number; z: number; r: number; kind: string }
  | { t: 'throw'; p: number; type: string }
  | { t: 'circle'; phase: number; closing: boolean }
  | { t: 'gulag'; p: number; msg: 'enter' | 'win' | 'lose' | 'closed' | 'fight' | 'overtime' }
  | { t: 'redeploy'; p: number }
  | { t: 'buy'; p: number; item: string }
  | { t: 'uav'; squad: number }
  | { t: 'contract'; p: number; kind: string; msg: 'start' | 'done' | 'fail' | 'progress' }
  | { t: 'announce'; text: string; squad?: number }
  | { t: 'squadwipe'; squad: number }
  | { t: 'win'; squad: number }
  | { t: 'dryfire'; p: number }
  | { t: 'step'; p: number; x: number; y: number; z: number; metal: boolean }
  | { t: 'whiz'; p: number; x: number; y: number; z: number }
  | { t: 'gas'; p: number }
  | { t: 'slide'; p: number }
  | { t: 'melee'; p: number }
  | { t: 'flash'; p: number; s: number }
  | { t: 'marker'; x: number; z: number; kind: string; squad: number; dur: number };
