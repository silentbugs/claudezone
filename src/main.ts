import { models } from './render/models';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import * as THREE from 'three';
import { SceneMgr } from './render/scene';
import { loadMasksBrowser, POIS } from './world/mapdata';
import { generateWorld } from './world/mapgen';
import { Input } from './core/input';
import { renderTacMap } from './ui/mapImage';
import { Match } from './game/client';
import { loadSettings, Settings } from './core/settings';
import { SettingsMenu } from './ui/settingsMenu';
import { audio } from './audio/audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const settings: Settings = loadSettings();

async function boot() {
  const loading = document.createElement('div'); loading.className = 'loading'; loading.textContent = 'BUILDING VERDANSK...'; ui.appendChild(loading);
  const sm = new SceneMgr(canvas);
  const [masks] = await Promise.all([loadMasksBrowser(), sm.loadPhotoMaterials(), models.load()]);
  await new Promise((r) => setTimeout(r, 30));
  const world = generateWorld(masks, 1);
  sm.buildWorld(world);
  sm.ao = settings.ao; sm.drawDistance = settings.drawDistance; sm.setQuality(settings.quality); sm.setRenderScale(settings.renderScale); sm.setFoliage(settings.foliage); sm.renderer.toneMappingExposure = settings.brightness;
  const tac = renderTacMap(world);
  loading.remove();
  const input = new Input(canvas);
  let match: Match | null = null;
  let menuT = 0;
  const cam = sm.camera;

  const applySetting = (k: keyof Settings) => {
    if (k === 'quality') sm.setQuality(settings.quality);
    if (k === 'renderScale') sm.setRenderScale(settings.renderScale);
    if (k === 'volume' || k === 'sfx' || k === 'ui') audio.setVolume(settings.volume, settings.sfx, settings.ui);
    if (k === 'announcer') audio.voiceOn = settings.announcer; audio.setMusic(settings.musicVolume);
    if (k === 'foliage') sm.setFoliage(settings.foliage);
    if (k === 'ao' || k === 'drawDistance') { sm.ao = settings.ao; sm.drawDistance = settings.drawDistance; sm.setQuality(settings.quality); }
    if (k === 'brightness') sm.renderer.toneMappingExposure = settings.brightness;
    if (k === 'musicVolume') audio.setMusic(settings.musicVolume);
  };
  const lastMode = () => { try { const m = +(localStorage.getItem('vd-mode') ?? 3); return m >= 1 && m <= 3 ? m : 3; } catch { return 3; } };
  const menu = document.createElement('div'); menu.className = 'menu';
  const showMenu = () => {
    menu.innerHTML = `<h1>VERDANSK</h1><h2>BATTLE ROYALE • 2020</h2>
      <div class="modes">${[1, 2, 3].map((n) => `<button data-m="${n}" class="${n === lastMode() ? 'sel' : ''}">${['Solos', 'Duos', 'Trios'][n - 1]}<small>150 players · ${[150, 75, 50][n - 1]} ${n === 1 ? 'players' : 'squads'}</small></button>`).join('')}</div>
      <button data-a="settings">Settings</button>
      <div class="sub">A fan rebuild of the original 2020 Verdansk: the map traced from the 2020 tac map, C-130 infil, gas circles, armor plates, loot rarities, supply boxes, buy stations, contracts, the Gulag, redeploys and 149 bots in Solos, Duos or Trios. Soldiers, guns, photo textures and most sounds are CC0 assets; the rest is generated in code.<br><br>Esc during a match opens the menu and settings.</div>`;
    menu.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.onclick = () => start(+b.dataset.m!));
    menu.querySelector<HTMLElement>('[data-a=settings]')!.onclick = () => { const sMenu = new SettingsMenu(settings, input, applySetting, () => sMenu.el.remove()); ui.appendChild(sMenu.el); };
    ui.appendChild(menu);
  };
  const start = (mode = lastMode()) => {
    try { localStorage.setItem('vd-mode', String(mode)); } catch { /* storage blocked */ }
    audio.init(); audio.setVolume(settings.volume, settings.sfx, settings.ui); audio.voiceOn = settings.announcer;
    menu.remove();
    match = new Match(sm, world, input, tac, ui, settings, (Date.now() & 0xffff) + 1, mode);
    match.onSettingChange = applySetting;
    match.onEnd = (won, place, me) => {
      document.exitPointerLock?.();
      input.inGame = false; input.unlockKeyboard();
      const e = document.createElement('div'); e.className = 'endscr';
      e.innerHTML = `<div class="big ${won ? 'win' : ''}">${won ? 'WARZONE VICTORY' : `#${place}`}</div><div class="stats"><div><b>${me.kills}</b>Kills</div><div><b>${Math.round(me.damage)}</b>Damage</div><div><b>${Math.floor(match!.sim.time / 60)}:${String(Math.floor(match!.sim.time % 60)).padStart(2, '0')}</b>Time</div></div><button data-a="again">Play again</button><button data-a="menu">Main menu</button>`;
      e.querySelector('[data-a=again]')!.addEventListener('click', () => { e.remove(); match!.dispose(); match = null; try { sessionStorage.setItem('vd-autostart', '1'); } catch { /* */ } location.reload(); });
      e.querySelector('[data-a=menu]')!.addEventListener('click', () => { e.remove(); match!.dispose(); match = null; showMenu(); });
      ui.appendChild(e);
    };
    input.inGame = true;
    if (settings.fullscreen) input.lockKeyboard();
    input.lock();
  };
  // clicking back into the game re-enters fullscreen with the keyboard locked (e.g. after holding Esc)
  canvas.addEventListener('mousedown', () => { if (match && settings.fullscreen && !document.fullscreenElement) input.lockKeyboard(); });
  showMenu();
  // "Play again" reloads the page for a clean slate and jumps straight back into the same mode
  try { if (sessionStorage.getItem('vd-autostart')) { sessionStorage.removeItem('vd-autostart'); addEventListener('click', () => { if (!match) start(); }, { once: true }); } } catch { /* */ }
  (window as any).__vd = { sm, world, cam, start, models, THREE, get match() { return match; } };

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (match) { try { match.frame(dt, now / 1000); } catch (err) { console.error(err); (window as any).__lastErr = String((err as Error).stack); } }
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
