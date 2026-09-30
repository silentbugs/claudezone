/**
 * Raw input: keyboard codes, mouse buttons ('Mouse0'..'Mouse4') and wheel ('WheelUp'/'WheelDown')
 * all become codes, so every action is rebindable. Edge presses are consumed once.
 */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  dx = 0; dy = 0;
  locked = false;
  enabled = true;
  /** When set, the next code pressed is delivered here instead (key rebinding). */
  capture: ((code: string) => void) | null = null;
  onUnlock: () => void = () => {};
  /** set while a match is running: all keys are captured */
  inGame = false;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
      if (!this.enabled) return;
      // in a match, every key belongs to the game: no browser shortcuts (Ctrl+F find, Ctrl+S save, Ctrl+D bookmark,
      // Shift/Ctrl+Shift+C, F-keys, Alt menus...). Ctrl+W / Ctrl+T / Ctrl+N are only deliverable in fullscreen
      // with the Keyboard Lock API (see lockKeyboard()); text fields keep normal typing.
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (this.inGame && !typing) e.preventDefault();
      else if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      this.down(e.code);
    });
    addEventListener('keyup', (e) => this.up(e.code));
    addEventListener('blur', () => { for (const c of this.held) this.released.add(c); this.held.clear(); });
    const mouseDown = (e: MouseEvent) => {
      const code = 'Mouse' + e.button;
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(code); return; }
      if (!this.enabled) return;
      if (e.target === el && !this.locked) el.requestPointerLock?.();
      if (this.locked || e.target === el) this.down(code);
    };
    addEventListener('mousedown', mouseDown);
    addEventListener('mouseup', (e) => { if (this.inGame && (e.button === 3 || e.button === 4)) e.preventDefault(); this.up('Mouse' + e.button); });
    // the side buttons are game binds in a match, never browser back / forward
    addEventListener('auxclick', (e) => { if (this.inGame && (e.button === 3 || e.button === 4)) e.preventDefault(); });
    addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    addEventListener('wheel', (e) => {
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (this.capture) { const c = this.capture; this.capture = null; c(code); return; }
      if (this.locked) { this.pressed.add(code); }
    }, { passive: true });
    // closing / reloading the tab mid-match asks first (the browser's own "Leave site?" dialog); in fullscreen with
    // keyboard lock Ctrl+W never gets this far, it goes to the game
    addEventListener('beforeunload', (e) => { if (this.inGame) { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('contextmenu', (e) => e.preventDefault());
    // leaving the window releases everything (no stuck keys after alt-tab)
    addEventListener('blur', () => { for (const c of this.held) this.released.add(c); this.held.clear(); });
    addEventListener('wheel', (e) => { if (this.inGame && (e.ctrlKey || e.metaKey)) e.preventDefault(); }, { passive: false }); // no Ctrl+wheel page zoom
    addEventListener('keydown', (e) => { if (this.inGame && (e.ctrlKey || e.metaKey) && ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)) e.preventDefault(); }, { capture: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      // freeing the cursor (tac map, backpack) keeps held movement keys; only mouse buttons are released
      if (was && !this.locked) { for (const c of [...this.held]) if (c.startsWith('Mouse')) { this.released.add(c); this.held.delete(c); } this.onUnlock(); }
    });
  }
  private down(code: string) { if (!this.held.has(code)) this.pressed.add(code); this.held.add(code); }
  private up(code: string) { if (this.held.has(code)) this.released.add(code); this.held.delete(code); }
  isDown(code: string) { return !!code && this.held.has(code); }
  /** True once per physical press. */
  wasPressed(code: string) { if (code && this.pressed.has(code)) { this.pressed.delete(code); return true; } return false; }
  wasReleased(code: string) { if (code && this.released.has(code)) { this.released.delete(code); return true; } return false; }
  peekPressed(code: string) { return !!code && this.pressed.has(code); }
  consumeMouse() { const r = { dx: this.dx, dy: this.dy }; this.dx = 0; this.dy = 0; return r; }
  /** Drop edges nobody consumed this frame. */
  endFrame() { this.pressed.clear(); this.released.clear(); }
  clearAll() { this.pressed.clear(); this.released.clear(); this.held.clear(); }
  lock() { this.el.requestPointerLock?.(); }
  /**
   * Fullscreen + Keyboard Lock: the only way a web page can receive browser-reserved shortcuts like Ctrl+W,
   * Ctrl+T, Ctrl+N, Ctrl+Tab (Chrome/Edge; Esc still works, hold it to leave fullscreen). Must run from a
   * user gesture (a click).
   */
  /**
   * Fullscreen + Keyboard Lock: the only way a page can receive Ctrl+W / Ctrl+T / Ctrl+N (Chrome / Edge, on
   * localhost or https). Re-locks every time the game re-enters fullscreen.
   */
  async lockKeyboard() {
    if (!this.fsHooked) { this.fsHooked = true; document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement && this.inGame) (navigator as any).keyboard?.lock?.().catch?.(() => {}); }); }
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      await (navigator as any).keyboard?.lock?.();
    } catch { /* not supported / denied: preventDefault still covers most shortcuts */ }
  }
  private fsHooked = false;
  /** true when the browser can hand Ctrl+W etc. to the game (Keyboard Lock available and active in fullscreen) */
  get keyboardLockable() { return !!(navigator as any).keyboard?.lock && window.isSecureContext; }
  unlockKeyboard() { try { (navigator as any).keyboard?.unlock?.(); } catch { /* */ } }
}
