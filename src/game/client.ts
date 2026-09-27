/** Runs a match: fixed-step sim + interpolated rendering, input, camera, audio, HUD. */
import * as THREE from 'three';
import { Sim } from '../sim/sim';
import { Phase, Player, SimEvent, Stance } from '../sim/types';
import { WEAPON, rarityMods } from '../data/weapons';
import { eyeHeight } from '../sim/movement';
import { FixedStep } from '../core/loop';
import { Input } from '../core/input';
import { SceneMgr } from '../render/scene';
import { Characters } from '../render/characters';
import { ViewModel } from '../render/viewmodel';
import { Effects } from '../render/effects';
import { VehicleMeshes } from '../render/vehicles';
import { vehicleOf, VEHICLES } from '../sim/vehicles';
import { Hud } from '../ui/hud';
import { audio } from '../audio/audio';
import type { WorldData } from '../world/mapgen';
import { clamp, wrapAngle } from '../core/math';

import type { Settings } from '../core/settings';
import { Controls } from './controls';
import { SettingsMenu } from '../ui/settingsMenu';

export class Match {
  sim: Sim;
  hud: Hud;
  chars = new Characters();
  vm = new ViewModel();
  fx: Effects;
  vehMeshes = new VehicleMeshes();
  clock = new FixedStep(1 / 60);
  controls: Controls;
  private settingsEl: SettingsMenu | null = null;
  onSettingChange: (k: keyof Settings) => void = () => {};
  private fpsEl = document.createElement('div'); private fpsAcc = 0; private fpsN = 0;
  camYaw = 0; camPitch = 0;
  mapOpen = false; paused = false;
  spectate = -1;
  private lastMouse = { dx: 0, dy: 0 };
  private landDip = 0;
  private done = false;
  onEnd: (won: boolean, placement: number, me: Player) => void = () => {};
  private pauseEl: HTMLElement | null = null;
  private tpDist = 0;
  private tpBlend = 0; private eye = 1.62; private eyeFor = -1; private roll = 0;
  /** Dev/test: pin the camera (position + look target) regardless of phase. */
  debugCam: { pos: [number, number, number]; target: [number, number, number] } | null = null;

  constructor(public sm: SceneMgr, private world: WorldData, private input: Input, tac: HTMLCanvasElement, private ui: HTMLElement, public settings: Settings, seed: number) {
    this.sim = new Sim(world, seed, { humans: 1, warmup: 45 });
    this.controls = new Controls(input, settings);
    input.onUnlock = () => { if (!this.paused && !this.hud.panel && !this.done) this.togglePause(); };
    this.fpsEl.className = 'fps'; ui.appendChild(this.fpsEl);
    this.hud = new Hud(this.sim, tac, 0);
    ui.appendChild(this.hud.root);
    this.fx = new Effects(this.sim, sm.scene);
    sm.scene.add(this.chars.group);
    sm.scene.add(this.vehMeshes.group);
    this.chars.hidden = 0;
    this.camYaw = Math.atan2(-this.sim.plane.dx, -this.sim.plane.dz);
    this.vm.setAspect(innerWidth / innerHeight);
    this.vm.scene.environment = sm.scene.environment; this.vm.scene.environmentIntensity = 0.6;
    addEventListener('resize', () => this.vm.setAspect(innerWidth / innerHeight));
    this.hud.showBanner('Warm-up', 'Waiting for players • respawns are on');
    this.camYaw = this.me.yaw;
  }

  dispose() {
    this.sm.scene.remove(this.chars.group); this.sm.scene.remove(this.fx.group); this.sm.scene.remove(this.vehMeshes.group);
    this.hud.root.remove(); this.pauseEl?.remove(); this.fpsEl.remove(); this.closeSettings(); this.input.onUnlock = () => {};
    audio.loop('engine', 0); audio.loop('wind', 0); audio.loop('gas', 0); audio.loop('chute', 0);
  }

  get me() { return this.sim.players[0]; }

  private fillIntent() {
    const blocked = !!this.hud.panel || this.paused;
    this.controls.apply(this.me, this.camYaw, this.camPitch, blocked);
    if (this.mapOpen) { this.me.intent.fire = false; this.me.intent.ads = false; }
  }

  private look() {
    const { dx, dy } = this.input.consumeMouse();
    this.lastMouse = { dx, dy };
    if (this.hud.panel || this.paused) return;
    const p = this.me, w = p.weapons[p.cur];
    const zoom = w ? 1 + (WEAPON[w.id].zoom * (rarityMods(w.rarity).scope && !WEAPON[w.id].scope ? 1.3 : 1) - 1) * p.ads : 1;
    // ADS: sensitivity follows the zoom (MW "relative" behaviour) times the ADS multiplier
    const adsMul = 1 + (this.settings.adsSens / zoom - 1) * Math.min(1, p.ads * 1.2);
    const s = this.settings.sens * 0.0022 * adsMul * (p.stunT > 0 ? 0.35 : 1);
    this.camYaw -= dx * s;
    this.camPitch = clamp(this.camPitch - dy * s * (this.settings.invertY ? -1 : 1), -1.45, 1.45);
  }

  frame(dt: number, time: number) {
    const inp = this.input;
    if (inp.wasPressed('Escape')) { if (this.settingsEl) this.closeSettings(); else if (this.hud.panel) this.hud.closePanel(); else if (this.mapOpen) this.mapOpen = false; else this.togglePause(); }
    this.look();
    if (!this.paused && !this.hud.panel) {
      this.controls.poll(this.me, time);
      const ui = this.controls.takeUi();
      if (ui.map) this.mapOpen = !this.mapOpen;
      if (ui.ping) { const [x, , z] = this.sim.aimPoint(this.me, 800); this.hud.pings = [{ x, z, t: 999 }]; (this.me as any).ping = { x, z }; audio.play('beep', { vol: 0.3 }); }
    } else inp.endFrame();
    this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 0.5) { this.fpsEl.textContent = this.settings.showFps ? `${Math.round(this.fpsN / this.fpsAcc)} FPS` : ''; this.fpsAcc = 0; this.fpsN = 0; }
    if (!this.paused) {
      this.clock.advance(dt, (step) => {
        this.fillIntent();
        this.sim.tick(step);
        for (const e of this.sim.events) this.handleEvent(e);
        this.sim.events.length = 0;
      });
    }
    this.render(dt, time);
    if (this.sim.over && !this.done) { this.done = true; const me = this.me; setTimeout(() => this.onEnd(this.sim.winner === me.squad, this.placement(), me), 2500); }
    if (!this.me.alive && !this.done && this.me.phase === Phase.Dead && !this.sim.players.some((q) => q.squad === this.me.squad && q.alive)) {
      this.done = true; setTimeout(() => this.onEnd(false, this.placement(), this.me), 3500);
    }
  }
  private placement() { return this.sim.over && this.sim.winner === this.me.squad ? 1 : this.sim.squadsLeft() + 1; }

  private togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      document.exitPointerLock?.();
      const p = document.createElement('div'); p.className = 'menu pause';
      p.innerHTML = `<h1>PAUSED</h1><h2>VERDANSK • BATTLE ROYALE</h2><button data-a="resume">Resume</button><button data-a="settings">Settings</button><button data-a="quit">Leave match</button><div class="sub">The match is paused while this menu is open.</div>`;
      p.querySelector<HTMLElement>('[data-a=resume]')!.onclick = () => this.togglePause();
      p.querySelector<HTMLElement>('[data-a=settings]')!.onclick = () => this.openSettings();
      p.querySelector<HTMLElement>('[data-a=quit]')!.onclick = () => { this.paused = false; this.pauseEl?.remove(); this.done = true; this.onEnd(false, this.placement(), this.me); };
      this.ui.appendChild(p); this.pauseEl = p;
    } else { this.closeSettings(); this.pauseEl?.remove(); this.pauseEl = null; this.input.lock(); }
  }
  private openSettings() {
    this.settingsEl = new SettingsMenu(this.settings, this.input, (k) => this.onSettingChange(k), () => this.closeSettings());
    this.ui.appendChild(this.settingsEl.el);
  }
  private closeSettings() { this.settingsEl?.el.remove(); this.settingsEl = null; }

  private handleEvent(e: SimEvent) {
    const me = this.me, sim = this.sim;
    this.fx.onEvent(e, 0);
    this.hud.onEvent(e);
    const cam = this.sm.camera.position;
    const d = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    switch (e.t) {
      case 'shot': {
        const def = WEAPON[e.w];
        const snd = def.cls === 'sniper' ? 'sniper' : def.cls === 'marksman' ? 'marksman' : def.cls === 'shotgun' ? 'shotgun' : def.cls === 'pistol' ? 'pistol' : def.cls === 'smg' ? 'smg' : def.cls === 'lmg' ? 'lmg' : def.cls === 'launcher' ? 'rocket' : 'ar';
        if (e.p === 0 || e.p === this.spectate) { audio.play(snd, { vol: 0.8 }); if (e.p === this.viewId()) this.vm.fire(); }
        else { const dist = d(e.x, e.y, e.z); if (dist < 220) audio.play(snd, { x: e.x, y: e.y, z: e.z, range: 120, vol: 1.1 }); else audio.play(def.cls === 'sniper' ? 'distantSniper' : 'distant', { x: e.x, y: e.y, z: e.z, range: 500, vol: 0.9 }); }
        break;
      }
      case 'hit':
        if (e.attacker === 0) audio.play(e.kill || e.down ? 'kill' : e.armorBroke ? 'armorBreak' : e.head ? 'headshot' : e.armorHit ? 'hitArmor' : 'hit', { vol: 0.7 });
        if (e.victim === 0) { audio.play(e.armorBroke ? 'armorBreak' : 'bodyHit', { vol: 0.6 }); }
        break;
      case 'impact': if (d(e.x, e.y, e.z) < 30) audio.play(e.mat === 3 || e.mat === 9 ? 'impactMetal' : 'impact', { x: e.x, y: e.y, z: e.z, range: 12, vol: 0.5 }); break;
      case 'explosion': if (e.kind !== 'smoke') audio.play('explosion', { x: e.x, y: e.y, z: e.z, range: 150, vol: e.kind === 'airstrike' ? 1.4 : 1 }); break;
      case 'step': if (e.p !== 0) { if (d(e.x, e.y, e.z) < 30) audio.play('step', { x: e.x, y: e.y, z: e.z, range: 6, vol: sim.players[e.p].sprinting ? 0.7 : 0.4 }); } else audio.play('step', { vol: 0.12 }); break;
      case 'plate': if (e.p === 0) audio.play('plate', { vol: 0.6 }); break;
      case 'reload': if (e.p === 0) audio.play(e.w === 'swap' ? 'swap' : 'reload', { vol: 0.5 }); break;
      case 'pickup': if (e.p === 0) audio.play(e.kind === 3 ? 'cash' : 'pickup', { vol: 0.5 }); break;
      case 'chest': if (d(e.x, e.y, e.z) < 40) audio.play('crate', { x: e.x, y: e.y, z: e.z, range: 12 }); break;
      case 'jump': if (e.p === 0) audio.play('jump', { vol: 0.3 }); break;
      case 'land': if (e.p === 0) { audio.play('land', { vol: 0.5 }); this.landDip = e.hard ? 0.35 : 0.15; } break;
      case 'slide': if (e.p === 0) audio.play('slide', { vol: 0.4 }); break;
      case 'chute': if (e.p === 0) audio.play('chute', { vol: 0.6 }); break;
      case 'whiz': audio.play('whiz', { x: e.x, y: e.y, z: e.z, range: 4, vol: 0.5 }); break;
      case 'dryfire': if (e.p === 0) audio.play('dry', { vol: 0.5 }); break;
      case 'down': if (e.victim === 0) audio.play('downed', { vol: 0.8 }); break;
      case 'revive': if (e.p === 0) audio.play('revive', { vol: 0.6 }); break;
      case 'buy': if (e.p === 0) audio.play('uiBuy', { vol: 0.5 }); break;
      case 'uav': if (e.squad === me.squad) audio.play('beep', { vol: 0.5 }); break;
      case 'gas': if (e.p === 0) audio.play('gasTick', { vol: 0.35 }); break;
      case 'throw': if (e.p === 0) audio.play('jump', { vol: 0.25 }); break;
      case 'announce':
        if (e.text === '__infil__') { this.hud.showBanner('Verdansk', 'Battle Royale — Trios • 150 players'); this.camYaw = Math.atan2(-sim.plane.dx, -sim.plane.dz); this.camPitch = -0.2; audio.play('uiBuy', { vol: 0.4 }); }
        if (e.text === '__buy__' && e.squad === me.squad && me.phase === Phase.Alive && sim.interactTarget(me)?.kind === 'buy') { document.exitPointerLock?.(); this.hud.openBuy((k, a) => { const r = sim.buy(me, k, a); if (!r) audio.play('uiBuy'); return r; }, () => (document.getElementById('game') as HTMLElement).requestPointerLock?.()); }
        if (e.text === '__loadout__' && e.squad === me.squad && me.phase === Phase.Alive) { document.exitPointerLock?.(); this.hud.openLoadout((i) => { sim.applyLoadout(me, i); (document.getElementById('game') as HTMLElement).requestPointerLock?.(); }); }
        break;
    }
  }

  private viewId() { return this.me.alive || this.me.phase === Phase.Downed ? 0 : this.spectate >= 0 ? this.spectate : 0; }

  private render(dt: number, time: number) {
    const sim = this.sim, me = this.me, a = this.clock.alpha, cam = this.sm.camera;
    // spectate a squadmate when dead
    if (!me.alive && me.phase === Phase.Dead) {
      const sp = sim.players[this.spectate];
      if (!sp || !sp.alive || sp.squad !== me.squad) { const m = sim.players.find((q) => q.squad === me.squad && q.alive && q.id !== me.id); this.spectate = m ? m.id : -1; }
    } else this.spectate = -1;
    const vp = this.spectate >= 0 ? sim.players[this.spectate] : me;
    const x = vp.px + (vp.x - vp.px) * a, y = vp.py + (vp.y - vp.py) * a, z = vp.pz + (vp.z - vp.pz) * a;
    const w = me.weapons[me.cur];
    const def = w ? WEAPON[w.id] : null;
    let fov = this.settings.fov;
    this.chars.hidden = 0; this.chars.canopyOnly = false;
    this.landDip = Math.max(0, this.landDip - dt * 1.5);
    const phase = vp.phase;
    const yaw = this.spectate >= 0 ? vp.yaw : this.camYaw + me.recoilYaw, pitch = this.spectate >= 0 ? vp.pitch : this.camPitch + me.recoil;
    if (phase === Phase.Plane) {
      const pl = sim.plane;
      const dist = 55;
      cam.position.set(pl.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist, pl.y + 10 - Math.sin(this.camPitch) * dist, pl.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist);
      cam.lookAt(pl.x, pl.y, pl.z);
      audio.loop('engine', 0.5, 1, 1200); audio.loop('wind', 0.15, 1, 900);
    } else if (phase === Phase.Freefall || phase === Phase.Chute) {
      // first person by default; hold the third-person key to look at yourself
      const tp = this.controls.thirdPersonHeld && this.spectate < 0;
      this.tpBlend += ((tp ? 1 : 0) - this.tpBlend) * Math.min(1, dt * 8);
      this.chars.hidden = this.tpBlend > 0.35 ? -1 : vp.id; this.chars.canopyOnly = this.tpBlend <= 0.35;
      this.tpDist += ((phase === Phase.Chute ? 9 : 6) - this.tpDist) * Math.min(1, dt * 3);
      const cp = Math.max(-1.2, Math.min(0.6, this.camPitch));
      const fx = x, fy = y + 1.62, fz = z;
      const tx = x + Math.sin(this.camYaw) * Math.cos(cp) * this.tpDist, ty = y + 1.6 - Math.sin(cp) * this.tpDist + 1.5, tz = z + Math.cos(this.camYaw) * Math.cos(cp) * this.tpDist;
      const k = this.tpBlend;
      cam.position.set(fx + (tx - fx) * k, fy + (ty - fy) * k, fz + (tz - fz) * k);
      cam.rotation.set(this.camPitch, this.camYaw, (phase === Phase.Chute ? -vp.intent.mx * 0.08 : 0) * (1 - k), 'YXZ');
      if (k > 0.01) { const q0 = cam.quaternion.clone(); cam.lookAt(x, y + 1.4, z); cam.quaternion.copy(q0.slerp(cam.quaternion, k)); }
      const sp = Math.hypot(vp.vx, vp.vy, vp.vz);
      audio.loop('engine', Math.max(0, 0.4 - Math.hypot(sim.plane.x - x, sim.plane.z - z) / 800), 1, 800);
      audio.loop('wind', phase === Phase.Freefall ? clamp(sp / 70, 0.2, 0.9) : 0.25, phase === Phase.Freefall ? 1 : 0.7, phase === Phase.Freefall ? 6000 : 2500);
    } else if (vehicleOf(sim, vp) && (vp as any).seat === 0) {
      const v = vehicleOf(sim, vp)!, d = VEHICLES[v.type];
      const dist = d.len * 1.4 + 5, cp = Math.max(-0.6, Math.min(0.9, this.camPitch));
      const vx = v.px + (v.x - v.px) * a, vy = v.py + (v.y - v.py) * a, vz = v.pz + (v.z - v.pz) * a;
      cam.position.set(vx + Math.sin(this.camYaw) * Math.cos(cp) * dist, vy + d.hgt + 1.5 - Math.sin(cp) * dist, vz + Math.cos(this.camYaw) * Math.cos(cp) * dist);
      cam.lookAt(vx, vy + d.hgt * 0.8, vz);
      this.chars.hidden = -1;
      audio.loop('engine', 0.25 + Math.min(0.35, v.speed / 60), 0.7 + v.speed / 40, d.air ? 1500 : 700);
    } else if (this.spectate >= 0 && phase !== Phase.Gulag) {
      this.chars.hidden = -1;
      cam.position.set(x + Math.sin(yaw) * 4, y + 2.6, z + Math.cos(yaw) * 4);
      cam.lookAt(x, y + 1.5, z);
      audio.loop('wind', 0); audio.loop('engine', 0);
    } else {
      // first person: eye height eases between stances (prone is slower), slides tilt the view
      const target = eyeHeight(vp) - (vp.slideT > 0 ? 0.15 : 0);
      if (this.eyeFor !== vp.id || Math.abs(target - this.eye) > 2) { this.eye = target; this.eyeFor = vp.id; }
      const rate = vp.stance === Stance.Prone || this.eye < 0.9 ? 5.5 : 11;
      this.eye += (target - this.eye) * (1 - Math.exp(-dt * rate));
      this.roll += ((vp.slideT > 0 ? 0.055 : 0) - this.roll) * (1 - Math.exp(-dt * 10));
      cam.position.set(x, y + this.eye - this.landDip * 0.4, z);
      cam.rotation.set(pitch, yaw, this.roll, 'YXZ');
      if (vp.slideT > 0) fov += 4;
      if (def && me.ads > 0 && (this.settings.adsFovAffected || def.scope)) fov = fov / (1 + (def.zoom - 1) * me.ads);
      if (me.tacSprint > 0) fov += 6;
      audio.loop('wind', 0); audio.loop('engine', vehicleOf(sim, vp) ? 0.3 : 0, 0.8, 700); audio.loop('chute', 0);
    }
    if (this.debugCam) { cam.position.set(...this.debugCam.pos); cam.lookAt(...this.debugCam.target); this.chars.hidden = -1; }
    audio.loop('gas', sim.inGas(vp) ? 0.45 : 0, 1, 900);
    if (this.sm.grade) { const u = this.sm.grade.uniforms; u.uGas.value += ((sim.inGas(vp) ? 1 : 0) - u.uGas.value) * Math.min(1, dt * 3); u.uLow.value += ((vp.phase === Phase.Downed ? 0.6 : vp.health < 35 && vp.alive ? 0.35 : 0) - u.uLow.value) * Math.min(1, dt * 4); }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
    // listener
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);
    // world
    this.chars.update(sim.players, a, cam.position, dt, me.squad);
    this.fx.update(dt, a, cam.position, time, cam.fov);
    this.vehMeshes.update(sim.vehicles, a, dt, cam.position);
    // hide the local body in first person, show it otherwise
    this.sm.render();
    // viewmodel
    const fp = (phase === Phase.Alive || phase === Phase.Gulag || phase === Phase.GulagWait) && !(vehicleOf(sim, vp) && (vp as any).seat === 0);
    if (fp && this.spectate < 0 && !this.debugCam) {
      this.vm.update(me, dt, this.lastMouse.dx, this.lastMouse.dy, Math.hypot(me.vx, me.vz), me.sprinting);
      this.vm.render(this.sm.renderer);
    }
    // HUD
    const proj = new THREE.Vector3();
    const project = (px: number, py: number, pz: number): [number, number, boolean] => { proj.set(px, py, pz).project(cam); return [(proj.x * 0.5 + 0.5) * innerWidth, (-proj.y * 0.5 + 0.5) * innerHeight, proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1]; };
    this.hud.update(dt, this.spectate >= 0 ? vp.yaw : this.camYaw, pitch, project, { ads: me.ads, scope: !!def?.scope, optic: this.vm.optic, spectating: this.spectate >= 0 ? vp : null, mapOpen: this.mapOpen });
    void wrapAngle;
  }
}
