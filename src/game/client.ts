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
import { Hud } from '../ui/hud';
import { audio } from '../audio/audio';
import type { WorldData } from '../world/mapgen';
import { clamp, wrapAngle } from '../core/math';

export interface Settings { sens: number; adsSens: number; volume: number; fov: number }

export class Match {
  sim: Sim;
  hud: Hud;
  chars = new Characters();
  vm = new ViewModel();
  fx: Effects;
  clock = new FixedStep(1 / 60);
  camYaw = 0; camPitch = 0;
  mapOpen = false; paused = false;
  spectate = -1;
  private lastMouse = { dx: 0, dy: 0 };
  private landDip = 0;
  private done = false;
  onEnd: (won: boolean, placement: number, me: Player) => void = () => {};
  private pauseEl: HTMLElement | null = null;
  private tpDist = 0;

  constructor(public sm: SceneMgr, private world: WorldData, private input: Input, tac: HTMLCanvasElement, private ui: HTMLElement, public settings: Settings, seed: number) {
    this.sim = new Sim(world, seed, { humans: 1 });
    this.hud = new Hud(this.sim, tac, 0);
    ui.appendChild(this.hud.root);
    this.fx = new Effects(this.sim, sm.scene);
    sm.scene.add(this.chars.group);
    this.chars.hidden = 0;
    this.camYaw = Math.atan2(-this.sim.plane.dx, -this.sim.plane.dz);
    this.vm.setAspect(innerWidth / innerHeight);
    this.vm.scene.environment = sm.scene.environment; this.vm.scene.environmentIntensity = 0.6;
    addEventListener('resize', () => this.vm.setAspect(innerWidth / innerHeight));
    this.hud.showBanner('Verdansk', 'Battle Royale — Trios • 150 players');
  }

  dispose() {
    this.sm.scene.remove(this.chars.group); this.sm.scene.remove(this.fx.group);
    this.hud.root.remove(); this.pauseEl?.remove();
    audio.loop('engine', 0); audio.loop('wind', 0); audio.loop('gas', 0); audio.loop('chute', 0);
  }

  get me() { return this.sim.players[0]; }

  private fillIntent() {
    const p = this.me, it = p.intent, inp = this.input;
    const blocked = !!this.hud.panel || this.paused;
    if (blocked) { it.mx = it.mz = 0; it.fire = it.ads = it.sprint = it.interact = it.plate = false; inp.clearPresses(); return; }
    it.mx = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    it.mz = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const shiftPress = inp.press('ShiftLeft');
    it.sprint = inp.down('ShiftLeft') || (p.sprinting && it.mz > 0);
    if (shiftPress && p.sprinting) (it as any).tac = true;
    if (inp.press('Space')) it.jump = true;
    if (inp.press('KeyC')) it.crouch = true;
    if (inp.press('KeyZ') || inp.press('ControlLeft')) it.prone = true;
    it.fire = inp.mouseDown[0] && !this.mapOpen;
    it.ads = inp.mouseDown[2] && !this.mapOpen;
    if (inp.press('KeyR')) it.reload = true; else it.reload = false;
    it.interact = inp.down('KeyF');
    it.selfRevive = p.phase === Phase.Downed && inp.down('KeyF');
    it.plate = inp.down('Digit4');
    if (inp.press('Digit1')) it.slot = 1; if (inp.press('Digit2')) it.slot = 2;
    const wh = inp.consumeWheel(); if (wh !== 0 || inp.press('KeyX')) it.swap = true;
    if (inp.press('KeyG')) it.lethal = true;
    if (inp.press('KeyQ')) it.tactical = true;
    if (inp.press('Digit5')) it.killstreak = true;
    if (inp.press('KeyM')) this.mapOpen = !this.mapOpen;
    it.yaw = this.camYaw; it.pitch = this.camPitch;
  }

  private look() {
    const { dx, dy } = this.input.consumeMouse();
    this.lastMouse = { dx, dy };
    if (this.hud.panel || this.paused) return;
    const p = this.me, w = p.weapons[p.cur];
    const zoom = w ? 1 + (WEAPON[w.id].zoom * (rarityMods(w.rarity).scope && !WEAPON[w.id].scope ? 1.3 : 1) - 1) * p.ads : 1;
    const s = this.settings.sens * 0.0022 * (1 + (1 / zoom - 1) * (this.settings.adsSens > 0 ? 1 : 0)) * (p.stunT > 0 ? 0.35 : 1);
    this.camYaw -= dx * s;
    this.camPitch = clamp(this.camPitch - dy * s, -1.45, 1.45);
  }

  frame(dt: number, time: number) {
    const inp = this.input;
    if (inp.press('Escape')) { if (this.hud.panel) this.hud.closePanel(); else if (this.mapOpen) this.mapOpen = false; else this.togglePause(); }
    this.look();
    if (!this.paused) {
      this.clock.advance(dt, (step) => {
        this.fillIntent();
        this.sim.tick(step);
        for (const e of this.sim.events) this.handleEvent(e);
        this.sim.events.length = 0;
        // one-shot intents are consumed by the tick
        const it = this.me.intent; it.jump = false; it.crouch = false; it.prone = false; it.lethal = false; it.tactical = false; it.killstreak = false; it.swap = false; it.slot = 0; (it as any).tac = false;
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
      const p = document.createElement('div'); p.className = 'menu';
      p.innerHTML = `<h1>PAUSED</h1><h2>VERDANSK</h2><button data-a="resume">Resume</button><div class="row">Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" value="${this.settings.sens}" data-s="sens"></div><div class="row">Volume <input type="range" min="0" max="1" step="0.05" value="${this.settings.volume}" data-s="volume"></div><button data-a="quit">Leave match</button>`;
      p.querySelector('[data-a=resume]')!.addEventListener('click', () => this.togglePause());
      p.querySelector('[data-a=quit]')!.addEventListener('click', () => { this.paused = false; this.onEnd(false, this.placement(), this.me); });
      p.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { (this.settings as any)[i.dataset.s!] = +i.value; if (i.dataset.s === 'volume') audio.setVolume(+i.value); localStorage.setItem('vd-settings', JSON.stringify(this.settings)); }));
      this.ui.appendChild(p); this.pauseEl = p;
    } else { this.pauseEl?.remove(); this.pauseEl = null; (document.getElementById('game') as HTMLElement).requestPointerLock?.(); }
  }

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
    this.chars.hidden = 0;
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
      this.chars.hidden = -1;
      this.tpDist += ((phase === Phase.Chute ? 9 : 6) - this.tpDist) * Math.min(1, dt * 3);
      const cp = Math.max(-1.2, Math.min(0.6, this.camPitch));
      cam.position.set(x + Math.sin(this.camYaw) * Math.cos(cp) * this.tpDist, y + 1.6 - Math.sin(cp) * this.tpDist + 1.5, z + Math.cos(this.camYaw) * Math.cos(cp) * this.tpDist);
      cam.lookAt(x, y + 1.4, z);
      const sp = Math.hypot(vp.vx, vp.vy, vp.vz);
      audio.loop('engine', Math.max(0, 0.4 - Math.hypot(sim.plane.x - x, sim.plane.z - z) / 800), 1, 800);
      audio.loop('wind', phase === Phase.Freefall ? clamp(sp / 70, 0.2, 0.9) : 0.25, phase === Phase.Freefall ? 1 : 0.7, phase === Phase.Freefall ? 6000 : 2500);
    } else if (this.spectate >= 0 && phase !== Phase.Gulag) {
      this.chars.hidden = -1;
      cam.position.set(x + Math.sin(yaw) * 4, y + 2.6, z + Math.cos(yaw) * 4);
      cam.lookAt(x, y + 1.5, z);
      audio.loop('wind', 0); audio.loop('engine', 0);
    } else {
      // first person
      const eh = eyeHeight(vp) - this.landDip * 0.4;
      cam.position.set(x, y + eh, z);
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
      if (def && me.ads > 0) fov = fov / (1 + (def.zoom - 1) * me.ads);
      if (me.tacSprint > 0) fov += 6;
      audio.loop('wind', 0); audio.loop('engine', 0); audio.loop('chute', 0);
    }
    audio.loop('gas', sim.inGas(vp) ? 0.45 : 0, 1, 900);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
    // listener
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);
    // world
    this.chars.update(sim.players, a, cam.position, dt, me.squad);
    this.fx.update(dt, a, cam.position, time, cam.fov);
    // hide the local body in first person, show it otherwise
    this.sm.render();
    // viewmodel
    const fp = phase === Phase.Alive || phase === Phase.Gulag || phase === Phase.GulagWait;
    if (fp && this.spectate < 0) {
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
