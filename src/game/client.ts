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
import { LootMeshes } from '../render/loot';
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
  loot: LootMeshes;
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
  private reloadCue: { at: number; bolt: number } | null = null;
  private surfCache = new Map<number, string>();
  private tpBlend = 0; private eye = 1.62; private eyeFor = -1; private roll = 0;
  /** Dev/test: pin the camera (position + look target) regardless of phase. */
  debugCam: { pos: [number, number, number]; target: [number, number, number] } | null = null;

  constructor(public sm: SceneMgr, private world: WorldData, private input: Input, tac: HTMLCanvasElement, private ui: HTMLElement, public settings: Settings, seed: number) {
    this.sim = new Sim(world, seed, { humans: 1, warmup: 45 });
    this.controls = new Controls(input, settings);
    input.onUnlock = () => { if (!this.menuOpen && !this.hud.panel && !this.done) this.togglePause(); };
    this.fpsEl.className = 'fps'; ui.appendChild(this.fpsEl);
    this.hud = new Hud(this.sim, tac, 0, settings);
    ui.appendChild(this.hud.root);
    this.fx = new Effects(this.sim, sm.scene);
    sm.scene.add(this.chars.group);
    sm.scene.add(this.vehMeshes.group);
    this.loot = new LootMeshes(this.sim); sm.scene.add(this.loot.group);
    this.chars.hidden = 0;
    this.camYaw = Math.atan2(-this.sim.plane.dx, -this.sim.plane.dz);
    this.vm.setAspect(innerWidth / innerHeight);
    this.vm.scene.environment = sm.scene.environment; this.vm.scene.environmentIntensity = 0.6;
    addEventListener('resize', () => this.vm.setAspect(innerWidth / innerHeight));
    this.hud.showBanner('Warm-up', 'Waiting for players • respawns are on');
    this.camYaw = this.me.yaw;
  }

  dispose() {
    this.sm.scene.remove(this.chars.group); this.sm.scene.remove(this.fx.group); this.sm.scene.remove(this.vehMeshes.group); this.sm.scene.remove(this.loot.group);
    this.hud.root.remove(); this.pauseEl?.remove(); this.fpsEl.remove(); this.closeSettings(); this.input.onUnlock = () => {};
    audio.stopLoops();
  }

  get me() { return this.sim.players[0]; }

  private fillIntent() {
    const blocked = !!this.hud.panel || this.paused || this.menuOpen;
    this.controls.apply(this.me, this.camYaw, this.camPitch, blocked);
    (this.me as any).prefs = { autoChute: this.settings.chuteAutoDeploy, emptySwitch: this.settings.depletedAmmoSwitch };
    if (this.mapOpen) { this.me.intent.fire = false; this.me.intent.ads = false; }
  }

  private look() {
    const { dx, dy } = this.input.consumeMouse();
    this.lastMouse = { dx, dy };
    if (this.hud.panel || this.menuOpen) return;
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
    this.paused = this.menuOpen && this.settings.pauseOnMenu;
    this.look();
    if (!this.menuOpen && !this.hud.panel) {
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

  private menuOpen = false;
  private togglePause() {
    this.menuOpen = !this.menuOpen;
    this.paused = this.menuOpen && this.settings.pauseOnMenu;
    if (this.menuOpen) {
      document.exitPointerLock?.();
      const p = document.createElement('div'); p.className = 'menu pause';
      p.innerHTML = `<h1>PAUSED</h1><h2>VERDANSK • BATTLE ROYALE</h2><button data-a="resume">Resume</button><button data-a="settings">Settings</button><button data-a="quit">Leave match</button><div class="sub">${this.settings.pauseOnMenu ? 'The match is paused while this menu is open.' : 'The match keeps running while this menu is open.'}</div>`;
      p.querySelector<HTMLElement>('[data-a=resume]')!.onclick = () => this.togglePause();
      p.querySelector<HTMLElement>('[data-a=settings]')!.onclick = () => this.openSettings();
      p.querySelector<HTMLElement>('[data-a=quit]')!.onclick = () => { this.paused = false; this.menuOpen = false; this.pauseEl?.remove(); this.done = true; this.onEnd(false, this.placement(), this.me); };
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
        if (e.p === this.viewId()) { audio.gunshot(def.cls, null); this.vm.fire(); }
        else audio.gunshot(def.cls, { x: e.x, y: e.y, z: e.z });
        if (def.bolt && e.p === 0) setTimeout(() => audio.play('bolt', { vol: 0.5 }), 350);
        if (def.pump && e.p === 0) setTimeout(() => audio.play('bolt', { vol: 0.6, rate: 0.8 }), 260);
        break;
      }
      case 'hit': {
        const hs = this.settings.hitmarkerSounds;
        if (e.attacker === 0 && hs) {
          audio.play(e.kill ? 'kill' : e.down ? 'down' : e.armorBroke ? 'armorBreak' : e.armorHit ? 'hitArmor' : e.head ? 'headshot' : 'hit', { vol: e.armorBroke ? 0.95 : 0.7 });
        }
        if (e.victim === 0) { audio.play(e.armorBroke ? 'selfArmorBreak' : 'bodyHit', { vol: 0.7 }); }
        break;
      }
      case 'impact': if (d(e.x, e.y, e.z) < 30) audio.play(e.water ? 'impactWater' : e.mat === 3 || e.mat === 9 ? 'impactMetal' : e.mat === 4 ? 'impactWood' : e.mat === 5 ? 'impactGlass' : 'impact', { x: e.x, y: e.y, z: e.z, range: 10, vol: 0.45, throttle: 0.03 }); break;
      case 'explosion': if (e.kind === 'smoke' || e.kind === 'flash' || e.kind === 'stun') { audio.play('impact', { x: e.x, y: e.y, z: e.z, range: 30, vol: 1 }); break; } audio.play(d(e.x, e.y, e.z) > 250 ? 'explosionFar' : 'explosion', { x: e.x, y: e.y, z: e.z, range: 160, vol: e.kind === 'airstrike' ? 1.4 : 1, delay: true }); break;
      case 'step': {
        if (e.p !== 0 && d(e.x, e.y, e.z) > 40) break;
        const surf = this.surfaceAt(e.x, e.y, e.z);
        const q = sim.players[e.p];
        audio.play(('step_' + surf) as any, e.p === 0 ? { vol: 0.16 } : { x: e.x, y: e.y, z: e.z, range: 9, vol: q.sprinting ? 1.0 : 0.6 });
        break;
      }
      case 'plate': if (e.p === 0 && !e.done) audio.play('plate', { vol: 0.65 }); else if (e.p !== 0 && !e.done && d(sim.players[e.p].x, sim.players[e.p].y, sim.players[e.p].z) < 20) { const q = sim.players[e.p]; audio.play('plate', { x: q.x, y: q.y + 1, z: q.z, range: 6, vol: 0.5 }); } break;
      case 'reload': if (e.p === 0) { if (e.w === 'swap') audio.play('swap', { vol: 0.5 }); else { audio.play('magOut', { vol: 0.55 }); const def = WEAPON[e.w]; this.reloadCue = { at: this.sim.time + (def?.reload ?? 1.5) * 0.7, bolt: this.sim.time + (def?.reload ?? 1.5) * 0.92 }; } } break;
      case 'pickup': if (e.p === 0) audio.play(e.kind === 3 ? 'cash' : 'pickup', { vol: 0.55 }); break;
      case 'chest': if (d(e.x, e.y, e.z) < 40) audio.play('crate', { x: e.x, y: e.y, z: e.z, range: 12 }); break;
      case 'jump': if (e.p === 0) audio.play('jump', { vol: 0.35 }); break;
      case 'land': if (e.p === 0) { audio.play('land', { vol: e.hard ? 0.9 : 0.5 }); this.landDip = e.hard ? 0.35 : 0.15; } break;
      case 'slide': if (e.p === 0) audio.play('slide', { vol: 0.5 }); else { const q = sim.players[e.p]; if (d(q.x, q.y, q.z) < 25) audio.play('slide', { x: q.x, y: q.y, z: q.z, range: 8, vol: 0.6 }); } break;
      case 'chute': if (e.p === 0) audio.play(me.phase === Phase.Chute ? 'chute' : 'chuteCut', { vol: 0.8 }); break;
      case 'whiz': audio.play('whiz', { x: e.x, y: e.y, z: e.z, range: 4, vol: 0.6, throttle: 0.05 }); break;
      case 'dryfire': if (e.p === 0) audio.play('dry', { vol: 0.5 }); break;
      case 'down': if (e.victim === 0) audio.play('downed', { vol: 0.8 }); break;
      case 'revive': if (e.p === 0) audio.play('revive', { vol: 0.6 }); break;
      case 'buy': if (e.p === 0) audio.play('uiBuy', { ui: true, vol: 0.6 }); if (sim.players[e.p].squad === me.squad) { if (e.item === 'uav') {} else if (e.item === 'loadout') audio.say('Loadout drop inbound.'); } break;
      case 'uav': audio.say(e.squad === me.squad ? 'UAV online.' : 'Enemy UAV overhead.'); break;
      case 'gas': if (e.p === 0 && Math.random() < 0.35) audio.play('cough', { vol: 0.55, throttle: 1.2 }); break;
      case 'throw': if (e.p === 0) { audio.play('pin', { vol: 0.4 }); audio.play('throw', { vol: 0.5 }); } break;
      case 'melee': if (e.p === 0) audio.play('melee', { vol: 0.6 }); break;
      case 'marker': if (e.squad === me.squad) audio.say(e.kind === 'loadout' ? 'Loadout drop inbound.' : e.kind === 'cluster' ? 'Cluster strike inbound.' : 'Precision airstrike inbound.'); break;
      case 'circle': if (e.closing) audio.play('stinger', { music: true, vol: 0.7 }); break;
      case 'win': audio.play(e.squad === me.squad ? 'musicVictory' : 'musicDefeat', { music: true }); break;
      case 'gulag': if (e.p === 0 && e.msg === 'enter') audio.say('Welcome to the Gulag.'); if (e.p === 0 && e.msg === 'overtime') audio.play('flag', { ui: true }); break;
      case 'squadwipe': if (e.squad === me.squad) audio.say('Your squad has been eliminated.'); break;
      case 'contract': if (e.p >= 0 && sim.players[e.p].squad === me.squad) audio.say(e.msg === 'start' ? 'Contract accepted.' : e.msg === 'done' ? 'Contract complete.' : e.msg === 'fail' ? 'Contract failed.' : 'Next target marked.'); break;
      case 'announce':
        if (e.text === '__infil__') { audio.play('musicInfil', { music: true, vol: 0.8 }); this.hud.showBanner('Verdansk', 'Battle Royale — Trios • 150 players'); this.camYaw = Math.atan2(-sim.plane.dx, -sim.plane.dz); this.camPitch = -0.2; audio.play('uiBuy', { vol: 0.4 }); }
        if (e.text === '__buy__' && e.squad === me.squad && me.phase === Phase.Alive && sim.interactTarget(me)?.kind === 'buy') { document.exitPointerLock?.(); this.hud.openBuy((k, a) => { const r = sim.buy(me, k, a); if (!r) audio.play('uiBuy'); return r; }, () => (document.getElementById('game') as HTMLElement).requestPointerLock?.()); }
        if (e.text === '__loadout__' && e.squad === me.squad && me.phase === Phase.Alive) { document.exitPointerLock?.(); this.hud.openLoadout((i) => { sim.applyLoadout(me, i); (document.getElementById('game') as HTMLElement).requestPointerLock?.(); }); }
        break;
    }
  }

  /** Ground material under a point (for footsteps). */
  private surfaceAt(x: number, y: number, z: number): string {
    const col = this.sim.world.col, hit = this.hitTmp;
    if (col.raycast(x, y + 0.4, z, 0, -1, 0, 1.2, hit, undefined, false)) {
      if (hit.structure >= 0) return hit.mat === 3 || hit.mat === 9 ? 'metal' : hit.mat === 4 ? 'wood' : 'concrete';
      const w = this.sim.world, k = Math.round(z / w.hf.step) * w.hf.res + Math.round(x / w.hf.step);
      return w.extra.road[k] > 0.4 || w.extra.paved[k] > 0.4 ? 'concrete' : 'dirt';
    }
    return 'dirt';
  }
  private hitTmp = { t: 0, nx: 0, ny: 0, nz: 0, structure: -1, part: -1, mat: 0 as any, terrain: false, water: false };

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
      audio.loop('wind', phase === Phase.Freefall ? clamp(sp / 70, 0.25, 0.95) : 0.2, phase === Phase.Freefall ? 1 + sp / 200 : 0.7, phase === Phase.Freefall ? 5000 : 1800);
      audio.loop('chute', phase === Phase.Chute ? 0.35 : 0);
    } else if (vehicleOf(sim, vp) && (vp as any).seat === 0) {
      const v = vehicleOf(sim, vp)!, d = VEHICLES[v.type];
      const dist = d.len * 1.4 + 5, cp = Math.max(-0.6, Math.min(0.9, this.camPitch));
      const vx = v.px + (v.x - v.px) * a, vy = v.py + (v.y - v.py) * a, vz = v.pz + (v.z - v.pz) * a;
      cam.position.set(vx + Math.sin(this.camYaw) * Math.cos(cp) * dist, vy + d.hgt + 1.5 - Math.sin(cp) * dist, vz + Math.cos(this.camYaw) * Math.cos(cp) * dist);
      cam.lookAt(vx, vy + d.hgt * 0.8, vz);
      this.chars.hidden = -1;
      audio.loop(d.air ? 'heli' : 'vehicle', 0.35 + Math.min(0.35, v.speed / 60), d.air ? 0.8 + v.rotor * 0.3 : 0.7 + v.speed / 30, d.air ? 3000 : 1200);
      audio.loop(d.air ? 'vehicle' : 'heli', 0);
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
      const vv = vehicleOf(sim, vp);
      audio.loop('wind', 0); audio.loop('engine', 0); audio.loop('chute', 0);
      audio.loop(vv?.type === 'heli' ? 'heli' : 'vehicle', vv ? 0.3 : 0, vv ? 0.7 + vv.speed / 30 : 1, 1000);
    }
    if (this.debugCam) { cam.position.set(...this.debugCam.pos); cam.lookAt(...this.debugCam.target); this.chars.hidden = -1; }
    audio.loop('gas', sim.inGas(vp) ? 0.45 : 0, 1, 900);
    audio.loop('tinnitus', vp.flashT > 0 || vp.stunT > 0 ? 0.2 : 0);
    // environment: indoors if there's a roof overhead; the world muffles in gas, when downed or stunned
    const roof = sim.world.col.ceilingAt(cam.position.x, cam.position.z, cam.position.y + 0.5, 0.2);
    audio.setEnvironment(roof - cam.position.y < 12 && vp.phase === Phase.Alive, vp.phase === Phase.Downed ? 0.45 : sim.inGas(vp) ? (vp.hasMask ? 0.2 : 0.35) : vp.flashT > 0 || vp.stunT > 0 ? 0.6 : 0);
    if (this.reloadCue && vp === me) { if (me.reloadT <= 0) this.reloadCue = null; else if (sim.time >= this.reloadCue.at) { audio.play('magIn', { vol: 0.55 }); this.reloadCue.at = Infinity; } else if (sim.time >= this.reloadCue.bolt) { audio.play('bolt', { vol: 0.45 }); this.reloadCue = null; } }
    if (this.sm.grade) { const u = this.sm.grade.uniforms; u.uGas.value += ((sim.inGas(vp) ? 1 : 0) - u.uGas.value) * Math.min(1, dt * 3); u.uLow.value += ((vp.phase === Phase.Downed ? 0.6 : vp.health < 35 && vp.alive ? 0.35 : 0) - u.uLow.value) * Math.min(1, dt * 4); }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
    // listener
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);
    // world
    this.chars.update(sim.players, a, cam.position, dt, me.squad);
    this.fx.update(dt, a, cam.position, time, cam.fov);
    this.vehMeshes.update(sim.vehicles, a, dt, cam.position);
    { const t = me.phase === Phase.Alive ? sim.interactTarget(me) : null; this.loot.update(dt, cam.position, time, t?.kind === 'item' ? t.id : -1); }
    // hide the local body in first person, show it otherwise
    this.sm.render();
    // viewmodel
    const fp = (phase === Phase.Alive || phase === Phase.Gulag || phase === Phase.GulagWait) && !(vehicleOf(sim, vp) && (vp as any).seat === 0);
    this.vm.updateAir(this.spectate < 0 ? me : null, dt, this.tpBlend < 0.35 && !this.debugCam);
    if ((phase === Phase.Freefall || phase === Phase.Chute) && this.tpBlend < 0.35 && !this.debugCam) this.vm.render(this.sm.renderer);
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
