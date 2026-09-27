/**
 * Warzone (2020) HUD, laid out from measured 2020 screenshots: circular rotating minimap and circle
 * timer (top-left), compass + location (top-centre), squads/players/kills (top-right), killfeed above
 * the squad cards (bottom-left), plates/gas mask next to your card, weapon + equipment (bottom-right),
 * loot card above the crosshair, hitmarkers, prompts, parachute altimeter, tac map and buy menus.
 */
import type { Sim } from '../sim/sim';
import { LOADOUTS } from '../sim/sim';
import { ItemKind, Phase, Player, SimEvent, Item } from '../sim/types';
import { WEAPON, RARITY_COLORS, RARITY_NAMES, CLASS_NAMES, AMMO_NAMES, attachmentsFor, blueprintName, WeaponDef, damageAt } from '../data/weapons';
import { LETHAL_NAMES, TACTICAL_NAMES, KILLSTREAK_NAMES, FIELD_UPGRADE_NAMES } from '../sim/loot';
import { CIRCLES } from '../sim/config';
import { POIS, MAP_SIZE } from '../world/mapdata';
import { vehicleOf, VEHICLES } from '../sim/vehicles';
import { ICON, LETHAL_ICON, TACTICAL_ICON, STREAK_ICON } from './icons';
import { describeGun, gunSilhouette } from '../render/gunModel';
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
function sil(id: string, rarity: number, fill = '#fff') { const k = `${id}:${rarity}:${fill}`; let s = silCache.get(k); if (!s) { s = gunSilhouette(describeGun(WEAPON[id], rarity), fill); silCache.set(k, s); } return s; }

export class Hud {
  root = el('div', 'hud');
  private mm: HTMLCanvasElement; private mmCtx: CanvasRenderingContext2D;
  private circ = el('div', 'circ');
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
  private vig = el('div', 'vig');
  private scope = el('div', 'scope');
  private flash = el('div', 'flash');
  private dot = el('div', 'reddot');
  private tags = el('div');
  private alt = el('div', 'alt');
  fullmap = el('div', 'fullmap');
  private fmCanvas: HTMLCanvasElement;
  panel: HTMLElement | null = null;
  private hmT = 0; private hmGlyphT = 0; private bannerT = 0; private noteT = 0; private nameT = 0;
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
    this.fmCanvas.addEventListener('mousedown', (e) => { const r = this.fmCanvas.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * MAP_SIZE, z = ((e.clientY - r.top) / r.height) * MAP_SIZE; this.pings = [{ x, z, t: 999 }]; (this.sim.players[this.localId] as any).ping = { x, z }; });
    this.root.append(this.vig, this.scope, mmw, this.circ, this.compass, this.heading, this.loc, this.counters, this.feed, this.squad, this.inv, this.fu, this.weap, this.xh, this.hm, this.tags, this.lcard, this.hold, this.prog, this.ctx, this.alt, this.banner, this.note, this.dmg, this.flash, this.dot, this.fullmap);
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
      case 'hit':
        if (e.attacker === this.localId) {
          this.hmT = 0.26;
          this.hm.className = 'hm' + (e.kill || e.down ? ' kill' : '') + (e.armorBroke ? ' break' : e.armorHit ? ' armor' : '');
          if (e.armorBroke) this.hmGlyphT = 0.55;
        }
        if (e.victim === this.localId && e.attacker >= 0) {
          const a = this.sim.players[e.attacker];
          const i = el('i'); this.dmg.appendChild(i); this.dmgArcs.push({ a: Math.atan2(a.x - me.x, a.z - me.z), t: 1.4, e: i });
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
          const m: Record<string, [string, string]> = { enter: ['Welcome to the Gulag', 'Win your 1v1 to get back into Verdansk'], fight: ['Fight!', 'The winner redeploys'], overtime: ['Overtime', 'Capture the flag in the centre'], win: ['Gulag won', 'Redeploying...'], lose: ['Eliminated', 'Your squad can buy you back'], closed: ['', ''] };
          this.showBanner(...m[e.msg]);
        } else if (e.msg === 'closed') this.showNote('The Gulag is closed');
        break;
      case 'redeploy': if (this.sim.players[e.p].squad === me.squad) this.feedLine(`${name(e.p)} <span style="opacity:.7">redeployed</span>`); break;
      case 'announce': if ((e.squad === undefined || e.squad === me.squad) && !e.text.startsWith('__')) this.showNote(e.text); break;
      case 'contract': if (this.sim.players[e.p].squad === me.squad) this.showBanner(`${e.kind} contract`, e.msg === 'start' ? 'Contract accepted' : e.msg === 'done' ? 'Contract complete' : e.msg === 'fail' ? 'Contract failed' : 'Next target marked'); break;
      case 'uav': this.showNote(e.squad === me.squad ? 'UAV online' : 'Enemy UAV overhead'); break;
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
    this.dot.style.display = (opts.optic || opts.scope) && opts.ads > 0.85 ? 'block' : 'none';
    // --- vignettes
    let vig = '';
    if (view.phase === Phase.Downed) vig = 'radial-gradient(circle, transparent 30%, rgba(120,0,0,0.6))';
    else if (inGas) vig = 'radial-gradient(circle, rgba(170,150,30,0.22) 20%, rgba(150,140,20,0.55))';
    else if (view.health < 60 && view.alive) vig = `radial-gradient(circle, transparent 45%, rgba(140,0,0,${0.55 * (1 - view.health / 60)}))`;
    if (this.last.vig !== vig) { this.last.vig = vig; this.vig.style.background = vig; }
    const fo = parseFloat(this.flash.style.opacity || '0'); if (fo > 0) this.flash.style.opacity = String(Math.max(0, fo - dt * (view.flashT > 0 ? 0.25 : 1.5)));
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
    const ac = sim.active.find((a) => a.squad === me.squad);
    if (ac?.kind === 'recon') tag(ac.zx!, ac.zy! + 3, ac.zz!, 'mk', `RECON<div class="d">${Math.round(Math.hypot(ac.zx! - view.x, ac.zz! - view.z))}m</div>`);
    if (ac?.kind === 'scavenger') { const ch = sim.chests.find((q) => q.id === ac.chest); if (ch) tag(ch.x, ch.y + 2, ch.z, 'mk', `SUPPLY<div class="d">${Math.round(Math.hypot(ch.x - view.x, ch.z - view.z))}m</div>`); }
    for (const cr of sim.crates) if (cr.squad === me.squad) tag(cr.x, cr.y + 2, cr.z, 'mk', `LOADOUT<div class="d">${Math.round(Math.hypot(cr.x - view.x, cr.z - view.z))}m</div>`);
    this.set('tags', this.tags, tg);
    this.drawMinimap(view, camYaw);
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
    for (const k of sim.contracts) if (!k.taken) icon(k.x, k.z, k.kind === 'bounty' ? '#ff6a4a' : k.kind === 'recon' ? '#f6c343' : '#6ab0ff', 'diamond', 5);
    if (mini) for (const v of sim.vehicles) if (v.alive && Math.hypot(v.x - me.x, v.z - me.z) < 400) icon(v.x, v.z, 'rgba(255,255,255,0.8)', 'sq', 3);
    for (const cr of sim.crates) if (cr.squad === me.squad) icon(cr.x, cr.z, '#ff6fb5', 'sq', 5);
    const uav = sim.squadUav.get(me.squad);
    if (uav && uav.until > sim.time) for (const p of sim.players) if (p.alive && p.squad !== me.squad && p.phase === Phase.Alive && Math.hypot(p.x - uav.x, p.z - uav.z) < 450) icon(p.x, p.z, '#ff3a2a', 'dot', 4);
    for (const p of sim.players) if (p.alive && p.squad !== me.squad && sim.time - p.lastShot < 1.2 && Math.hypot(p.x - me.x, p.z - me.z) < 160) icon(p.x, p.z, 'rgba(255,60,40,0.95)', 'dot', 3.5);
    const ac = sim.active.find((a) => a.squad === me.squad);
    if (ac?.kind === 'bounty') { const t = sim.players[ac.target!]; g.strokeStyle = '#ff4a3a'; g.lineWidth = 2 * px; g.beginPath(); g.arc(t.x + Math.sin(sim.time * 0.3) * 40, t.z + Math.cos(sim.time * 0.3) * 40, 90, 0, Math.PI * 2); g.stroke(); }
    if (ac?.kind === 'recon') icon(ac.zx!, ac.zz!, '#f6c343', 'sq', 6);
    const mates = sim.players.filter((p) => p.squad === me.squad && p.id !== me.id);
    mates.forEach((p, i) => {
      if (!p.alive || p.phase === Phase.GulagWait || p.phase === Phase.Gulag) return;
      g.fillStyle = p.phase === Phase.Downed ? '#ff4a3a' : SQUAD_COLORS[i + 1];
      g.save(); g.translate(p.x, p.z); g.rotate(-p.yaw); g.beginPath(); g.moveTo(0, -9 * px); g.lineTo(7 * px, 7 * px); g.lineTo(-7 * px, 7 * px); g.closePath(); g.fill(); g.restore();
    });
    for (const pg of this.pings) { g.strokeStyle = '#f6c343'; g.lineWidth = 2 * px; g.beginPath(); g.moveTo(pg.x, pg.z - 8 * px); g.lineTo(pg.x + 8 * px, pg.z); g.lineTo(pg.x, pg.z + 8 * px); g.lineTo(pg.x - 8 * px, pg.z); g.closePath(); g.stroke(); }
  }

  private drawFullMap(me: Player) {
    const g = this.fmCanvas.getContext('2d')!, W = this.fmCanvas.width, s = W / MAP_SIZE;
    g.drawImage(this.tac, 0, 0, W, W);
    g.save(); g.scale(s, s);
    this.drawOverlays(g, me, 1 / s);
    g.fillStyle = '#f6b03a'; g.save(); g.translate(me.x, me.z); g.rotate(-me.yaw); g.beginPath(); g.moveTo(0, -14 / s); g.lineTo(10 / s, 10 / s); g.lineTo(-10 / s, 10 / s); g.closePath(); g.fill(); g.restore();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '600 15px Rajdhani, sans-serif';
    // grid registered to the 2020 tac map: column B starts at x=85 m, row 1 at z=118 m, cells 381 m
    const cell = 381 * s, ox = (85 - 381) * s, oz = (118 - 381) * s;
    for (let i = 0; i < 11; i++) {
      const x = ox + i * cell, z = oz + i * cell;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, W); g.stroke(); g.beginPath(); g.moveTo(0, z); g.lineTo(W, z); g.stroke();
      if (i < 10) { g.fillText('ABCDEFGHIJ'[i], x + cell / 2 - 5, 16); g.fillText(String(i), 4, z + cell / 2 + 5); }
    }
    g.font = '700 16px Rajdhani, sans-serif'; g.textAlign = 'center';
    for (const p of POIS) if (p.tier === 'major') { g.fillStyle = 'rgba(0,0,0,0.55)'; const tw = g.measureText(p.name).width; g.fillRect(p.x * s - tw / 2 - 5, p.z * s - 12, tw + 10, 20); g.fillStyle = '#fff'; g.fillText(p.name, p.x * s, p.z * s + 3); }
    g.textAlign = 'left';
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
  closePanel() { if (this.panel) { const cb = (this.panel as any).onClose; this.panel.remove(); this.panel = null; cb?.(); } }
}
export { RARITY_NAMES, FIELD_UPGRADE_NAMES };
