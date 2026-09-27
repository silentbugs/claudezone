import * as THREE from 'three';
import { SceneMgr } from './render/scene';
import { loadMasksBrowser, POIS } from './world/mapdata';
import { generateWorld } from './world/mapgen';
import { Input } from './core/input';
import { renderTacMap } from './ui/mapImage';
import { Match, Settings } from './game/client';
import { audio } from './audio/audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const settings: Settings = Object.assign({ sens: 1, adsSens: 1, volume: 0.7, fov: 80, quality: 'high' }, JSON.parse(localStorage.getItem('vd-settings') ?? '{}'));

async function boot() {
  const loading = document.createElement('div'); loading.className = 'loading'; loading.textContent = 'BUILDING VERDANSK...'; ui.appendChild(loading);
  const sm = new SceneMgr(canvas);
  const masks = await loadMasksBrowser();
  await new Promise((r) => setTimeout(r, 30));
  const world = generateWorld(masks, 1);
  sm.buildWorld(world);
  sm.setQuality(settings.quality as any);
  const tac = renderTacMap(world);
  loading.remove();
  const input = new Input(canvas);
  let match: Match | null = null;
  let menuT = 0;
  const cam = sm.camera;

  const menu = document.createElement('div'); menu.className = 'menu';
  const showMenu = () => {
    menu.innerHTML = `<h1>VERDANSK</h1><h2>BATTLE ROYALE • 2020</h2>
      <button data-a="play">Play — Trios (150)</button>
      <button data-a="controls">Controls</button>
      <div class="row">Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" value="${settings.sens}" data-s="sens"></div>
      <div class="row">Field of view <input type="range" min="65" max="100" step="1" value="${settings.fov}" data-s="fov"></div>
      <div class="row">Volume <input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-s="volume"></div>
      <div class="row">Graphics <select data-q>${['low', 'medium', 'high', 'ultra'].map((q) => `<option ${q === settings.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></div>
      <div class="sub">A fan rebuild of the original 2020 Verdansk: the map traced from the 2020 tac map, C-130 infil, gas circles, armor plates, loot rarities, supply boxes, buy stations, contracts, the Gulag, redeploys and 149 bots. All art and audio are generated in code.</div>`;
    menu.querySelector('[data-a=play]')!.addEventListener('click', start);
    menu.querySelector('[data-a=controls]')!.addEventListener('click', () => { const k = document.createElement('div'); k.className = 'panel'; k.innerHTML = `<h3>Controls</h3><div style="line-height:1.9;font-size:15px">WASD move • Mouse look • LMB fire • RMB aim<br>Shift sprint (press again while sprinting: tactical sprint)<br>Space jump / mantle / deploy & cut parachute / jump from plane<br>C crouch (while sprinting: slide) • Z or Ctrl prone<br>R reload • F interact (hold to revive / self-revive) • 4 armor plate (hold to chain)<br>1 / 2 / X / wheel switch weapon • G lethal • Q tactical • 5 killstreak<br>M tac map (click to place a marker) • Esc pause</div><div class="close">click to close</div>`; k.addEventListener('click', () => k.remove()); ui.appendChild(k); });
    menu.querySelector('[data-q]')!.addEventListener('change', (e) => { settings.quality = (e.target as HTMLSelectElement).value; sm.setQuality(settings.quality as any); localStorage.setItem('vd-settings', JSON.stringify(settings)); });
    menu.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { (settings as any)[i.dataset.s!] = +i.value; if (i.dataset.s === 'volume') audio.setVolume(+i.value); localStorage.setItem('vd-settings', JSON.stringify(settings)); }));
    ui.appendChild(menu);
  };
  const start = () => {
    audio.init(); audio.setVolume(settings.volume);
    menu.remove();
    match = new Match(sm, world, input, tac, ui, settings, (Date.now() & 0xffff) + 1);
    match.onEnd = (won, place, me) => {
      document.exitPointerLock?.();
      const e = document.createElement('div'); e.className = 'endscr';
      e.innerHTML = `<div class="big ${won ? 'win' : ''}">${won ? 'WARZONE VICTORY' : `#${place}`}</div><div class="stats"><div><b>${me.kills}</b>Kills</div><div><b>${Math.round(me.damage)}</b>Damage</div><div><b>${Math.floor(match!.sim.time / 60)}:${String(Math.floor(match!.sim.time % 60)).padStart(2, '0')}</b>Time</div></div><button data-a="again">Play again</button><button data-a="menu">Main menu</button>`;
      e.querySelector('[data-a=again]')!.addEventListener('click', () => { e.remove(); match!.dispose(); match = null; location.reload(); });
      e.querySelector('[data-a=menu]')!.addEventListener('click', () => { e.remove(); match!.dispose(); match = null; showMenu(); });
      ui.appendChild(e);
    };
    canvas.requestPointerLock?.();

  };
  showMenu();
  (window as any).__vd = { sm, world, cam, start, get match() { return match; } };

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (match) match.frame(dt, now / 1000);
    else {
      // menu flyover around Verdansk
      menuT += dt * 0.02;
      const p = POIS.find((q) => q.id === 'stadium')!;
      cam.position.set(p.x + Math.cos(menuT) * 900, 320, p.z + Math.sin(menuT) * 900);
      cam.lookAt(p.x, 40, p.z);
      sm.render();
      input.consumeMouse();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  void THREE;
}
boot();
