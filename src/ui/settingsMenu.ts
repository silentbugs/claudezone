/** Settings screen (main menu and in-game Esc menu): controls, key bindings, graphics, audio. */
import { ACTIONS, Action, DEFAULT_SETTINGS, keyName, saveSettings, Settings } from '../core/settings';
import type { Input } from '../core/input';

type Tab = 'controls' | 'binds' | 'graphics' | 'audio';

export class SettingsMenu {
  el = document.createElement('div');
  private tab: Tab = 'controls';
  constructor(private s: Settings, private input: Input, private onChange: (key: keyof Settings) => void, private onClose: () => void) {
    this.el.className = 'settings';
    this.render();
  }

  private row(label: string, control: string, hint = '') { return `<div class="srow"><label>${label}${hint ? `<small>${hint}</small>` : ''}</label><div class="sctl">${control}</div></div>`; }
  private select(key: keyof Settings, opts: [string, string][]) { return `<select data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(this.s[key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`; }
  private range(key: keyof Settings, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) { const v = this.s[key] as number; return `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val">${fmt(v)}</span>`; }
  private check(key: keyof Settings) { return `<input type="checkbox" data-k="${key}" ${this.s[key] ? 'checked' : ''}>`; }

  render() {
    const t = this.tab, s = this.s;
    let body = '';
    if (t === 'controls') {
      body = this.row('Mouse sensitivity', this.range('sens', 0.1, 4, 0.01)) +
        this.row('ADS sensitivity multiplier', this.range('adsSens', 0.2, 2, 0.01), 'relative to hip-fire, scaled by zoom') +
        this.row('Invert vertical look', this.check('invertY')) +
        this.row('Crouch behaviour', this.select('crouchMode', [['toggle', 'Toggle'], ['hold', 'Hold']])) +
        this.row('Prone behaviour', this.select('proneMode', [['toggle', 'Toggle'], ['hold', 'Hold']])) +
        this.row('Aim down sights', this.select('adsMode', [['hold', 'Hold'], ['toggle', 'Toggle']])) +
        this.row('Sprint', this.select('sprintMode', [['hold', 'Hold'], ['toggle', 'Toggle'], ['auto', 'Automatic']])) +
        this.row('Tactical sprint', this.select('tacSprint', [['doubleTap', 'Double tap sprint'], ['pressWhileSprinting', 'Press sprint while sprinting']])) +
        this.row('Armor plating', this.select('plateMode', [['hold', 'Hold to chain plates'], ['tap', 'Tap: plate until full']])) +
        this.row('Slide behaviour', this.select('slideMode', [['tap', 'Tap'], ['hold', 'Hold (release to stop sliding)']])) +
        this.row('Parachute auto-deploy', this.check('chuteAutoDeploy'), 'opens the chute near the ground if you have not') +
        this.row('Depleted ammo weapon switch', this.check('depletedAmmoSwitch'), 'switch guns automatically when completely out of ammo') +
        this.row('Pause the match in the Esc menu', this.check('pauseOnMenu'), 'off = the match keeps running, like the real game');
    } else if (t === 'binds') {
      let group = '';
      for (const a of ACTIONS) {
        if (a.group !== group) { group = a.group; body += `<div class="sgroup">${group}</div>`; }
        const [k1, k2] = s.binds[a.id];
        body += this.row(a.label, `<button class="bind" data-a="${a.id}" data-i="0">${keyName(k1)}</button><button class="bind" data-a="${a.id}" data-i="1">${keyName(k2)}</button>`);
      }
      body += `<div class="srow"><label></label><div class="sctl"><button class="reset">Reset bindings to default</button></div></div><div class="shint">Click a slot, then press a key or mouse button. Esc cancels, Backspace clears.</div>`;
    } else if (t === 'graphics') {
      body = this.row('Quality preset', this.select('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']])) +
        this.row('Ambient occlusion', this.check('ao'), 'soft contact shadows in corners and under objects (costly)') +
        this.row('Draw distance', this.select('drawDistance', [['near', 'Near'], ['medium', 'Medium'], ['far', 'Far'], ['max', 'Max']]), 'how far buildings and trees keep full detail; nearer is faster') +
        this.row('Field of view', this.range('fov', 60, 120, 1, (v) => v.toFixed(0))) +
        this.row('ADS field of view', this.select('adsFovAffected', [['true', 'Affected (zooms)'], ['false', 'Independent']])) +
        this.row('Render resolution', this.range('renderScale', 0.5, 1.5, 0.05, (v) => Math.round(v * 100) + '%')) +
        this.row('Foliage density', this.range('foliage', 0, 1.5, 0.05, (v) => Math.round(v * 100) + '%'), 'grass and bushes near you') +
        this.row('Brightness', this.range('brightness', 0.6, 1.6, 0.01, (v) => Math.round(v * 100) + '%')) +
        this.row('Show FPS counter', this.check('showFps')) +
        this.row('Fullscreen + keyboard lock', this.check('fullscreen'), 'captures Ctrl+W, Ctrl+T and other browser shortcuts during a match (Chrome / Edge); hold Esc to leave fullscreen' + (this.input.keyboardLockable ? '' : ' — NOT AVAILABLE on this address: open the game via http://localhost:5173 (or https) so the browser allows it')) +
        '<div class="sgroup">Interface</div>' +
        this.row('Minimap shape', this.select('minimapShape', [['circle', 'Circle'], ['square', 'Square']])) +
        this.row('Compass', this.check('showCompass')) +
        this.row('Kill feed', this.check('showKillfeed')) +
        this.row('Crosshair', this.check('showCrosshair')) +
        this.row('Hit markers', this.check('showHitmarkers'));
    } else {
      body = this.row('Master volume', this.range('volume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%')) +
        this.row('Effects volume', this.range('sfx', 0, 1, 0.01, (v) => Math.round(v * 100) + '%')) +
        this.row('Interface volume', this.range('ui', 0, 1, 0.01, (v) => Math.round(v * 100) + '%')) +
        this.row('Music volume', this.range('musicVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'), 'infil theme, circle stingers, victory') +
        this.row('Hitmarker sounds', this.check('hitmarkerSounds')) +
        this.row('Announcer voice', this.check('announcer'), 'radio call-outs ("UAV online", "Welcome to the Gulag")');
    }
    this.el.innerHTML = `<div class="sbox"><div class="stabs">${(['controls', 'binds', 'graphics', 'audio'] as Tab[]).map((x) => `<button data-tab="${x}" class="${x === t ? 'on' : ''}">${{ controls: 'Controls', binds: 'Key bindings', graphics: 'Graphics', audio: 'Audio' }[x]}</button>`).join('')}<button class="sclose">Back ✕</button></div><div class="sbody">${body}</div></div>`;
    this.wire();
  }

  private wire() {
    const s = this.s;
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.onclick = () => { this.tab = b.dataset.tab as Tab; this.render(); });
    this.el.querySelector<HTMLButtonElement>('.sclose')!.onclick = () => this.onClose();
    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((c) => {
      const k = c.dataset.k as keyof Settings;
      const set = () => {
        let v: any = c instanceof HTMLInputElement && c.type === 'checkbox' ? c.checked : c instanceof HTMLInputElement && c.type === 'range' ? +c.value : c.value;
        if (v === 'true') v = true; else if (v === 'false') v = false;
        (s as any)[k] = v; saveSettings(s); this.onChange(k);
        const val = c.parentElement?.querySelector('.val'); if (val && c instanceof HTMLInputElement) val.textContent = (c.nextElementSibling as HTMLElement).textContent = this.fmt(k, +c.value);
      };
      c.addEventListener(c instanceof HTMLInputElement && c.type === 'range' ? 'input' : 'change', set);
    });
    this.el.querySelectorAll<HTMLButtonElement>('.bind').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      b.textContent = 'Press a key…'; b.classList.add('wait');
      setTimeout(() => this.input.capture = (code) => {
        const a = b.dataset.a as Action, i = +b.dataset.i!;
        if (code === 'Escape') { this.render(); return; }
        const val = code === 'Backspace' ? '' : code;
        // a key can only do one thing: clear it from other actions (except the in-air third-person view, which shares Q with tacticals)
        const shared = (x: Action, y: Action) => (x === 'thirdPerson' && y === 'tactical') || (x === 'tactical' && y === 'thirdPerson');
        if (val) for (const other of ACTIONS) { if (other.id === a || shared(a, other.id)) continue; const bb = s.binds[other.id]; if (bb[0] === val) bb[0] = ''; if (bb[1] === val) bb[1] = ''; }
        s.binds[a][i] = val; saveSettings(s); this.onChange('binds'); this.render();
      }, 0);
    });
    this.el.querySelector<HTMLButtonElement>('.reset')?.addEventListener('click', () => { s.binds = structuredClone(DEFAULT_SETTINGS.binds); saveSettings(s); this.onChange('binds'); this.render(); });
  }
  private fmt(k: keyof Settings, v: number) {
    if (k === 'fov') return v.toFixed(0);
    if (k === 'volume' || k === 'sfx' || k === 'ui' || k === 'renderScale' || k === 'foliage' || k === 'brightness' || k === 'musicVolume') return Math.round(v * 100) + '%';
    return v.toFixed(2);
  }
}
