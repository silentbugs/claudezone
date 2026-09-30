/**
 * Warzone (2020) HUD, laid out from measured 2020 screenshots: circular rotating minimap and circle
 * timer (top-left), compass + location (top-centre), squads/players/kills (top-right), killfeed above
 * the squad cards (bottom-left), plates/gas mask next to your card, weapon + equipment (bottom-right),
 * loot card above the crosshair, hitmarkers, prompts, parachute altimeter, tac map and buy menus.
 */
import type { Sim } from '../sim/sim';
import { LOADOUTS } from '../sim/sim';
import { ItemKind, Phase, Player, SimEvent, Item, BackpackDrop } from '../sim/types';
import { WEAPON, RARITY_COLORS, RARITY_NAMES, CLASS_NAMES, AMMO_NAMES, attachmentsFor, blueprintName, WeaponDef, damageAt } from '../data/weapons';
import { LETHAL_NAMES, TACTICAL_NAMES, KILLSTREAK_NAMES, FIELD_UPGRADE_NAMES } from '../sim/loot';
import { CIRCLES } from '../sim/config';
import { POIS, MAP_SIZE } from '../world/mapdata';
import { vehicleOf, VEHICLES } from '../sim/vehicles';
import { ICON, LETHAL_ICON, TACTICAL_ICON, STREAK_ICON, contractBadge, vehicleIcon } from './icons';
import { renderTacRegion } from './mapImage';
import { describeGun, gunSilhouette } from '../render/gunModel';
import { models } from '../render/models';
import { keyName, Settings, Action } from '../core/settings';
import { BUY_ITEMS, BuyId } from '../data/buy';
import './hud.css';

const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const fmtT = (s: number) => { s = Math.max(0, s); if (s < 60) return `0:${(Math.floor(s * 10) / 10).toFixed(1).padStart(4, '0')}`; s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const SQUAD_COLORS = ['#ffffff', '#5fd35f', '#ff9a2e', '#c46bff'];
const LOC_NAMES: Record<string, string> = {
  military_base: 'Arklov Peak Military Base', dam: 'Gora Dam', quarry: 'Karst River Quarry', airport: 'Verdansk International Airport', airport_maintenance: 'Airport Maintenance',
  tv_station: 'Zordaya Broadcast', storage_town: 'Storage Town', superstore: 'Superstore', stadium: 'Verdansk Stadium', lumber: 'Lumber Mill', boneyard: 'Zhokov Boneyard',
  hospital: 'Zordaya Hospital', train_station: 'Verdansk Train Station', downtown: 'Downtown Tavorsk District', promenade_west: 'Promenade West', promenade_east: 'Promenade East',
  hills: 'Novi District Hills', park: 'Tavorsk Park', port: 'Port of Verdansk', farmland: 'Krovnik Farmland', prison: 'Zordaya Prison Complex', jarvdinsk_spomenik: 'Jarvdinsk Spomenik',
  riverside: 'Riverside', bloc_16: 'Bloc 16', lozoff_pass: 'Lozoff Pass', bloc_18: 'Bloc 18', junkyard: 'Junkyard', graveyard: 'Graveyard', torsk_bloc: 'Torsk Bloc', bloc_6: 'Bloc 6',
};

const silCache = new Map<string, string>();
function sil(id: string, rarity: number, fill = '#fff') {
  const k = `${id}:${rarity}:${fill}`; let s = silCache.get(k);
  if (!s) {
    // icon rendered from the actual gun model when there is one; procedural outline otherwise
    const url = models.hasGun(id) ? models.icon(id, rarity) : null;
    s = url ? `<img class="gsil" src="${url}" alt="">` : gunSilhouette(describeGun(WEAPON[id], rarity), fill);
    if (url || !models.hasGun(id)) silCache.set(k, s); // the model icon may still be encoding: use the outline until it is ready
  }
  return s;
}

export class Hud {
  root = el('div', 'hud');
  private mm: HTMLCanvasElement; private mmCtx: CanvasRenderingContext2D;
  private circ = el('div', 'circ');
  private cpings = el('div', 'pings');
  private compass = el('div', 'compass'); private strip = el('div', 'strip'); private heading = el('div', 'heading'); private loc = el('div', 'loc');
  private counters = el('div', 'counters');
  private feed = el('div', 'feed');
  private squad = el('div', 'squad');
  private inv = el('div', 'inv');
  private weap = el('div', 'weap');
  private fu = el('div', 'fu');
  private xh = el('div', 'xh');
  private hm = el('div', 'hm');
  private lcard = el('div', 'lcard');
  private hold = el('div', 'hold');
  private prog = el('div', 'prog');
  private ctx = el('div', 'ctx');
  private banner = el('div', 'banner');
  private note = el('div', 'note');
  private dmg = el('div', 'dmg');
  private low = el('div', 'lowhp'); private lowPulse = 0;
  /** 2020 hit feedback: red splatter pulse round the screen edge (blue-white burst when your armor breaks) */
  private hurtEl = el('div', 'hurt'); private hurtK = 0; private breakEl = el('div', 'abreak'); private breakK = 0;
  hurt(dmg: number, armorBroke: boolean) { this.hurtK = Math.min(1, this.hurtK + 0.35 + dmg / 60); if (armorBroke) this.breakK = 1; }
  /** 0..1 low-health overlay strength */
  setLowHealth(k: number) { this.lowPulse = Math.max(0, this.lowPulse - 0.03); const a = Math.min(1, k * (0.75 + 0.25 * this.lowPulse)); this.low.style.opacity = a < 0.01 ? '0' : a.toFixed(3); }
  beat(k: number) { this.lowPulse = 1; void k; }
  private vig = el('div', 'vig');
  private scope = (() => { const d = el('div', 'scope'); d.innerHTML = '<i class="pv"></i><i class="ph"></i><b></b>'; return d; })();
  private flash = el('div', 'flash');
  private dot = el('div', 'reddot');
  private tags = el('div');
  private alt = el('div', 'alt');
  fullmap = el('div', 'fullmap');
  private fmCanvas: HTMLCanvasElement;
  panel: HTMLElement | null = null;
  private hmT = 0; private hmGlyphT = 0; private bannerT = 0; private noteT = 0; private nameT = 0;
  private fmZoom = 1; private fmCx = MAP_SIZE / 2; private fmCz = MAP_SIZE / 2;
  private fmTiles = new Map<number, HTMLCanvasElement>(); private camYawV = 0;
  private fmView() { const span = MAP_SIZE / this.fmZoom; const x0 = Math.max(-span * 0.25, Math.min(MAP_SIZE - span * 0.75, this.fmCx - span / 2)), z0 = Math.max(-span * 0.25, Math.min(MAP_SIZE - span * 0.75, this.fmCz - span / 2)); this.fmCx = x0 + span / 2; this.fmCz = z0 + span / 2; return { x0, z0, span }; }
  /** The squad's active contract objective (2020: made unmissable on the maps, the compass and in the world). */
  /** Active contract card (2020, under the circle timer): name, objective, time left, step / capture progress */
  private contractHud() {
    const sim = this.sim, me = sim.players[this.localId], ac = sim.active.find((a) => a.squad === me.squad);
    let h = '';
    if (ac) {
      const name = { bounty: 'Bounty', scavenger: 'Scavenger', recon: 'Recon', mostwanted: 'Most Wanted', supply: 'Supply Run' }[ac.kind];
      const obj = { bounty: 'Eliminate the target', scavenger: `Open the supply box (${(ac.step ?? 0) + 1}/3)`, recon: ac.flare ? 'Hold the zone' : 'Secure the intel', mostwanted: 'Survive', supply: 'Reach the Buy Station' }[ac.kind];
      const t = Math.max(0, Math.ceil(ac.t)), tt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      const prog = ac.kind === 'recon' ? Math.min(1, (ac.progress ?? 0) / 25) : ac.kind === 'scavenger' ? (ac.step ?? 0) / 3 : -1;
      let img = this.objImg.get(ac.kind); if (!img) { img = contractBadge(ac.kind).toDataURL(); this.objImg.set(ac.kind, img); }
      h = `<img src="${img}"><div><b>${name.toUpperCase()}</b><span class="t${t <= 30 ? ' low' : ''}">${tt}</span><div class="o">${obj}</div>${prog >= 0 ? `<i><u style="width:${(prog * 100).toFixed(0)}%"></u></i>` : ''}</div>`;
    }
    this.set('ctr', this.ctr, h); this.ctr.style.display = h ? 'flex' : 'none';
  }
  /** Gulag (2020): balcony wait with your match countdown / queue place, then a big countdown before the fight */
  private gulagHud() {
    const sim = this.sim, me: any = sim.players[this.localId];
    let st = '', cd = '';
    if (me.phase === Phase.GulagWait) {
      const left = Math.ceil((me.gulagReadyAt ?? 0) - sim.time), q = sim.gulag.queue.indexOf(me.id);
      st = left > 0 ? `GULAG<b>Your match begins in ${left}s</b>` : `GULAG<b>Waiting for an opponent${q > 0 ? ` — ${q} ahead of you` : ''}</b>`;
    } else if (me.phase === Phase.Dead && this.specId >= 0) {
      const q = sim.players[this.specId]; st = `SPECTATING<b>${q.name}${q.squad === me.squad ? '' : q.id === me.killedBy ? ' — your killer' : ''}</b>`;
    } else if (me.phase === Phase.Gulag) {
      const left = (me.frozenUntil ?? 0) - sim.time;
      if (left > 0) cd = String(Math.ceil(left)); else if (left > -0.8) cd = 'FIGHT';
    }
    this.set('gstat', this.gstat, st); this.gstat.style.display = st ? 'block' : 'none';
    this.set('gcount', this.gcount, cd); this.gcount.style.display = cd ? 'block' : 'none';
  }
  private objective(): { x: number; y: number; z: number; kind: string; label: string; area?: number } | null {
    const sim = this.sim, me = sim.players[this.localId], ac = sim.active.find((a) => a.squad === me.squad);
    if (!ac) return null;
    if (ac.kind === 'recon') return { x: ac.zx!, y: ac.zy!, z: ac.zz!, kind: 'recon', label: 'RECON' };
    if (ac.kind === 'scavenger') { const ch = sim.chests.find((q) => q.id === ac.chest); return ch ? { x: ch.x, y: ch.y, z: ch.z, kind: 'scavenger', label: `SUPPLY BOX ${(ac.step ?? 0) + 1}/3` } : null; }
    if (ac.kind === 'supply') return { x: ac.zx!, y: ac.zy!, z: ac.zz!, kind: 'supply', label: 'BUY STATION' };
    if (ac.kind === 'mostwanted') return null;
    const t = sim.players[ac.target!];
    if (!t) return null;
    // bounty: the target's area, refreshed every 10 s like the 2020 marker (a circle, not the exact spot)
    const k = Math.floor(sim.time / 10);
    if (this.bountyK !== k || !this.bountyAt) { this.bountyK = k; const a = (k * 2.4) % 6.28; this.bountyAt = [t.x + Math.cos(a) * 45, t.y, t.z + Math.sin(a) * 45]; }
    return { x: this.bountyAt[0], y: this.bountyAt[1], z: this.bountyAt[2], kind: 'bounty', label: 'BOUNTY', area: 110 };
  }
  private bountyK = -1; private bountyAt: [number, number, number] | null = null;
  private objImg = new Map<string, string>();
  private eqhm = el('div', 'eqhm'); private eqT = 0; private eqKind = '';
  private specId = -1;
  private gstat = el('div', 'gstat'); private gcount = el('div', 'gcount');
  private ctr = el('div', 'ctr');
  private uavSnapT = -99; private uavDots: [number, number][] = [];
  private dmgArcs: { a: number; t: number; e: HTMLElement }[] = [];
  private last: Record<string, string> = {};
  private cardKey = ''; private cardSince = 0;
  pings: { x: number; z: number; t: number }[] = [];
  private lastWeaponKey = '';

  constructor(private sim: Sim, private tac: HTMLCanvasElement, private localId: number, private settings: Settings) {
    const mmw = el('div', 'mm'); this.mm = document.createElement('canvas'); this.mm.width = this.mm.height = 320; mmw.appendChild(this.mm);
    this.mmCtx = this.mm.getContext('2d')!;
    this.compass.append(this.strip);
    this.xh.innerHTML = '<i></i><i></i><i></i><i></i><i class="dot"></i>';
    this.hm.innerHTML = [45, 135, 225, 315].map((d) => `<i style="transform:rotate(${d}deg)"></i>`).join('') + `<div class="glyph a">${ICON.shield}</div><div class="glyph b">${ICON.shieldBroken}</div>`;
    this.alt.innerHTML = '<div class="rule"></div><div class="lab s">SPEED</div><div class="lab g">GROUND</div><div class="mk"><b>0</b><i></i><u></u></div>';
    this.fmCanvas = document.createElement('canvas'); this.fmCanvas.width = this.fmCanvas.height = 1200;
    this.fullmap.append(this.fmCanvas, el('div', 'legend', '<b style="color:#fff;font-size:18px">TAC MAP</b><br>White ring: next safe zone<br>Red: gas<br>Coloured arrows: your squad<br>Dashed line: C-130 route<br>Red dots: enemies (UAV / gunfire)<br>Orange carts: buy stations<br><br>Click to place a marker — your squad will head there'));
    // tac map: wheel zooms toward the cursor (x1..x8, more detail as you zoom), drag pans, click places / removes your marker
    const toWorld = (e: MouseEvent): [number, number] => { const r = this.fmCanvas.getBoundingClientRect(), v = this.fmView(); return [v.x0 + ((e.clientX - r.left) / r.width) * v.span, v.z0 + ((e.clientY - r.top) / r.height) * v.span]; };
    this.fmCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wz] = toWorld(e), z0 = this.fmZoom;
      this.fmZoom = Math.max(1, Math.min(8, this.fmZoom * (e.deltaY < 0 ? 1.3 : 1 / 1.3)));
      const k = z0 / this.fmZoom; this.fmCx = wx + (this.fmCx - wx) * k; this.fmCz = wz + (this.fmCz - wz) * k;
    }, { passive: false });
    let drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
    this.fmCanvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.fmCx, cz: this.fmCz, moved: false }; });
    addEventListener('mousemove', (e) => {
      if (!drag) return; const r = this.fmCanvas.getBoundingClientRect(), v = this.fmView(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { this.fmCx = drag.cx - (dx / r.width) * v.span; this.fmCz = drag.cz - (dy / r.height) * v.span; }
    });
    addEventListener('mouseup', (e) => {
      if (!drag) return; const d = drag; drag = null; if (d.moved || e.target !== this.fmCanvas) return;
      const [x, z] = toWorld(e), me: any = this.sim.players[this.localId], v = this.fmView();
      if (me.ping && Math.hypot(me.ping.x - x, me.ping.z - z) < 14 * v.span / this.fmCanvas.width * 2) { this.pings = []; me.ping = undefined; return; }
      this.pings = [{ x, z, t: 999 }]; me.ping = { x, z };
    });
    this.root.append(this.ctr, this.eqhm, this.gstat, this.gcount, this.low, this.hurtEl, this.breakEl, this.vig, this.scope, mmw, this.circ, this.compass, this.cpings, this.heading, this.loc, this.counters, this.feed, this.squad, this.inv, this.fu, this.weap, this.xh, this.hm, this.tags, this.lcard, this.hold, this.prog, this.ctx, this.alt, this.banner, this.note, this.dmg, this.flash, this.dot, this.fullmap);
    this.buildCompass();
  }

  private k(a: Action) { const [k1, k2] = this.settings.binds[a]; return `<span class="key">${keyName(k1 || k2).replace('Left Mouse', 'LMB').replace('Right Mouse', 'RMB').replace('Middle Mouse', 'MMB')}</span>`; }

  private buildCompass() {
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let h = '';
    for (let d = -360; d <= 720; d += 15) {
      const x = d * 4, dd = ((d % 360) + 360) % 360;
      h += `<i style="left:${x}px"></i><span class="${labels[dd] ? 'card' : ''}" style="left:${x}px">${labels[dd] ?? dd}</span>`;
    }
    this.strip.innerHTML = h;
  }

  private set(key: string, e: HTMLElement, html: string) { if (this.last[key] !== html) { this.last[key] = html; e.innerHTML = html; } }

  onEvent(e: SimEvent) {
    const me = this.sim.players[this.localId];
    const color = (id: number) => { const p = this.sim.players[id]; if (!p) return '#fff'; if (p.squad !== me.squad) return '#ff5a4a'; return SQUAD_COLORS[p.id % 3 === me.id % 3 ? 0 : (p.id % 3) + 1]; };
    const name = (id: number) => { const p = this.sim.players[id]; return p ? `<span style="color:${color(id)}">${p.name}</span>` : '?'; };
    switch (e.t) {
      case 'eqhit':
        if (e.attacker === this.localId && (e.kind !== this.eqKind || this.eqT < 0.5)) {
          this.eqKind = e.kind; this.eqT = 1;
          this.eqhm.innerHTML = ICON[LETHAL_ICON[e.kind] ?? TACTICAL_ICON[e.kind] ?? e.kind] ?? '';
          this.hmT = Math.max(this.hmT, 0.26); this.hm.className = 'hm';
        }
        break;
      case 'hit':
        if (e.attacker === this.localId) {
          this.hmT = 0.26;
          this.hm.className = 'hm' + (e.kill || e.down ? ' kill' : '') + (e.armorBroke ? ' break' : e.armorHit ? ' armor' : '');
          if (e.armorBroke) this.hmGlyphT = 0.55;
        }
        if (e.victim === this.localId && e.attacker >= 0) {
          const a = this.sim.players[e.attacker];
          const i = el('i'); this.dmg.appendChild(i); this.dmgArcs.push({ a: Math.atan2(a.x - me.x, a.z - me.z), t: 2.2, e: i });
          this.hurt(e.dmg, e.armorBroke);
        }
        break;
      case 'kill': case 'down': {
        const w = WEAPON[e.w];
        const mid = w ? `<span class="gun">${sil(e.w, 0, '#fff')}</span>` : `<span style="opacity:.75">[${e.w === 'gas' ? 'Gas' : e.w === 'fall' ? 'Fall' : e.w === 'bleed' ? 'Bled out' : e.w === 'melee' ? 'Melee' : e.w}]</span>`;
        this.feedLine(e.attacker >= 0 && e.attacker !== e.victim ? `${name(e.attacker)} ${mid} ${e.t === 'down' ? '<span style="opacity:.7">▼</span>' : ''}${name(e.victim)}` : `${mid} ${name(e.victim)}`);
        if (e.attacker === this.localId && e.victim !== this.localId) this.showNote(e.t === 'down' ? 'Enemy downed' : 'Enemy eliminated');
        if (e.victim === this.localId) { const by = e.attacker >= 0 && e.attacker !== this.localId ? this.sim.players[e.attacker].name : (e.w === 'gas' ? 'the gas' : e.w); this.showBanner(e.t === 'down' ? "You're down" : 'Eliminated', e.t === 'down' ? `Downed by ${by}` : `Killed by ${by}`); }
        break;
      }
      case 'circle': this.showBanner(e.closing ? 'Gas closing' : 'Safe zone updated', e.closing ? 'Move to the safe zone' : `Circle ${e.phase + 1}`); break;
      case 'gulag':
        if (e.p === this.localId) {
          const m: Record<string, [string, string]> = { enter: ['Welcome to the Gulag', 'Win your 1v1 to get back into Verdansk'], fight: ['Gulag match', 'Get ready — the winner redeploys'], overtime: ['Overtime', 'Capture the flag in the centre'], win: ['Gulag won', 'Redeploying...'], lose: ['Eliminated', 'Your squad can buy you back'], closed: ['', ''] };
          this.showBanner(...m[e.msg]);
        } else if (e.msg === 'closed') this.showNote('The Gulag is closed');
        break;
      case 'redeploy': if (this.sim.players[e.p].squad === me.squad) this.feedLine(`${name(e.p)} <span style="opacity:.7">redeployed</span>`); break;
      case 'announce': if ((e.squad === undefined || e.squad === -1 || e.squad === me.squad) && !e.text.startsWith('__')) this.showNote(e.text); break;
      case 'contract': if (this.sim.players[e.p].squad === me.squad) this.showBanner(`${({ bounty: 'Bounty', scavenger: 'Scavenger', recon: 'Recon', mostwanted: 'Most Wanted', supply: 'Supply Run' } as Record<string, string>)[e.kind] ?? e.kind} contract`, e.msg === 'start' ? 'Contract accepted' : e.msg === 'done' ? 'Contract complete' : e.msg === 'fail' ? 'Contract failed' : 'Next target marked'); break;
      case 'uav': this.showNote(e.squad === me.squad ? 'UAV online' : 'Enemy UAV overhead'); break;
      case 'cuav': this.showNote(e.squad === me.squad ? 'Counter UAV online' : 'Enemy Counter UAV deployed'); break;
      case 'pickup': if (e.p === this.localId) this.showNote(e.label); break;
      case 'squadwipe': if (e.squad !== me.squad) this.feedLine(`<span style="color:#ff5a4a">Squad eliminated</span>`); break;
      case 'flash': if (e.p === this.localId) this.flash.style.opacity = String(Math.min(1, 0.6 + e.s)); break;
    }
  }
  feedLine(html: string) { const d = el('div', 'ln', html); this.feed.prepend(d); while (this.feed.children.length > 6) this.feed.lastChild!.remove(); setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 5500); }
  showBanner(a: string, b: string) { if (!a) return; this.banner.innerHTML = `<div class="b1">${a}</div><div class="b2">${b}</div>`; this.bannerT = 3.5; }
  showNote(t: string) { this.note.textContent = t; this.noteT = 2.2; }

  // ---------------------------------------------------------------- per frame
  update(dt: number, camYaw: number, _camPitch: number, project: (x: number, y: number, z: number) => [number, number, boolean], opts: { ads: number; scope: boolean; optic?: boolean; spectating: Player | null; mapOpen: boolean }) {
    this.camYawV = camYaw; this.specId = opts.spectating?.id ?? -1;
    this.eqT = Math.max(0, this.eqT - dt / 0.9); this.eqhm.style.opacity = this.eqT > 0 ? String(Math.min(1, this.eqT * 2)) : '0'; this.eqhm.style.transform = `translate(-50%, -50%) scale(${1 + (1 - this.eqT) * 0.15 + (this.eqT > 0.85 ? (this.eqT - 0.85) * 2 : 0)})`;
    this.gulagHud(); this.contractHud();
    const sim = this.sim, me = sim.players[this.localId], view = opts.spectating ?? me;
    const c = sim.circle;
    const inGas = sim.inGas(view);
    const air = view.phase === Phase.Freefall || view.phase === Phase.Chute || view.phase === Phase.Plane;
    // --- interface settings (live)
    const S = this.settings, mmEl = this.root.querySelector('.mm') as HTMLElement;
    mmEl.style.borderRadius = S.minimapShape === 'square' ? '4px' : '50%';
    this.compass.style.display = this.heading.style.display = this.loc.style.display = S.showCompass ? '' : 'none';
    this.feed.style.display = S.showKillfeed ? '' : 'none';
    this.hm.style.visibility = S.showHitmarkers ? '' : 'hidden';
    // --- circle timer
    if (sim.inWarmup) this.set('circ', this.circ, `<span style="color:#f6c343">WARM-UP</span> ${fmtT(sim.warmup - sim.time)}`);
    else if (c.done) this.set('circ', this.circ, `<span class="badge">${CIRCLES.length}</span> <span class="sub">FINAL CIRCLE</span>`);
    else this.set('circ', this.circ, `<span class="badge">${c.phase + 1}</span>${fmtT(c.t)}${c.closing ? `<span class="closing">${ICON.gasHex}CLOSING</span>` : ''}${inGas && view.hasMask ? `<span class="sub">MASK ${Math.ceil(view.gasMask)}s</span>` : ''}`);
    // --- compass + location
    const deg = ((-camYaw * 180) / Math.PI % 360 + 360) % 360;
    const cw = this.compass.clientWidth || innerWidth * 0.36;
    this.strip.style.left = `${cw / 2 - deg * 4}px`;
    // compass markers: your location ping (yellow) and squad enemy pings (red), 4 px per degree like the strip
    let cm = '';
    const mark = (x: number, z: number, cls: string) => { let b = ((Math.atan2(x - view.x, -(z - view.z)) * 180) / Math.PI + 360) % 360 - deg; b = ((b + 540) % 360) - 180; if (Math.abs(b) < 75) cm += `<i class="${cls}" style="left:${(cw / 2 + b * 4).toFixed(0)}px"></i>`; };
    for (const pg of this.pings) mark(pg.x, pg.z, '');
    { const ob = this.objective(); if (ob) mark(ob.x, ob.z, 'obj'); }
    for (const e of sim.enemyPings) if (e.squad === me.squad && e.until > sim.time) mark(e.x, e.z, 'enemy');
    for (const q of sim.players) if (q.alive && q.squad !== me.squad && sim.time - ((q as any).lastLoudShot ?? -99) < 3 && Math.hypot(q.x - view.x, q.z - view.z) < 250) mark(q.x, q.z, 'shot');
    this.set('cmark', this.cpings, cm);
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const near8 = Math.round(deg / 45) * 45 % 360;
    this.set('head', this.heading, `<b></b>${Math.abs(deg - Math.round(deg / 45) * 45) < 8 ? labels[near8] : Math.round(deg)}<b></b>`);
    let best = '', bd = Infinity;
    for (const p of POIS) { const d = Math.hypot(p.x - view.x, p.z - view.z) / Math.max(80, p.r); if (d < bd && d < 1.25) { bd = d; best = LOC_NAMES[p.id] ?? p.name; } }
    this.set('loc', this.loc, air ? '' : best);
    // --- counters
    this.set('cnt', this.counters, `<div>${ICON.squads}${sim.squadsLeft()}</div><div>${ICON.player}${sim.aliveCount}</div><div>${ICON.skull}${me.kills}</div>`);
    // --- squad cards (teammates above, you at the bottom)
    let sq = '';
    const mates = sim.players.filter((p) => p.squad === me.squad && p.id !== me.id);
    const card = (p: Player, mine: boolean, col: string) => {
      const st = p.phase === Phase.Downed ? 'down' : !p.alive ? 'dead' : '';
      const ar = [0, 1, 2].map((i) => `<i><b style="transform:scaleX(${Math.max(0, Math.min(1, (p.armor - i * 50) / 50))})"></b></i>`).join('');
      const hp = p.phase === Phase.Downed ? (p.downT / 30) * 100 : Math.max(0, p.health);
      const badge = !p.alive && p.phase !== Phase.Downed ? `<div class="badge">${ICON.skull}</div>` : '';
      return `<div class="card ${st} ${mine ? 'mine' : ''}"><div class="nm">${mine ? '<span class="star">★</span>' : ''}<span style="color:${mine ? '#ffb65f' : col}">${p.name}</span>${p.phase === Phase.GulagWait || p.phase === Phase.Gulag ? ' <span style="opacity:.7">(Gulag)</span>' : ''}</div><div class="ar">${ar}</div><div class="hp"><i style="width:${hp}%"></i></div><div class="cash"><span>$${p.cash.toLocaleString()}</span>${p.selfRevive ? ICON.selfRevive : ''}</div>${badge}</div>`;
    };
    mates.forEach((p, i) => { sq += card(p, false, SQUAD_COLORS[i + 1]); });
    sq += card(view, true, '#fff');
    this.set('squad', this.squad, sq);
    // --- plates / gas mask next to your card
    const full = view.plates >= view.maxPlates;
    let inv = `<div class="it"><div class="row">${view.maxPlates > 5 ? ICON.satchel : ICON.plate}<span class="${full ? 'full' : ''}">${view.plates}</span></div>${this.k('plate')}</div>`;
    if (view.hasMask) { const seg = Math.ceil((view.gasMask / 12) * 6); inv += `<div class="it"><div class="row">${ICON.gasMask}<div class="dura">${Array.from({ length: 6 }, (_, i) => `<i class="${i < seg ? 'on' : ''}"></i>`).join('')}</div></div></div>`; }
    this.set('inv', this.inv, air ? '' : inv);
    // --- weapon block
    const w = view.weapons[view.cur];
    if (w && !air && view.phase !== Phase.Downed) {
      const d = WEAPON[w.id], rc = RARITY_COLORS[w.rarity] ?? '#fff';
      const low = w.mag <= Math.ceil(d.mag * 0.25) && d.cls !== 'melee';
      const wkey = `${w.id}:${w.rarity}`; if (wkey !== this.lastWeaponKey) { this.lastWeaponKey = wkey; this.nameT = 2.5; }
      this.nameT -= dt;
      const lt = view.lethal, tt = view.tactical;
      this.set('weap', this.weap, `<div class="gunbox"><div class="gname" style="opacity:${this.nameT > 0 ? 1 : 0};color:${rc}">${blueprintName(w.id, w.rarity) ? `"${blueprintName(w.id, w.rarity)}" ` : ''}${d.name}</div><div class="smear" style="background:${rc}"></div>${sil(w.id, w.rarity)}</div>` +
        (d.cls === 'melee' ? '' : `<div class="ammo ${low ? 'low' : ''}"><div class="mag">${w.id === 'turretgun' ? '∞' : w.mag}</div><div class="res">${w.id === 'turretgun' ? '' : view.ammo[d.ammo]}</div></div>`) +
        `<div class="eq"><div class="slot ${tt ? '' : 'empty'}"><div class="row">${ICON[TACTICAL_ICON[tt?.type ?? 'stun']]}${tt ? tt.n : ''}</div>${this.k('tactical')}</div><div class="slot ${lt ? '' : 'empty'}"><div class="row">${ICON[LETHAL_ICON[lt?.type ?? 'frag']]}${lt ? lt.n : ''}</div>${this.k('lethal')}</div></div>`);
      this.set('fu', this.fu, `${view.killstreak ? `<div class="ring" title="${KILLSTREAK_NAMES[view.killstreak]}">${ICON[STREAK_ICON[view.killstreak]]}${this.k('killstreak')}</div>` : ''}<div class="ring" style="opacity:${view.fieldUpgrade ? 1 : 0.5}">${view.fieldUpgrade ? ICON[view.fieldUpgrade] : ''}${this.k('fieldUpgrade')}</div>`);
    } else { this.set('weap', this.weap, ''); this.set('fu', this.fu, ''); }
    // --- crosshair
    const showXh = this.settings.showCrosshair && opts.ads < 0.5 && (view.phase === Phase.Alive || view.phase === Phase.Gulag) && !(vehicleOf(sim, view) && (view as any).seat === 0) && !air;
    this.xh.style.display = showXh ? '' : 'none';
    if (showXh && w) {
      const d = WEAPON[w.id];
      const s = Math.min(90, (d.spreadHip * (1 - opts.ads) * 700 + 7 + Math.hypot(view.vx, view.vz) * 2 + view.bloom * 5));
      const xs = this.xh.children as HTMLCollectionOf<HTMLElement>;
      const pos = (e: HTMLElement, l: number, t: number, wd: number, h: number) => { e.style.left = `${l}px`; e.style.top = `${t}px`; e.style.width = `${wd}px`; e.style.height = `${h}px`; };
      pos(xs[0], -s - 8, -1, 8, 2); pos(xs[1], s, -1, 8, 2); pos(xs[2], -1, -s - 8, 2, 8); pos(xs[3], -1, s, 2, 8);
    }
    // --- hitmarker
    this.hmT -= dt; this.hmGlyphT -= dt;
    const hk = this.hmT > 0 ? Math.min(1, this.hmT / 0.1) : 0;
    this.hm.style.opacity = String(hk);
    this.hm.style.transform = `scale(${1 + Math.max(0, this.hmT - 0.18) * 1.8})`;
    if (this.hmGlyphT > 0) { this.hm.classList.add('break'); this.hm.style.opacity = '1'; }
    // --- scope / red dot
    this.scope.style.display = opts.scope && opts.ads > 0.92 ? 'block' : 'none';
    // the optic's own reticle (or the scope overlay) is the aim point; no second HUD dot on top of it
    this.dot.style.display = 'none';
    // --- vignettes
    let vig = '';
    if (view.phase === Phase.Downed) vig = 'radial-gradient(circle, transparent 30%, rgba(120,0,0,0.6))';
    else if (inGas) vig = 'radial-gradient(circle, rgba(170,150,30,0.22) 20%, rgba(150,140,20,0.55))';
    if (this.last.vig !== vig) { this.last.vig = vig; this.vig.style.background = vig; }
    const fo = parseFloat(this.flash.style.opacity || '0'); if (fo > 0) this.flash.style.opacity = String(Math.max(0, fo - dt * (view.flashT > 0 ? 0.25 : 1.5)));
    this.hurtK = Math.max(0, this.hurtK - dt * 1.6); this.breakK = Math.max(0, this.breakK - dt * 2.2);
    this.hurtEl.style.opacity = this.hurtK < 0.01 ? '0' : Math.min(1, this.hurtK).toFixed(3); this.breakEl.style.opacity = this.breakK < 0.01 ? '0' : this.breakK.toFixed(3);
    for (const a of this.dmgArcs) { a.t -= dt; a.e.style.opacity = String(Math.min(1, a.t)); a.e.style.transform = `rotate(${((Math.PI - a.a + camYaw) * 180) / Math.PI}deg)`; if (a.t <= 0) a.e.remove(); }
    this.dmgArcs = this.dmgArcs.filter((a) => a.t > 0);
    // --- interaction card / prompts
    this.updateCard(me);
    let hold = '', progTxt = '', progV = -1, ctx = '';
    if (me.phase === Phase.Downed) {
      hold = me.selfRevive ? `Hold ${this.k('interact')} to Self-Revive` : `Bleeding out — ${Math.ceil(me.downT)}s`;
      if (me.reviveBy >= 0) { progV = me.reviveT / 5; progTxt = me.reviveBy === me.id ? 'Using Self-Revive' : `Being revived`; }
    }
    if (me.phase === Phase.Alive) {
      const rv = sim.players.find((q) => q.reviveBy === me.id && q.id !== me.id);
      if (rv) { progV = rv.reviveT / 5; progTxt = `Reviving ${rv.name}`; }
      if (me.plateT > 0) { progV = 1 - me.plateT / 1.25; progTxt = ''; }
      const veh = vehicleOf(sim, me);
      if (veh) ctx = `<span>${VEHICLES[veh.type].name} ${Math.round(veh.speed * 3.6)} km/h</span><span>${this.k('interact')} Exit</span>${veh.type === 'heli' ? `<span>${this.k('jump')} Up</span><span>${this.k('crouch')} Down</span>` : `<span>${this.k('jump')} Brake</span>`}`;
      if (me.turret >= 0) ctx = `<span>${this.k('interact')} Leave turret</span>`;
    }
    if (me.phase === Phase.Plane) ctx = sim.plane.canJump ? `<span>${this.k('jump')} Jump</span>` : '<span>Waiting for the jump light...</span>';
    if (me.phase === Phase.Freefall) ctx = `<span>${this.k('jump')} Deploy parachute</span><span>${this.k('thirdPerson')} Hold to look around</span>`;
    if (me.phase === Phase.Chute) ctx = `<span>${this.k('jump')} Cut parachute</span><span>${this.k('thirdPerson')} Hold to look around</span>`;
    if (me.phase === Phase.GulagWait) ctx = `<span>${this.k('tactical')} Throw rock</span><span>Waiting for your Gulag match</span>`;
    if (sim.inWarmup && me.phase === Phase.Dead) ctx = '<span>Respawning...</span>';
    this.set('hold', this.hold, hold); this.hold.style.display = hold ? 'flex' : 'none';
    this.set('ctx', this.ctx, ctx);
    this.prog.style.display = progV >= 0 ? 'block' : 'none';
    if (progV >= 0) this.set('prog', this.prog, `${progTxt}<div class="bar"><i style="width:${Math.min(100, progV * 100)}%"></i></div>`);
    // --- parachute altimeter
    const agl = air && view.phase !== Phase.Plane ? view.y - sim.world.hf.at(view.x, view.z) : -1;
    this.alt.style.display = agl >= 0 ? 'block' : 'none';
    if (agl >= 0) { const mk = this.alt.querySelector('.mk') as HTMLElement; mk.style.top = `${Math.max(0, Math.min(100, 100 - (agl / 700) * 100))}%`; (mk.firstChild as HTMLElement).textContent = (Math.hypot(view.vx, view.vy, view.vz) / 10).toFixed(1); }
    // --- banners
    this.bannerT -= dt; this.banner.style.opacity = String(Math.max(0, Math.min(1, this.bannerT)));
    this.noteT -= dt; this.note.style.opacity = String(Math.max(0, Math.min(1, this.noteT * 2)));
    // --- world tags: squadmates (name, dot, distance), pings, objectives
    let tg = '';
    const tag = (x: number, y: number, z: number, cls: string, inner: string) => { const [sx, sy, vis] = project(x, y, z); if (vis) tg += `<div class="tag ${cls}" style="left:${sx}px;top:${sy}px">${inner}</div>`; };
    mates.forEach((p, i) => { if (p.alive && p.phase !== Phase.GulagWait && p.phase !== Phase.Gulag && p.phase !== Phase.Plane && view.phase !== Phase.Plane) tag(p.x, p.y + 2.1, p.z, '', `<span style="color:${SQUAD_COLORS[i + 1]}">${p.name}${p.phase === Phase.Downed ? ' (DOWN)' : ''}</span><span class="dotc" style="background:${SQUAD_COLORS[i + 1]}"></span><div class="d">${Math.round(Math.hypot(p.x - view.x, p.z - view.z))}m</div>`); });
    for (const pg of this.pings) tag(pg.x, sim.world.hf.at(pg.x, pg.z) + 2, pg.z, 'ping', `<i></i><div class="d">${Math.round(Math.hypot(pg.x - view.x, pg.z - view.z))}m</div>`);
    for (const e of sim.enemyPings) if (e.squad === me.squad && e.until > sim.time) tag(e.x, e.y + 2.2, e.z, 'ping enemy', `<i></i><div class="d">${Math.round(Math.hypot(e.x - view.x, e.z - view.z))}m</div>`);
    const ac = sim.active.find((a) => a.squad === me.squad);
    const ob = this.objective();
    if (ob) {
      let img = this.objImg.get(ob.kind); if (!img) { img = contractBadge(ob.kind).toDataURL(); this.objImg.set(ob.kind, img); }
      const inner = `<img src="${img}"><b>${ob.label}</b><div class="d">${Math.round(Math.hypot(ob.x - view.x, ob.z - view.z))}m</div>`;
      const [sx, sy, vis] = project(ob.x, ob.y + 2.2, ob.z);
      const Wd = innerWidth, Hd = innerHeight;
      if (vis && sx > 40 && sx < Wd - 40 && sy > 60 && sy < Hd - 60) tg += `<div class="tag obj" style="left:${sx}px;top:${sy}px">${inner}</div>`;
      else {
        // off-screen: slide along the screen edge toward it
        let b = Math.atan2(ob.x - view.x, -(ob.z - view.z)) - ((-camYaw) % (2 * Math.PI)); b = Math.atan2(Math.sin(b), Math.cos(b));
        const ex = Wd / 2 + Math.sin(b) * (Wd / 2 - 70), ey = Math.abs(b) > Math.PI / 2 ? Hd - 90 : Hd / 2 - Math.cos(b) * (Hd / 2 - 110);
        tg += `<div class="tag obj edge" style="left:${ex}px;top:${ey}px">${inner}</div>`;
      }
    }
    for (const cr of sim.crates) if (cr.squad === me.squad) tag(cr.x, cr.y + 2, cr.z, 'mk', `LOADOUT<div class="d">${Math.round(Math.hypot(cr.x - view.x, cr.z - view.z))}m</div>`);
    this.set('tags', this.tags, tg);
    this.drawMinimap(view, camYaw);
    this.jam(this.sim.jamLevel(view));
    if (opts.mapOpen) this.drawFullMap(view);
    this.fullmap.style.display = opts.mapOpen ? 'flex' : 'none';
    (this.root.querySelector('.mm') as HTMLElement).style.display = view.phase === Phase.Gulag || view.phase === Phase.GulagWait ? 'none' : '';
  }

  /** The look-at card (Take / Swap / Open / Revive ...) with details and weapon stats. */
  private updateCard(me: Player) {
    const t = me.phase === Phase.Alive ? this.sim.interactTarget(me) : null;
    if (!t) { this.lcard.style.display = 'none'; this.last.card = ''; this.cardKey = ''; return; }
    let verb = 'Use', icon = '', t1 = t.label, t2 = '', extra = '', rc = '#9aa0a6', side = '', t0 = '', legendary = false;
    const key = `${t.kind}:${t.id}`;
    if (key !== this.cardKey) { this.cardKey = key; this.cardSince = performance.now(); }
    const lingering = performance.now() - this.cardSince > 1200;
    const it: Item | undefined = t.kind === 'item' ? this.sim.itemById.get(t.id) : undefined;
    if (it) {
      verb = 'Take';
      switch (it.kind) {
        case ItemKind.Weapon: {
          const d = WEAPON[it.weapon!], r = it.rarity ?? 0; rc = RARITY_COLORS[r];
          verb = me.weapons.every((x) => x) ? 'Swap' : 'Take';
          const bp = blueprintName(d.id, r);
          // 2020 layout: blueprint name (rarity colour), weapon name, class; rarity + dots on the right
          if (bp) t0 = `${ICON.blueprint}${bp}`;
          t1 = d.name; t2 = CLASS_NAMES[d.cls];
          const dots = r >= 5 ? 0 : r + 1; legendary = r === 4;
          side = `<div class="rar"><i class="dia"></i><div><b>${r >= 5 ? 'Player' : RARITY_NAMES[r]}</b><div class="dots">${Array.from({ length: 5 }, (_, i) => `<u class="${i < dots ? 'on' : ''}"></u>`).join('')}</div></div></div>`;
          // linger on a weapon to inspect it: attachments and stat comparison
          if (lingering) {
            const att = attachmentsFor(d.id, r, it.id);
            if (att.length) extra += `<div class="att">${att.join(' · ')}</div>`;
            extra += this.statBars(d, r, me.weapons[me.cur] ? WEAPON[me.weapons[me.cur]!.id] : null);
          }
          break;
        }
        case ItemKind.Ammo: icon = ICON.ammo; t1 = `${AMMO_NAMES[it.ammo!]} x${it.n}`; t2 = 'Ammunition'; break;
        case ItemKind.Plate: icon = ICON.plate; t1 = 'Armor Plate'; t2 = 'Combat Defense'; rc = '#4aa3ff'; break;
        case ItemKind.Cash: icon = ICON.cash; t1 = `$${it.n}`; t2 = 'Cash'; rc = '#c07a2a'; break;
        case ItemKind.Lethal: icon = ICON[LETHAL_ICON[it.lethal!]]; t1 = LETHAL_NAMES[it.lethal!]; t2 = 'Lethal'; break;
        case ItemKind.Tactical: icon = ICON[TACTICAL_ICON[it.tactical!]]; t1 = TACTICAL_NAMES[it.tactical!]; t2 = 'Tactical'; break;
        case ItemKind.Killstreak: icon = ICON[STREAK_ICON[it.killstreak!]]; t1 = KILLSTREAK_NAMES[it.killstreak!]; t2 = 'Killstreak'; rc = '#b45cff'; break;
        case ItemKind.SelfRevive: icon = ICON.selfRevive; t1 = 'Self-Revive Kit'; t2 = 'Combat Defense'; rc = '#b45cff'; break;
        case ItemKind.GasMask: icon = ICON.gasMask; t1 = 'Gas Mask'; t2 = 'Combat Defense'; rc = '#4aa3ff'; break;
        case ItemKind.Satchel: icon = ICON.satchel; t1 = 'Armor Satchel'; t2 = 'Combat Defense'; rc = '#ffb52e'; break;
      }
    } else if (t.kind === 'chest') { const ch = this.sim.chests.find((q) => q.id === t.id); verb = 'Open'; icon = ICON.supply; t1 = ch?.legendary ? 'Legendary Supply Box' : 'Supply Box'; t2 = 'Loot'; rc = ch?.legendary ? '#ffb52e' : '#9aa0a6'; }
    else if (t.kind === 'buy') { verb = 'Use'; icon = ICON.cart; t1 = 'Buy Station'; t2 = 'Loadouts, killstreaks, buybacks'; rc = '#f39a2a'; }
    else if (t.kind === 'contract') { const k = this.sim.contracts.find((q) => q.id === t.id)?.kind; verb = 'Accept'; icon = k === 'bounty' ? ICON.contractBounty : k === 'recon' ? ICON.contractRecon : ICON.contractScav; t1 = `${k ? k[0].toUpperCase() + k.slice(1) : ''} Contract`; t2 = k === 'bounty' ? 'Hunt a marked enemy' : k === 'recon' ? 'Secure a location, see the next circle' : 'Find three supply boxes'; rc = '#f6c343'; }
    else if (t.kind === 'revive') { verb = 'Hold to revive'; icon = ICON.selfRevive; t1 = t.label.replace('Revive ', ''); t2 = 'Downed teammate'; rc = '#5fd35f'; }
    else if (t.kind === 'vehicle' || t.kind === 'exit') { verb = t.kind === 'exit' ? 'Exit' : 'Enter'; const v = this.sim.vehicles.find((q) => q.id === t.id); icon = v?.type === 'heli' ? ICON.heli : ICON.vehicle; t1 = v ? VEHICLES[v.type].name : 'Vehicle'; t2 = v ? `${Math.round((v.health / VEHICLES[v.type].health) * 100)}% health · ${v.seats.filter((q) => q < 0).length} seats free` : ''; }
    else if (t.kind === 'crate') { verb = 'Open'; icon = ICON.loadout; t1 = 'Loadout Drop'; t2 = 'Choose a custom class'; rc = '#ff6fb5'; }
    else if (t.kind === 'balloon') { verb = 'Use'; icon = ICON.balloon; t1 = 'Redeploy Balloon'; t2 = 'Launch into the sky'; }
    else if (t.kind === 'box') { verb = 'Use'; icon = t.label.includes('Armor') ? ICON.armorBox : ICON.munitions; t1 = t.label.replace('Use ', ''); t2 = 'Squad field upgrade'; }
    else if (t.kind === 'turret' || t.kind === 'unman') { verb = t.kind === 'unman' ? 'Leave' : 'Use'; icon = ICON.turret; t1 = 'Shield Turret'; t2 = 'Mounted machine gun'; }
    const html = `<div class="hd"><span>${this.k('interact')} ${verb}</span><span>${this.k('ping')} Ping</span></div><div class="bd">${icon ? `<div class="ic">${icon}</div>` : ''}<div class="tx">${t0 ? `<div class="t0">${t0}</div>` : ''}<div class="t1">${t1}</div><div class="t2">${t2}</div></div>${side}</div>${extra}<div class="glow"></div>`;
    this.lcard.style.setProperty('--rl', rc); this.lcard.style.setProperty('--rc', rc + '55');
    this.set('card', this.lcard, html);
    this.lcard.classList.toggle('leg', legendary);
    this.lcard.style.display = 'block';
  }

  private statBars(d: WeaponDef, r: number, cur: WeaponDef | null) {
    const st = (x: WeaponDef) => ({
      Damage: Math.min(1, (damageAt(x, 10) * (x.pellets ?? 1)) / 140),
      'Fire rate': Math.min(1, x.rpm / 1100),
      Range: Math.min(1, (x.dmg[0][0] > 900 ? 90 : x.dmg[0][0]) / 60),
      Accuracy: Math.max(0.05, 1 - x.recoilV * 60),
      Mobility: Math.min(1, (x.mobility - 0.8) / 0.25),
      Handling: Math.max(0.05, 1 - x.adsTime / 0.5),
    });
    const a = st(d), b = cur ? st(cur) : null;
    void r;
    return `<div class="stats">${Object.entries(a).map(([k, v]) => `<span>${k}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i>${b ? `<u style="left:${Math.round((b as any)[k] * 100)}%"></u>` : ''}</div>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- minimap
  /** Enemy Counter UAV: static over the minimap, a shaking / flickering compass the closer you are. */
  private jam(j: number) {
    const on = j > 0;
    this.compass.style.transform = on ? `translateX(${((Math.random() - 0.5) * 14 * j).toFixed(1)}px)` : '';
    this.compass.style.opacity = on ? String(1 - j * 0.6 * Math.random()) : '';
    this.heading.style.opacity = on && Math.random() < j * 0.5 ? '0.15' : '';
    if (!on) return;
    const g = this.mmCtx, W = this.mm.width;
    g.save();
    g.fillStyle = 'rgba(40,44,46,0.92)'; g.fillRect(0, 0, W, W);
    const n = 900 + j * 900;
    for (let i = 0; i < n; i++) { const v = (Math.random() * 200) | 0; g.fillStyle = `rgba(${v},${v},${v},0.7)`; g.fillRect(Math.random() * W, Math.random() * W, 2 + Math.random() * 3, 1 + Math.random() * 2); }
    for (let y = 0; y < W; y += 4) { g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.2})`; g.fillRect(0, y, W, 1); }
    const by = Math.random() * W; g.fillStyle = 'rgba(200,210,215,0.25)'; g.fillRect(0, by, W, 6 + Math.random() * 14);
    g.restore();
  }

  private drawMinimap(me: Player, yaw: number) {
    const g = this.mmCtx, W = this.mm.width;
    const air = me.phase === Phase.Plane || me.phase === Phase.Freefall || me.phase === Phase.Chute;
    const scale = (air ? 0.2 : 0.75) * (W / 240); // px per metre (≈160 m radius on foot)
    const T = this.tac, k = T.width / MAP_SIZE;
    g.save();
    g.fillStyle = '#23272a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2); g.rotate(yaw); g.scale(scale, scale); g.translate(-me.x, -me.z);
    g.filter = 'saturate(0.6) brightness(0.95)';
    g.drawImage(T, 0, 0, T.width, T.height, 0, 0, T.width / k, T.height / k);
    g.filter = 'none';
    this.drawOverlays(g, me, 1 / scale, true);
    g.restore();
    // own chevron (always up)
    g.fillStyle = '#f6b03a'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, W / 2 - 11); g.lineTo(W / 2 + 8, W / 2 + 8); g.lineTo(W / 2, W / 2 + 3); g.lineTo(W / 2 - 8, W / 2 + 8); g.closePath(); g.fill(); g.stroke();
  }

  /** Circles, squad, UAV, plane path, markers — in world coordinates on a transformed context. */
  private drawOverlays(g: CanvasRenderingContext2D, me: Player, px: number, mini = false) {
    const sim = this.sim, c = sim.circle;
    g.save();
    g.beginPath(); g.rect(-3000, -3000, MAP_SIZE + 6000, MAP_SIZE + 6000); g.arc(c.cx, c.cz, Math.max(0, c.r), 0, Math.PI * 2, true);
    g.fillStyle = 'rgba(220,50,40,0.33)'; g.fill('evenodd');
    g.restore();
    g.lineWidth = 2 * px; g.strokeStyle = 'rgba(255,90,70,0.9)'; g.beginPath(); g.arc(c.cx, c.cz, Math.max(0, c.r), 0, Math.PI * 2); g.stroke();
    if (!c.done && !sim.inWarmup) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 2 * px; g.setLineDash([10 * px, 6 * px]); g.beginPath(); g.arc(c.nx, c.nz, c.nr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      // line toward the safe zone when outside it
      if (Math.hypot(me.x - c.nx, me.z - c.nz) > c.nr) { const a = Math.atan2(c.nz - me.z, c.nx - me.x), d = Math.hypot(me.x - c.nx, me.z - c.nz) - c.nr; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2 * px; g.beginPath(); g.moveTo(me.x, me.z); g.lineTo(me.x + Math.cos(a) * d, me.z + Math.sin(a) * d); g.stroke(); }
    }
    if (sim.plane.active) {
      g.setLineDash([12 * px, 8 * px]); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2 * px;
      const pl = sim.plane; g.beginPath(); g.moveTo(pl.sx, pl.sz); g.lineTo(pl.sx + pl.dx * pl.dur * 62, pl.sz + pl.dz * pl.dur * 62); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(pl.x, pl.z, 6 * px, 0, Math.PI * 2); g.fill();
    }
    const icon = (x: number, z: number, color: string, shape: 'cart' | 'dot' | 'sq' | 'diamond', size = 5) => {
      g.fillStyle = color;
      if (shape === 'dot') { g.beginPath(); g.arc(x, z, size * px, 0, Math.PI * 2); g.fill(); }
      else if (shape === 'sq') g.fillRect(x - size * px, z - size * px, size * 2 * px, size * 2 * px);
      else if (shape === 'diamond') { g.beginPath(); g.moveTo(x, z - size * px); g.lineTo(x + size * px, z); g.lineTo(x, z + size * px); g.lineTo(x - size * px, z); g.closePath(); g.fill(); }
      else { g.strokeStyle = color; g.lineWidth = 1.6 * px; g.beginPath(); g.moveTo(x - size * px, z - size * px); g.lineTo(x - size * 0.6 * px, z + size * 0.4 * px); g.lineTo(x + size * px, z + size * 0.4 * px); g.lineTo(x + size * 1.1 * px, z - size * 0.5 * px); g.stroke(); g.beginPath(); g.arc(x - size * 0.4 * px, z + size * px, size * 0.3 * px, 0, 7); g.arc(x + size * 0.7 * px, z + size * px, size * 0.3 * px, 0, 7); g.fill(); }
    };
    for (const b of sim.buyStations) icon(b.x, b.z, '#f39a2a', 'cart', 6);
    // contracts: large static yellow badges (2020)
    for (const k of sim.contracts) if (!k.taken) { const r = (mini ? 13 : 16) * px; g.drawImage(contractBadge(k.kind), k.x - r, k.z - r, r * 2, r * 2); }
    // vehicles (2020): everyone sees every vehicle on both maps; the icon is tinted by who is inside, so riders show up too
    for (const v of sim.vehicles) {
      if (!v.alive || (mini && Math.hypot(v.x - me.x, v.z - me.z) > 450)) continue;
      const occ = v.seats.filter((id) => id >= 0).map((id) => sim.players[id]);
      const tint = !occ.length ? '#f2f2f0' : occ.some((q) => q.squad === me.squad) ? '#4aa8ff' : '#ff4436';
      const len = { heli: 20, truck: 16, suv: 13, rover: 12, atv: 10 }[v.type] ?? 12, sz = len * px * (mini ? 1.25 : 1.1);
      g.save(); g.translate(v.x, v.z); g.rotate(-v.yaw); g.drawImage(vehicleIcon(v.type, tint), -sz, -sz, sz * 2, sz * 2); g.restore();
    }
    for (const cr of sim.crates) if (cr.squad === me.squad) icon(cr.x, cr.z, '#ff6fb5', 'sq', 5);
    const uav = sim.squadUav.get(me.squad);
    if (uav && uav.until > sim.time) {
      const lvl = uav.level ?? 1;
      if (lvl >= 3) {
        // Advanced UAV: every enemy on the map, live, as a large red arrow showing where they face
        for (const p of sim.players) if (p.alive && p.squad !== me.squad && (p.phase === Phase.Alive || p.phase === Phase.Downed)) {
          g.save(); g.translate(p.x, p.z); g.rotate(-p.yaw); g.beginPath(); g.moveTo(0, -11 * px); g.lineTo(8 * px, 8 * px); g.lineTo(0, 3 * px); g.lineTo(-8 * px, 8 * px); g.closePath();
          g.fillStyle = '#ff2a1e'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5 * px; g.stroke(); g.restore();
        }
      } else {
        // UAV: a sweep pulses out every second (every half second with two stacked, wider); each sweep refreshes
        // the red dots of enemies inside the radius, which then fade until the next sweep
        const R = lvl >= 2 ? 650 : 450, period = lvl >= 2 ? 0.5 : 1;
        if (sim.time - this.uavSnapT >= period || sim.time < this.uavSnapT) {
          this.uavSnapT = sim.time; this.uavDots = [];
          for (const p of sim.players) if (p.alive && p.squad !== me.squad && (p.phase === Phase.Alive || p.phase === Phase.Downed) && Math.hypot(p.x - uav.x, p.z - uav.z) < R) this.uavDots.push([p.x, p.z]);
        }
        const age = sim.time - this.uavSnapT, k = Math.min(1, age / (period * 0.55));
        g.strokeStyle = 'rgba(255,70,50,0.35)'; g.lineWidth = 1.5 * px; g.beginPath(); g.arc(uav.x, uav.z, R, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = `rgba(255,90,60,${0.85 * (1 - k)})`; g.lineWidth = 3 * px; g.beginPath(); g.arc(uav.x, uav.z, R * k, 0, Math.PI * 2); g.stroke();
        g.fillStyle = `rgba(255,60,40,${0.1 * (1 - k)})`; g.beginPath(); g.arc(uav.x, uav.z, R * k, 0, Math.PI * 2); g.fill();
        const a = Math.max(0.25, 1 - (age / period) * 0.6);
        for (const [x, z] of this.uavDots) { g.fillStyle = `rgba(255,40,30,${a})`; g.beginPath(); g.arc(x, z, 5 * px, 0, Math.PI * 2); g.fill(); g.strokeStyle = `rgba(0,0,0,${a * 0.8})`; g.lineWidth = 1.2 * px; g.stroke(); }
      }
    }
    // unsuppressed gunfire: a red dot for ~3 s within 250 m (suppressors hide it)
    for (const p of sim.players) { const age = sim.time - ((p as any).lastLoudShot ?? -99); if (p.alive && p.squad !== me.squad && age < 3 && Math.hypot(p.x - me.x, p.z - me.z) < 250) icon(p.x, p.z, `rgba(255,60,40,${(0.95 * Math.min(1, (3 - age) / 1)).toFixed(2)})`, 'dot', 3.5); }
    const ac = sim.active.find((a) => a.squad === me.squad);
    for (const a of sim.active) if (a.kind === 'mostwanted' && a.squad !== me.squad) { const t = sim.players[a.target!]; if (t?.alive) { const r = (mini ? 12 : 15) * px; g.drawImage(contractBadge('mostwanted'), t.x - r, t.z - r, r * 2, r * 2); g.strokeStyle = '#ff3a2a'; g.lineWidth = 2.5 * px; g.beginPath(); g.arc(t.x, t.z, r * 1.2, 0, Math.PI * 2); g.stroke(); } }
    const ob = this.objective();
    if (ob) {
      // active contract: yellow area + big static badge; on the minimap it sits on the rim when out of range
      let ox = ob.x, oz = ob.z;
      if (mini) { const R = (this.mm.width / 2) * px * 0.8, d = Math.hypot(ox - me.x, oz - me.z); if (d > R) { ox = me.x + ((ox - me.x) / d) * R; oz = me.z + ((oz - me.z) / d) * R; } }
      else { g.setLineDash([10 * px, 8 * px]); g.strokeStyle = 'rgba(246,195,67,0.8)'; g.lineWidth = 2.5 * px; g.beginPath(); g.moveTo(me.x, me.z); g.lineTo(ob.x, ob.z); g.stroke(); g.setLineDash([]); }
      if (ob.area) { g.fillStyle = 'rgba(246,195,67,0.18)'; g.strokeStyle = 'rgba(246,195,67,0.9)'; g.lineWidth = 2.5 * px; g.beginPath(); g.arc(ob.x, ob.z, ob.area, 0, Math.PI * 2); g.fill(); g.stroke(); }
      const r = (mini ? 15 : 20) * px; g.drawImage(contractBadge(ob.kind), ox - r, oz - r, r * 2, r * 2);
    }
    const mates = sim.players.filter((p) => p.squad === me.squad && p.id !== me.id);
    mates.forEach((p, i) => {
      if (!p.alive || p.phase === Phase.GulagWait || p.phase === Phase.Gulag) return;
      g.fillStyle = p.phase === Phase.Downed ? '#ff4a3a' : SQUAD_COLORS[i + 1];
      g.save(); g.translate(p.x, p.z); g.rotate(-p.yaw); g.beginPath(); g.moveTo(0, -9 * px); g.lineTo(7 * px, 7 * px); g.lineTo(-7 * px, 7 * px); g.closePath(); g.fill(); g.restore();
    });
    for (const e of sim.enemyPings) if (e.squad === me.squad && e.until > sim.time) { g.fillStyle = '#e5171c'; g.strokeStyle = '#fff'; g.lineWidth = 1.5 * px; g.beginPath(); g.moveTo(e.x, e.z - 7 * px); g.lineTo(e.x + 7 * px, e.z); g.lineTo(e.x, e.z + 7 * px); g.lineTo(e.x - 7 * px, e.z); g.closePath(); g.fill(); g.stroke(); }
    for (const pg of this.pings) { g.strokeStyle = '#f6c343'; g.lineWidth = 2 * px; g.beginPath(); g.moveTo(pg.x, pg.z - 8 * px); g.lineTo(pg.x + 8 * px, pg.z); g.lineTo(pg.x, pg.z + 8 * px); g.lineTo(pg.x - 8 * px, pg.z); g.closePath(); g.stroke(); }
  }

  private drawFullMap(me: Player) {
    const g = this.fmCanvas.getContext('2d')!, W = this.fmCanvas.width, v = this.fmView(), sc = W / v.span, T = this.tac, k = T.width / MAP_SIZE;
    const X = (x: number) => (x - v.x0) * sc, Z = (z: number) => (z - v.z0) * sc;
    g.fillStyle = '#23272a'; g.fillRect(0, 0, W, W);
    g.drawImage(T, v.x0 * k, v.z0 * k, v.span * k, v.span * k, 0, 0, W, W);
    // zoomed in: detailed tiles (405 m, 0.8 m/px) rendered lazily, one per frame
    if (this.fmZoom >= 1.9) {
      const TS = MAP_SIZE / 8; let made = false;
      for (let tj = Math.max(0, Math.floor(v.z0 / TS)); tj <= Math.min(7, Math.floor((v.z0 + v.span) / TS)); tj++)
        for (let ti = Math.max(0, Math.floor(v.x0 / TS)); ti <= Math.min(7, Math.floor((v.x0 + v.span) / TS)); ti++) {
          const key = tj * 8 + ti; let t = this.fmTiles.get(key);
          if (!t && !made) { t = renderTacRegion(this.sim.world, ti * TS, tj * TS, TS, 512); this.fmTiles.set(key, t); made = true; }
          if (t) g.drawImage(t, X(ti * TS), Z(tj * TS), TS * sc + 0.5, TS * sc + 0.5);
        }
    }
    g.save(); g.setTransform(sc, 0, 0, sc, -v.x0 * sc, -v.z0 * sc);
    this.drawOverlays(g, me, 1 / sc);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 15px Rajdhani, sans-serif'; g.textAlign = 'left';
    // grid registered to the 2020 tac map: column B starts at x=85 m, row 1 at z=118 m, cells 381 m
    for (let i = 0; i < 11; i++) {
      const gx = 85 - 381 + i * 381, gz = 118 - 381 + i * 381;
      g.beginPath(); g.moveTo(X(gx), 0); g.lineTo(X(gx), W); g.stroke(); g.beginPath(); g.moveTo(0, Z(gz)); g.lineTo(W, Z(gz)); g.stroke();
      if (i < 10) { g.fillText('ABCDEFGHIJ'[i], Math.max(4, Math.min(W - 14, X(gx + 190) - 5)), 16); g.fillText(String(i), 4, Math.max(20, Math.min(W - 6, Z(gz + 190) + 5))); }
    }
    g.textAlign = 'center';
    for (const p of POIS) {
      const show = p.tier === 'major' || (p.tier === 'minor' && this.fmZoom >= 1.9) || this.fmZoom >= 3.5;
      if (!show) continue;
      g.font = p.tier === 'major' ? `700 ${16 + Math.min(6, this.fmZoom)}px Rajdhani, sans-serif` : '600 14px Rajdhani, sans-serif';
      const tw = g.measureText(p.name).width; g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(X(p.x) - tw / 2 - 5, Z(p.z) - 12, tw + 10, 20); g.fillStyle = p.tier === 'major' ? '#fff' : '#d8dcdc'; g.fillText(p.name, X(p.x), Z(p.z) + 3);
    }
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '600 14px Rajdhani, sans-serif'; g.fillText(`ZOOM x${this.fmZoom.toFixed(1)}  (wheel to zoom, drag to pan)`, 10, W - 10);
    // you (2020 tac map): big yellow arrow with a dark outline and a view cone; it turns with your view
    {
      const yaw = this.sim.players[this.localId] === me ? this.camYawV : me.yaw;
      g.save(); g.translate(X(me.x), Z(me.z));
      g.rotate(-yaw);
      const cone = g.createRadialGradient(0, 0, 4, 0, 0, 90); cone.addColorStop(0, 'rgba(246,195,67,0.45)'); cone.addColorStop(1, 'rgba(246,195,67,0)');
      g.fillStyle = cone; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 90, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, -20); g.lineTo(14, 14); g.lineTo(0, 7); g.lineTo(-14, 14); g.closePath();
      g.fillStyle = '#ffd24a'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#111'; g.stroke();
      g.restore();
    }
  }


  // ---------------------------------------------------------------- menus
  openBuy(onBuy: (item: BuyId, arg?: number) => string | null, onClose: () => void) {
    this.closePanel();
    const me = this.sim.players[this.localId];
    const p = el('div', 'buy bs');
    let sel = 0;
    // 2020 layout: list of rows on the left (price right-aligned, red + padlock when unaffordable), detail card on the right
    const render = (err = '') => {
      const dead = this.sim.players.filter((q) => q.squad === me.squad && q.id !== me.id && q.phase === Phase.Dead);
      const rows: { k: BuyId; a?: number; name: string; desc: string; price: number; icon: string; cat: string; ok: boolean }[] = [];
      for (const b of BUY_ITEMS) {
        if (this.sim.squadSize === 1 && (b.id === 'buyback' || b.id === 'selfRevive')) continue;
        if (b.id === 'buyback') {
          if (!dead.length) rows.push({ k: 'buyback', name: 'Squad Buyback', desc: 'No teammates to buy back.', price: b.price, icon: b.icon, cat: b.cat, ok: false });
          for (const q of dead) rows.push({ k: 'buyback', a: q.id, name: `Buyback ${q.name}`, desc: b.desc, price: b.price, icon: b.icon, cat: b.cat, ok: me.cash >= b.price });
        } else rows.push({ k: b.id, name: b.name, desc: b.desc, price: b.price, icon: b.icon, cat: b.cat, ok: me.cash >= b.price });
      }
      // one EQUIPMENT list sorted by price, as in the 2020 menu
      rows.sort((x, y) => x.price - y.price || x.name.localeCompare(y.name));
      sel = Math.min(sel, rows.length - 1);
      let list = '<div class="bcat">Equipment</div>';
      rows.forEach((r, i) => {
        list += `<div class="brow ${r.ok ? '' : 'no'} ${i === sel ? 'sel' : ''}" data-i="${i}"><i class="lock">${r.ok ? '' : ICON.lock}</i><span class="bn">${r.name}</span><span class="bp">$${r.price}</span></div>`;
      });
      const s = rows[sel];
      const detail = `<div class="bdet"><div class="bbig">${ICON[s.icon] ?? ''}</div><div class="btitle">${s.name}</div><div class="bband">${s.cat === 'Killstreaks' ? 'Killstreak' : s.cat === 'Field Upgrades' ? 'Field Upgrade' : s.cat}</div><div class="bdesc">${s.desc}</div></div>`;
      p.innerHTML = `<div class="bbox"><div class="bhead"><span class="btl">Buy Station</span><span class="bcash">$${me.cash}</span></div><div class="bmain"><div class="blist">${list}</div>${detail}</div><div class="berr">${err}</div></div><div class="bbar"><span>${this.k('interact')} Back</span><span><i class="key">LMB</i> Select</span><span><i class="key">Esc</i> Dismiss Menu</span></div>`;
      p.querySelectorAll<HTMLElement>('.brow').forEach((n) => {
        const i = +n.dataset.i!;
        n.onmouseenter = () => { if (sel !== i) { sel = i; render(err); } };
        n.onclick = () => { const r = rows[i]; if (!r.ok && r.k === 'buyback' && r.a === undefined) return; const e = onBuy(r.k, r.a); render(e ?? ''); };
      });
    };
    render();
    this.panel = p; this.root.appendChild(p);
    (p as any).onClose = onClose;
  }
  openLoadout(onPick: (i: number) => void) {
    this.closePanel();
    const p = el('div', 'buy');
    p.innerHTML = `<div class="bbox"><div class="bhead"><span>${ICON.loadout} LOADOUT DROP</span><span class="bcash">Choose a custom class</span></div><div class="bgrid">${LOADOUTS.map((l, i) => `<div class="bit" data-i="${i}"><div class="bic lo">${sil(l.guns[0], 5)}</div><div class="bn">${l.name}</div><div class="bd">${WEAPON[l.guns[0]].name} + ${WEAPON[l.guns[1]].name} · ${LETHAL_NAMES[l.lethal]} · ${TACTICAL_NAMES[l.tactical]}</div></div>`).join('')}</div></div>`;
    p.querySelectorAll<HTMLElement>('.bit').forEach((n) => n.onclick = () => { onPick(+n.dataset.i!); this.closePanel(); });
    this.panel = p; this.root.appendChild(p);
  }
  /**
   * Tab backpack (Warzone 2020): squad on the left, your backpack in the middle (weapons, the five ammo
   * pools, plates, cash, equipment, killstreak, field upgrade) with a Drop action on everything
   * droppable, match info + contract on the right. The cursor is free; you can keep moving.
   */
  openBackpack(onDrop: (what: BackpackDrop, arg?: number | string) => boolean, onClose: () => void) {
    this.closePanel();
    const p = el('div', 'bkpk');
    (p as any).kind = 'backpack'; (p as any).onDrop = onDrop; (p as any).onClose = onClose;
    p.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-drop]') as HTMLElement | null; if (!b) return;
      const arg = b.dataset.arg === undefined ? undefined : isNaN(+b.dataset.arg) ? b.dataset.arg : +b.dataset.arg;
      if (onDrop(b.dataset.drop as BackpackDrop, arg)) this.refreshBackpack(true);
    });
    this.panel = p; this.root.appendChild(p);
    this.refreshBackpack(true);
  }
  get backpackOpen() { return (this.panel as any)?.kind === 'backpack'; }
  private bpLast = '';
  /** Rebuild the backpack contents (only when something changed). */
  refreshBackpack(force = false) {
    const p = this.panel; if (!p || (p as any).kind !== 'backpack') return;
    const sim = this.sim, me = sim.players[this.localId];
    const btn = (what: string, label = 'Drop', arg?: string | number, on = true) => `<button class="bpd ${on ? '' : 'off'}" data-drop="${what}"${arg !== undefined ? ` data-arg="${arg}"` : ''}${on ? '' : ' disabled'}>${label}</button>`;
    // weapons
    const wrow = (i: number) => {
      const w = me.weapons[i]; if (!w) return `<div class="bpw empty"><div class="sil"></div><div class="nm">${i === 0 ? 'Primary' : 'Secondary'} — empty</div></div>`;
      const d = WEAPON[w.id], bp = blueprintName(w.id, w.rarity), rc = RARITY_COLORS[w.rarity];
      const att = attachmentsFor(w.id, w.rarity, 0);
      return `<div class="bpw ${i === me.cur ? 'cur' : ''}" style="--rc:${rc}"><div class="sil">${sil(w.id, w.rarity)}</div><div class="nm"><b>${bp ? '"' + bp + '" ' : ''}${d.name}</b><span style="color:${rc}">${RARITY_NAMES[w.rarity]} ${CLASS_NAMES[d.cls]}</span><small>${att.join(' · ') || 'No attachments'}</small></div><div class="mag">${d.cls === 'melee' ? '' : w.mag + ' / ' + (me.ammo[d.ammo] ?? 0)}</div>${btn('weapon', 'Drop', i)}</div>`;
    };
    const ammoTypes: [keyof typeof AMMO_NAMES, string][] = [['light', 'light'], ['heavy', 'heavy'], ['sniper', 'sniper'], ['shotgun', 'shotgun'], ['rocket', 'rocket']];
    const ammo = ammoTypes.map(([t]) => `<div class="bpa"><i class="am ${t}"></i><span>${AMMO_NAMES[t]}</span><b>${me.ammo[t as keyof typeof me.ammo] ?? 0}</b>${btn('ammo', 'Drop', t, (me.ammo[t as keyof typeof me.ammo] ?? 0) > 0)}</div>`).join('');
    const eq = (icon: string, name: string, n: string, what: string, on: boolean) => `<div class="bpe ${on ? '' : 'none'}"><div class="ic">${icon}</div><span>${name}</span><b>${n}</b>${btn(what, 'Drop', undefined, on)}</div>`;
    const lethal = me.lethal ? eq(ICON[LETHAL_ICON[me.lethal.type]], LETHAL_NAMES[me.lethal.type], 'x' + me.lethal.n, 'lethal', true) : eq('', 'Lethal', '—', 'lethal', false);
    const tact = me.tactical ? eq(ICON[TACTICAL_ICON[me.tactical.type]], TACTICAL_NAMES[me.tactical.type], 'x' + me.tactical.n, 'tactical', true) : eq('', 'Tactical', '—', 'tactical', false);
    const ks = me.killstreak ? eq(ICON[STREAK_ICON[me.killstreak]], KILLSTREAK_NAMES[me.killstreak], '', 'killstreak', true) : eq('', 'Killstreak', '—', 'killstreak', false);
    const fu = `<div class="bpe ${me.fieldUpgrade ? '' : 'none'}"><div class="ic">${me.fieldUpgrade ? ICON[me.fieldUpgrade] : ''}</div><span>${me.fieldUpgrade ? FIELD_UPGRADE_NAMES[me.fieldUpgrade] : 'Field Upgrade'}</span><b>${me.fieldUpgrade ? 'Ready' : '—'}</b></div>`;
    const mask = eq(ICON.gasMask, 'Gas Mask', me.hasMask ? Math.ceil((me.gasMask / 12) * 100) + '%' : '—', 'gasMask', me.hasMask);
    const sr = eq(ICON.selfRevive, 'Self-Revive Kit', me.selfRevive ? '1' : '—', 'selfRevive', me.selfRevive);
    const plates = `<div class="bpp"><div class="ic">${me.maxPlates > 5 ? ICON.satchel : ICON.plate}</div><span>Armor Plates</span><b>${me.plates} / ${me.maxPlates}</b>${btn('plate', 'Drop 1', undefined, me.plates > 0)}</div>`;
    const cash = `<div class="bpc"><div class="ic">${ICON.cash}</div><span>Cash</span><b>${me.cash.toLocaleString()}</b>${btn('cash', '$100', 100, me.cash > 0)}${btn('cash', '$1,000', 1000, me.cash >= 1000)}${btn('cash', 'All', 'all', me.cash > 0)}</div>`;
    // squad
    const mates = sim.players.filter((q) => q.squad === me.squad);
    const squad = mates.map((q, i) => {
      const st = q.phase === Phase.Dead ? 'Dead' : q.phase === Phase.Downed ? 'Downed' : q.phase === Phase.Gulag || q.phase === Phase.GulagWait ? 'Gulag' : q.phase === Phase.Plane ? 'In plane' : q.phase === Phase.Freefall || q.phase === Phase.Chute ? 'Deploying' : 'Alive';
      return `<div class="bps ${q.id === me.id ? 'me' : ''}"><i style="background:${SQUAD_COLORS[i] ?? '#fff'}"></i><b>${q.name}</b><span class="st ${st.toLowerCase()}">${st}</span><span>${q.kills} kills</span><span>${q.cash.toLocaleString()}</span><span>${q.plates} plates</span></div>`;
    }).join('');
    // match + contract
    const ac = sim.active.find((a) => a.squad === me.squad);
    const c = sim.circle;
    const contract = ac ? `<div class="bpk"><b>${ac.kind[0].toUpperCase() + ac.kind.slice(1)} Contract</b><span>${ac.kind === 'bounty' ? 'Eliminate the marked target' : ac.kind === 'recon' ? 'Secure the marked location' : 'Open the marked supply boxes'}</span></div>` : '<div class="bpk none">No active contract</div>';
    const mins = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const html = `<div class="bpcol l"><h3>Squad</h3>${squad}<h3>Contract</h3>${contract}</div>
      <div class="bpcol m"><h2>Backpack</h2><h3>Weapons</h3>${wrow(0)}${wrow(1)}<div class="bpgrid"><div><h3>Ammo</h3>${ammo}</div><div><h3>Equipment</h3>${lethal}${tact}${ks}${fu}${mask}${sr}</div></div>${plates}${cash}</div>
      <div class="bpcol r"><h3>Match</h3><div class="bpm"><span>Players left</span><b>${sim.aliveCount}</b></div><div class="bpm"><span>Squads left</span><b>${sim.squadsLeft()}</b></div><div class="bpm"><span>Your kills</span><b>${me.kills}</b></div><div class="bpm"><span>Damage</span><b>${Math.round(me.damage)}</b></div><div class="bpm"><span>Match time</span><b>${mins(sim.time)}</b></div><div class="bpm"><span>Circle</span><b>${c.done ? 'Final' : (c.closing ? 'Closing ' : 'Next in ') + fmtT(c.t)}</b></div>
      <div class="bph">${this.k('scoreboard')} / Esc to close · Click Drop to leave an item for your squad</div></div>`;
    const key = html.length + ':' + html.slice(0, 64) + me.cash + me.plates + JSON.stringify(me.ammo) + me.weapons.map((w) => w?.id + ':' + w?.mag).join() + mins(sim.time) + sim.aliveCount;
    if (!force && key === this.bpLast) return;
    this.bpLast = key; p.innerHTML = html;
  }
  closePanel() { if (this.panel) { const cb = (this.panel as any).onClose; this.panel.remove(); this.panel = null; cb?.(); } }
}
export { RARITY_NAMES, FIELD_UPGRADE_NAMES };
