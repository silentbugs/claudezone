/** Keyboard + mouse state with pointer lock. Edge-triggered presses are consumed once per sim tick. */
export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  dx = 0; dy = 0; wheel = 0;
  locked = false;
  sensitivity = 0.0022;
  adsSensMul = 0.6;
  enabled = true;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = [false, false, false]; });
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { el.requestPointerLock?.(); }
      this.mouseDown[e.button] = true; this.mousePressed[e.button] = true;
    });
    addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
  }
  down(code: string) { return this.keys.has(code); }
  /** True once per physical press. */
  press(code: string) { if (this.pressed.has(code)) { this.pressed.delete(code); return true; } return false; }
  mousePress(b: number) { if (this.mousePressed[b]) { this.mousePressed[b] = false; return true; } return false; }
  consumeMouse() { const r = { dx: this.dx, dy: this.dy }; this.dx = 0; this.dy = 0; return r; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  clearPresses() { this.pressed.clear(); this.mousePressed = [false, false, false]; }
}
