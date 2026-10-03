/**
 * Maps bindings + hold/toggle preferences onto the local player's Intent.
 * poll() runs once per rendered frame (collecting edges); apply() runs per sim step.
 */
import type { Input } from '../core/input';
import type { Action, Settings } from '../core/settings';
import { Phase, Player, Stance } from '../sim/types';

export class Controls {
  private pend = { melee: false, jump: false, crouch: false, prone: false, reload: false, swap: false, slot: 0, lethal: false, tactical: false, killstreak: false, fieldUpgrade: false, tac: false, ping: false, map: false, scoreboard: false, interactPress: false, fireMode: false };
  private adsToggled = false;
  private sprintToggled = false;
  private lastSprintTap = -1;
  private lastSprintRelease = -1;
  private plateLatch = false;
  thirdPersonHeld = false;
  scoreboardHeld = false;

  constructor(private input: Input, public settings: Settings) {}

  private down(a: Action) { const [k1, k2] = this.settings.binds[a]; return this.input.isDown(k1) || this.input.isDown(k2); }
  private pressed(a: Action) { const [k1, k2] = this.settings.binds[a]; const r1 = this.input.wasPressed(k1), r2 = this.input.wasPressed(k2); return r1 || r2; }
  private released(a: Action) { const [k1, k2] = this.settings.binds[a]; const r1 = this.input.wasReleased(k1), r2 = this.input.wasReleased(k2); return r1 || r2; }

  /** Collect edge-triggered actions for this frame. */
  poll(p: Player, now: number) {
    const s = this.settings, P = this.pend;
    const air = p.phase === Phase.Freefall || p.phase === Phase.Chute || p.phase === Phase.Plane;
    this.thirdPersonHeld = air && this.down('thirdPerson');
    this.scoreboardHeld = this.down('scoreboard');
    if (this.pressed('jump')) P.jump = true;
    // crouch / prone: toggles send one edge per press; hold mode sends an edge on press and release
    const cp = this.pressed('crouch'), cr = this.released('crouch');
    if (cp) P.crouch = true;
    const pp = this.pressed('prone'), pr = this.released('prone');
    if (pp) P.prone = true;
    if (pr && s.proneMode === 'hold' && p.stance === Stance.Prone) P.prone = true;
    // sprint / tactical sprint
    if (this.released('sprint')) this.lastSprintRelease = now;
    const sp = this.pressed('sprint');
    if (sp) {
      if (s.sprintMode === 'toggle') this.sprintToggled = !this.sprintToggled;
      if ((p.sprinting || this.down('forward')) && (s.tacSprint === 'pressWhileSprinting' || now - this.lastSprintTap < 0.3 || now - this.lastSprintRelease < 0.3)) P.tac = true;
      this.lastSprintTap = now;
    }
    if (this.pressed('ads') && s.adsMode === 'toggle') this.adsToggled = !this.adsToggled;
    if (this.pressed('reload')) P.reload = true;
    if (this.pressed('swap')) P.swap = true;
    if (this.pressed('weapon1')) P.slot = 1;
    if (this.pressed('weapon2')) P.slot = 2;
    if (!air && this.pressed('lethal')) P.lethal = true;
    if (!air && this.pressed('tactical')) P.tactical = true;
    if (this.pressed('killstreak')) P.killstreak = true;
    if (!air && this.pressed('melee')) P.melee = true;
    if (this.pressed('fieldUpgrade')) P.fieldUpgrade = true;
    if (this.pressed('ping')) P.ping = true;
    if (this.pressed('fireMode') && !(p.ads > 0.5 && (p as any).scoped)) P.fireMode = true;
    if (this.pressed('map')) P.map = true;
    if (this.pressed('plate') && s.plateMode === 'tap') this.plateLatch = true;
    if (this.pressed('interact')) P.interactPress = true;
    this.input.endFrame();
  }

  /** UI-level one-shots (map toggle, ping) — read and cleared by the client. */
  takeUi() { const r = { ping: this.pend.ping, map: this.pend.map }; this.pend.ping = false; this.pend.map = false; return r; }

  /** Fill the intent for one sim step. */
  apply(p: Player, yaw: number, pitch: number, blocked: boolean) {
    const it = p.intent, P = this.pend, s = this.settings;
    if (blocked) {
      it.mx = it.mz = 0; it.fire = it.ads = it.sprint = it.interact = it.plate = false;
      Object.assign(P, { melee: false, jump: false, crouch: false, prone: false, reload: false, swap: false, slot: 0, lethal: false, tactical: false, killstreak: false, fieldUpgrade: false, tac: false, interactPress: false });
      return;
    }
    it.mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    it.mz = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    if (it.mz <= 0) this.sprintToggled = false;
    it.sprint = s.sprintMode === 'auto' ? it.mz > 0 : s.sprintMode === 'toggle' ? this.sprintToggled : this.down('sprint') || (p.sprinting && it.mz > 0);
    (it as any).tac = P.tac;
    it.jump = P.jump; it.crouch = P.crouch; it.prone = P.prone; it.reload = P.reload;
    it.swap = P.swap; it.slot = P.slot; it.lethal = P.lethal; it.tactical = P.tactical; it.killstreak = P.killstreak;
    (it as any).slideHold = s.slideMode === 'hold'; (it as any).crouchHoldMode = s.crouchMode === 'hold'; (it as any).crouchHeld = this.down('crouch');
    (it as any).fieldUpgrade = P.fieldUpgrade; (it as any).melee = P.melee; (it as any).fireMode = P.fireMode;
    (it as any).tacHeld = this.down('tactical'); // heartbeat sensor: held up while the key is down
    it.fire = this.down('fire');
    it.ads = s.adsMode === 'toggle' ? this.adsToggled : this.down('ads');
    if (p.reloadT > 0 && s.adsMode === 'toggle') { /* keep toggle through reloads, as in MW */ }
    it.interact = this.down('interact');
    it.selfRevive = p.phase === Phase.Downed && this.down('interact');
    if (this.plateLatch && (p.armor >= 150 || p.plates <= 0)) this.plateLatch = false;
    it.plate = this.down('plate') || this.plateLatch;
    (it as any).up = this.down('jump'); (it as any).down = this.down('crouch') || this.down('prone');
    it.yaw = yaw; it.pitch = pitch;
    Object.assign(P, { melee: false, jump: false, crouch: false, prone: false, reload: false, swap: false, slot: 0, lethal: false, tactical: false, killstreak: false, fieldUpgrade: false, tac: false, interactPress: false, fireMode: false });
    if (p.phase !== Phase.Alive) this.adsToggled = false;
  }
}
