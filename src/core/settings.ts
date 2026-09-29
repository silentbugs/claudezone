/**
 * All player-facing settings: key bindings, hold/toggle behaviour, sensitivity, FOV, audio and
 * graphics. Persisted in localStorage; defaults follow Warzone (2020) PC defaults.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'crouch' | 'prone'
  | 'fire' | 'ads' | 'reload' | 'interact' | 'plate' | 'weapon1' | 'weapon2' | 'swap'
  | 'lethal' | 'tactical' | 'fieldUpgrade' | 'killstreak' | 'ping' | 'map' | 'scoreboard' | 'thirdPerson' | 'melee' | 'scopeZoom';

export const ACTIONS: { id: Action; label: string; group: string }[] = [
  { id: 'forward', label: 'Move forward', group: 'Movement' },
  { id: 'back', label: 'Move backward', group: 'Movement' },
  { id: 'left', label: 'Move left', group: 'Movement' },
  { id: 'right', label: 'Move right', group: 'Movement' },
  { id: 'sprint', label: 'Sprint / tactical sprint', group: 'Movement' },
  { id: 'jump', label: 'Jump / mantle / parachute', group: 'Movement' },
  { id: 'crouch', label: 'Crouch / slide', group: 'Movement' },
  { id: 'prone', label: 'Prone', group: 'Movement' },
  { id: 'fire', label: 'Fire', group: 'Combat' },
  { id: 'ads', label: 'Aim down sights', group: 'Combat' },
  { id: 'reload', label: 'Reload', group: 'Combat' },
  { id: 'weapon1', label: 'Primary weapon', group: 'Combat' },
  { id: 'weapon2', label: 'Secondary weapon', group: 'Combat' },
  { id: 'swap', label: 'Switch weapon', group: 'Combat' },
  { id: 'melee', label: 'Melee', group: 'Combat' },
  { id: 'scopeZoom', label: 'Variable zoom (scopes, while aiming)', group: 'Combat' },
  { id: 'lethal', label: 'Lethal equipment', group: 'Combat' },
  { id: 'tactical', label: 'Tactical equipment', group: 'Combat' },
  { id: 'plate', label: 'Armor plate', group: 'Combat' },
  { id: 'fieldUpgrade', label: 'Field upgrade', group: 'Combat' },
  { id: 'killstreak', label: 'Killstreak', group: 'Combat' },
  { id: 'interact', label: 'Use / pick up / revive', group: 'Interaction' },
  { id: 'ping', label: 'Ping', group: 'Interaction' },
  { id: 'map', label: 'Tac map', group: 'Interaction' },
  { id: 'scoreboard', label: 'Backpack / scoreboard', group: 'Interaction' },
  { id: 'thirdPerson', label: 'Third person (while parachuting, hold)', group: 'Interaction' },
];

export type Binding = [string, string];
export type HoldToggle = 'hold' | 'toggle';

export interface Settings {
  binds: Record<Action, Binding>;
  crouchMode: HoldToggle;
  proneMode: HoldToggle;
  adsMode: HoldToggle;
  sprintMode: 'hold' | 'toggle' | 'auto';
  tacSprint: 'doubleTap' | 'pressWhileSprinting';
  plateMode: 'hold' | 'tap'; // tap: one press inserts until full
  slideMode: 'tap' | 'hold';
  sens: number; adsSens: number; invertY: boolean;
  fov: number; adsFovAffected: boolean;
  volume: number; sfx: number; ui: number;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  renderScale: number; foliage: number;
  /** screen-space ambient occlusion, independent of the preset */
  ao: boolean;
  /** play fullscreen with the keyboard locked, so browser shortcuts (Ctrl+W etc.) reach the game */
  fullscreen: boolean;
  /** how far full-detail buildings, trees and terrain reach (and how thick the haze is) */
  drawDistance: 'near' | 'medium' | 'far' | 'max'; showFps: boolean; hitmarkerSounds: boolean; announcer: boolean;
  brightness: number; minimapShape: 'circle' | 'square'; showCompass: boolean; showKillfeed: boolean; showCrosshair: boolean; showHitmarkers: boolean;
  chuteAutoDeploy: boolean; depletedAmmoSwitch: boolean; pauseOnMenu: boolean; musicVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  binds: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', ''], jump: ['Space', ''], crouch: ['KeyC', ''], prone: ['ControlLeft', 'KeyZ'],
    fire: ['Mouse0', ''], ads: ['Mouse2', ''], reload: ['KeyR', ''], interact: ['KeyF', ''], plate: ['Digit4', ''],
    weapon1: ['Digit1', ''], weapon2: ['Digit2', ''], swap: ['WheelDown', 'WheelUp'],
    lethal: ['KeyG', 'Mouse4'], tactical: ['KeyQ', 'Mouse3'], fieldUpgrade: ['KeyX', ''], killstreak: ['Digit5', ''],
    ping: ['Mouse1', 'AltLeft'], melee: ['KeyV', 'KeyE'], map: ['KeyM', ''], scoreboard: ['Tab', ''], thirdPerson: ['KeyQ', ''], scopeZoom: ['KeyB', ''],
  },
  crouchMode: 'toggle', proneMode: 'toggle', adsMode: 'hold', sprintMode: 'hold', tacSprint: 'doubleTap', plateMode: 'hold', slideMode: 'tap',
  sens: 1, adsSens: 1, invertY: false,
  fov: 80, adsFovAffected: true,
  volume: 0.7, sfx: 1, ui: 0.8,
  quality: 'high', renderScale: 1, foliage: 1, ao: false, drawDistance: 'far', fullscreen: true, showFps: false, hitmarkerSounds: true, announcer: true,
  brightness: 1, minimapShape: 'circle', showCompass: true, showKillfeed: true, showCrosshair: true, showHitmarkers: true,
  chuteAutoDeploy: true, depletedAmmoSwitch: true, pauseOnMenu: true, musicVolume: 0.6,
};

const KEY = 'vd-settings-v2';

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* private mode etc. */ }
  const s = { ...structuredClone(DEFAULT_SETTINGS), ...saved } as Settings;
  s.binds = { ...structuredClone(DEFAULT_SETTINGS.binds), ...(saved.binds ?? {}) };
  return s;
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

/** Human-readable name for a key/mouse code. */
export function keyName(code: string): string {
  if (!code) return '—';
  const m: Record<string, string> = { Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel Up', WheelDown: 'Wheel Down', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Tab: 'Tab', CapsLock: 'Caps Lock', Escape: 'Esc', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
