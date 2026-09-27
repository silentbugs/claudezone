/** DOM HUD in the Warzone (2020) layout + minimap/full map canvases + buy/loadout menus. */
import type { Sim } from '../sim/sim';
import { LOADOUTS } from '../sim/sim';
import { Phase, Player, SimEvent } from '../sim/types';
import { WEAPON, RARITY_COLORS, RARITY_NAMES } from '../data/weapons';
import { LETHAL_NAMES, TACTICAL_NAMES, KILLSTREAK_NAMES } from '../sim/loot';
import { CIRCLES, PRICES } from '../sim/config';
import { POIS, MAP_SIZE } from '../world/mapdata';
import { eyeHeight } from '../sim/movement';
import { vehicleOf, VEHICLES } from '../sim/vehicles';

const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const fmtT = (s: number) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class Hud {
  root = el('div', 'hud');
  private mm: HTMLCanvasElement; private mmCtx: CanvasRenderingContext2D;
  private gas = el('div', 'gasbar');
  private compass = el('div', 'compass');
  private strip = el('div', 'strip');
  private alive = el('div', 'alive');
  private squad = el('div', 'squad');
  private self = el('div', 'self');
  private weap = el('div', 'weap');
  private xh = el('div', 'xh');
  private hm = el('div', 'hm');
  private prompt = el('div', 'prompt');
  private prog = el('div', 'prog', '<i></i>');
  private feed = el('div', 'feed');
  private banner = el('div', 'banner');
  private note = el('div', 'note');
  private dmg = el('div', 'dmg');
  private vig = el('div', 'vig');
  private scope = el('div', 'scope');
  private flash = el('div', 'flash');
  private dot = el('div', 'reddot');
  private markers = el('div');
  fullmap = el('div', 'fullmap');
  private fmCanvas: HTMLCanvasElement;
  panel: HTMLElement | null = null;
  private hmT = 0; private bannerT = 0; private noteT = 0;
  private dmgArcs: { a: number; t: number; e: HTMLElement }[] = [];
  private last: Record<string, string> = {};
  pings: { x: number; z: number; t: number }[] = [];

  constructor(private sim: Sim, private tac: HTMLCanvasElement, private localId: number) {
    const mmw = el('div', 'mm'); this.mm = document.createElement('canvas'); this.mm.width = this.mm.height = 232; mmw.appendChild(this.mm);
    this.mmCtx = this.mm.getContext('2d')!;
    this.compass.append(this.strip, el('div', 'ptr'));
    for (let i = 0; i < 4; i++) { const t = el('i'); this.xh.appendChild(t); }
    for (let i = 0; i < 4; i++) { const t = el('i'); t.style.transform = `rotate(${45 + i * 90}deg) translate(0, -14px)`; t.style.left = '-1px'; t.style.top = '-5px'; this.hm.appendChild(t); }
    this.fmCanvas = document.createElement('canvas'); this.fmCanvas.width = this.fmCanvas.height = 1200;
    this.fullmap.append(this.fmCanvas, el('div', 'legend', '<b>TAC MAP</b><br>White ring: next safe zone<br>Orange: gas<br>Blue: your squad<br>Dashed line: C-130 flight path<br>Red dots: enemies (UAV)<br><br>Click to place a marker'));
    this.fmCanvas.addEventListener('mousedown', (e) => { const r = this.fmCanvas.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * MAP_SIZE, z = ((e.clientY - r.top) / r.height) * MAP_SIZE; this.pings = [{ x, z, t: 999 }]; });
    this.root.append(this.vig, this.scope, mmw, this.gas, this.compass, this.alive, this.squad, this.self, this.weap, this.xh, this.hm, this.markers, this.prompt, this.prog, this.feed, this.banner, this.note, this.dmg, this.flash, this.dot, this.fullmap);
    this.buildCompass();
  }

  private buildCompass() {
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let h = '';
    for (let d = -360; d <= 720; d += 15) {
      const x = d * 4;
      const dd = ((d % 360) + 360) % 360;
      h += labels[dd] !== undefined ? `<span style="left:${x}px;color:${dd === 0 ? '#f6c343' : '#fff'}">${labels[dd]}</span>` : `<i class="tick" style="left:${x}px"></i><span style="left:${x}px;font-size:10px;top:12px;opacity:.6">${dd}</span>`;
    }
    this.strip.innerHTML = h;
  }

  private set(key: string, e: HTMLElement, html: string) { if (this.last[key] !== html) { this.last[key] = html; e.innerHTML = html; } }

  onEvent(e: SimEvent) {
    const me = this.sim.players[this.localId];
    const name = (id: number) => { const p = this.sim.players[id]; if (!p) return '?'; const cls = p.squad === me.squad ? 'sq' : 'en'; return `<span class="${cls}">${p.name}</span>`; };
    switch (e.t) {
      case 'hit':
        if (e.attacker === this.localId) { this.hmT = 0.18; this.hm.className = 'hm' + (e.kill || e.down ? ' kill' : e.armorBroke ? ' armor' : ''); }
        if (e.victim === this.localId && e.attacker >= 0) {
          const a = this.sim.players[e.attacker];
          const ang = Math.atan2(a.x - me.x, a.z - me.z);
          const i = el('i'); this.dmg.appendChild(i); this.dmgArcs.push({ a: ang, t: 1.4, e: i });
        }
        break;
      case 'kill': case 'down': {
        const w = WEAPON[e.w]?.name ?? (e.w === 'gas' ? 'the Gas' : e.w === 'fall' ? 'Falling' : e.w === 'bleed' ? 'Bled out' : e.w);
        const txt = e.attacker >= 0 ? `${name(e.attacker)} <span style="opacity:.7">[${w}]</span> ${e.t === 'down' ? 'downed' : 'killed'} ${name(e.victim)}` : `${name(e.victim)} ${e.t === 'down' ? 'was downed by' : 'died to'} ${w}`;
        this.feedLine(txt);
        if (e.attacker === this.localId && e.victim !== this.localId) this.showNote(e.t === 'down' ? 'Enemy downed' : 'Enemy killed' + ((e as any).head ? ' — headshot' : ''));
        break;
      }
      case 'circle': this.showBanner(e.closing ? 'Gas closing' : 'Safe zone revealed', e.closing ? 'Get inside the circle' : `Circle ${e.phase + 1} of ${CIRCLES.length}`); break;
      case 'gulag':
        if (e.p === this.localId) {
          const m: Record<string, [string, string]> = { enter: ['Welcome to the Gulag', 'Win your 1v1 to redeploy'], fight: ['Fight!', 'Winner goes back to Verdansk'], overtime: ['Overtime', 'Capture the flag in the centre'], win: ['Gulag won', 'Redeploying...'], lose: ['Eliminated', 'Wait for a teammate to buy you back'], closed: ['', ''] };
          this.showBanner(...m[e.msg]);
        } else if (e.msg === 'closed') this.showNote('The Gulag is now closed');
        break;
      case 'redeploy': if (this.sim.players[e.p].squad === me.squad) this.feedLine(`${name(e.p)} redeployed`); break;
      case 'announce': if ((e.squad === undefined || e.squad === me.squad) && !e.text.startsWith('__')) this.showNote(e.text); break;
      case 'contract': if (this.sim.players[e.p].squad === me.squad) this.showBanner(`${e.kind} contract`, e.msg === 'start' ? 'Contract accepted' : e.msg === 'done' ? 'Contract complete' : e.msg === 'fail' ? 'Contract failed' : 'Next target marked'); break;
      case 'uav': if (e.squad === me.squad) this.showNote('UAV online'); break;
      case 'buy': if (e.p === this.localId) this.showNote(`Purchased: ${e.item}`); break;
      case 'pickup': if (e.p === this.localId) this.showNote(e.label); break;
      case 'squadwipe': if (e.squad !== me.squad) this.feedLine(`Squad eliminated`); break;
      case 'flash': if (e.p === this.localId) this.flash.style.opacity = String(Math.min(1, 0.6 + e.s)); break;
    }
  }
  feedLine(html: string) { const d = el('div', '', html); this.feed.prepend(d); while (this.feed.children.length > 6) this.feed.lastChild!.remove(); setTimeout(() => d.remove(), 7000); }
  showBanner(a: string, b: string) { if (!a) return; this.banner.innerHTML = `<div class="b1">${a}</div><div class="b2">${b}</div>`; this.bannerT = 3.5; }
  showNote(t: string) { this.note.textContent = t; this.noteT = 2.2; }

  update(dt: number, camYaw: number, camPitch: number, project: (x: number, y: number, z: number) => [number, number, boolean], opts: { ads: number; scope: boolean; optic?: boolean; spectating: Player | null; mapOpen: boolean }) {
    const sim = this.sim, me = sim.players[this.localId], view = opts.spectating ?? me;
    const c = sim.circle;
    // gas bar
    const inGas = sim.inGas(view);
    const total = c.closing ? CIRCLES[Math.min(c.phase, CIRCLES.length - 1)].close : CIRCLES[Math.min(c.phase, CIRCLES.length - 1)].wait;
    this.set('gas', this.gas, c.done ? '<div class="t"><span>Final circle</span></div>' : `<div class="t"><span style="color:${c.closing ? '#f6a243' : '#fff'}">${c.closing ? 'Gas closing' : 'Next circle'}</span><span>${fmtT(c.t)}</span></div><div class="bar"><i style="width:${(100 * c.t) / total}%;background:${c.closing ? '#f6a243' : '#fff'}"></i></div>${inGas ? '<div style="color:#f6c343;margin-top:4px">In the gas!' + (me.hasMask ? ` Mask ${Math.ceil(me.gasMask)}s` : '') + '</div>' : ''}`);
    // compass
    const deg = ((-camYaw * 180) / Math.PI % 360 + 360) % 360;
    this.strip.style.left = `${280 - deg * 4}px`;
    // alive + kills
    this.set('alive', this.alive, `<div>${sim.aliveCount}<small>ALIVE</small></div><div>${sim.squadsLeft()}<small>SQUADS</small></div><div>${me.kills}<small>KILLS</small></div>`);
    // squad
    let sq = '';
    for (const p of sim.players) if (p.squad === me.squad && p.id !== me.id) {
      const st = p.phase === Phase.Downed ? 'down' : !p.alive ? 'dead' : '';
      const ph = p.phase === Phase.GulagWait || p.phase === Phase.Gulag ? ' (Gulag)' : p.phase === Phase.Dead ? ' (Dead)' : p.phase === Phase.Downed ? ' (Down)' : '';
      sq += `<div class="m ${st}"><div class="nm">${p.name}${ph}</div><div class="bars"><div class="ar">${[0, 1, 2].map((i) => `<i class="${p.armor > i * 50 ? 'on' : ''}"></i>`).join('')}</div><div class="hp"><i style="width:${Math.max(0, p.health)}%"></i></div></div></div>`;
    }
    this.set('squad', this.squad, sq);
    // self
    const ar = [0, 1, 2].map((i) => `<i><b style="transform:scaleX(${Math.max(0, Math.min(1, (view.armor - i * 50) / 50))})"></b></i>`).join('');
    this.set('self', this.self, `<div class="nm">${view.name}${view.id !== me.id ? ' (spectating)' : ''}</div><div class="ar">${ar}</div><div class="hp"><i style="width:${Math.max(0, view.health)}%;background:${view.health < 40 ? '#e84a3a' : '#fff'}"></i></div>`);
    // weapon
    const w = view.weapons[view.cur];
    if (w && view.phase !== Phase.Freefall && view.phase !== Phase.Chute && view.phase !== Phase.Plane) {
      const d = WEAPON[w.id];
      const other = view.weapons[view.cur === 0 ? 1 : 0];
      this.set('weap', this.weap, `<div class="name" style="color:${RARITY_COLORS[w.rarity]}">${d.name}</div><div class="ammo ${w.mag <= d.mag * 0.25 ? 'low' : ''}">${w.mag}<small> / ${view.ammo[d.ammo]}</small></div>` +
        `<div class="eq"><span>${other ? WEAPON[other.id].name : '—'}</span><span>[G] ${view.lethal ? LETHAL_NAMES[view.lethal.type] + ' x' + view.lethal.n : '—'}</span><span>[Q] ${view.tactical ? TACTICAL_NAMES[view.tactical.type] + ' x' + view.tactical.n : '—'}</span></div>` +
        `<div class="eq"><span>[4] Plates ${view.plates}/${view.maxPlates}</span>${view.killstreak ? `<span>[5] ${KILLSTREAK_NAMES[view.killstreak]}</span>` : ''}${view.selfRevive ? '<span>Self-Revive</span>' : ''}${view.hasMask ? '<span>Gas Mask</span>' : ''}</div><div class="cash">$${view.cash.toLocaleString()}</div>`);
    } else this.set('weap', this.weap, `<div class="cash">$${view.cash.toLocaleString()}</div><div class="eq"><span>Plates ${view.plates}/${view.maxPlates}</span></div>`);
    // crosshair (hidden while aiming)
    const spread = w ? (WEAPON[w.id].spreadHip * (1 - opts.ads) * 900 + 8 + Math.hypot(view.vx, view.vz) * 2 + view.bloom * 6) : 10;
    const showXh = opts.ads < 0.5 && (view.phase === Phase.Alive || view.phase === Phase.Gulag);
    this.xh.style.display = showXh ? '' : 'none';
    if (showXh) {
      const xs = this.xh.children as HTMLCollectionOf<HTMLElement>;
      const s = Math.min(90, spread);
      const set2 = (e: HTMLElement, l: number, t: number, wd: number, h: number) => { e.style.left = `${l}px`; e.style.top = `${t}px`; e.style.width = `${wd}px`; e.style.height = `${h}px`; };
      set2(xs[0], -s - 9, -1, 9, 2); set2(xs[1], s, -1, 9, 2); set2(xs[2], -1, -s - 9, 2, 9); set2(xs[3], -1, s, 2, 9);
    }
    this.hmT -= dt; this.hm.style.opacity = this.hmT > 0 ? '1' : '0';
    // scope overlay
    this.scope.style.display = opts.scope && opts.ads > 0.92 ? 'block' : 'none';
    this.dot.style.display = (opts.optic || opts.scope) && opts.ads > 0.85 ? 'block' : 'none';
    // vignettes: downed / low health / gas
    let vig = '';
    if (view.phase === Phase.Downed) vig = 'radial-gradient(circle, transparent 30%, rgba(120,0,0,0.65))';
    else if (inGas) vig = `radial-gradient(circle, rgba(200,140,20,0.18) 20%, rgba(210,120,10,0.55))`;
    else if (view.health < 60 && view.alive) vig = `radial-gradient(circle, transparent 45%, rgba(140,0,0,${0.5 * (1 - view.health / 60)}))`;
    if (this.last.vig !== vig) { this.last.vig = vig; this.vig.style.background = vig; }
    const fo = parseFloat(this.flash.style.opacity || '0'); if (fo > 0) this.flash.style.opacity = String(Math.max(0, fo - dt * (view.flashT > 0 ? 0.25 : 1.5)));
    // damage arcs
    for (const d of this.dmgArcs) { d.t -= dt; d.e.style.opacity = String(Math.min(1, d.t)); d.e.style.transform = `rotate(${((Math.PI - d.a + camYaw) * 180) / Math.PI}deg)`; if (d.t <= 0) d.e.remove(); }
    this.dmgArcs = this.dmgArcs.filter((d) => d.t > 0);
    // prompt / progress
    let promptTxt = '', progV = -1;
    if (view === me && me.phase === Phase.Alive) {
      const t = sim.interactTarget(me);
      if (t) promptTxt = `<kbd>F</kbd>${t.kind === 'revive' ? 'Hold to ' : ''}${t.label}`;
      const rv = sim.players.find((q) => q.reviveBy === me.id);
      if (rv) progV = rv.reviveT / 5;
      if (me.plateT > 0) progV = 1 - me.plateT / 1.25;
    }
    const veh = vehicleOf(sim, me);
    if (veh) { promptTxt = `${VEHICLES[veh.type].name} ${Math.round(veh.speed * 3.6)} km/h — <kbd>F</kbd>Exit${veh.type === 'heli' ? ' • SPACE up • CTRL down' : ' • SPACE brake'}`; progV = veh.health / VEHICLES[veh.type].health; }
    if (me.phase === Phase.Plane) promptTxt = sim.plane.canJump ? '<kbd>SPACE</kbd>Jump' : 'Waiting for the jump light...';
    if (me.phase === Phase.Freefall) promptTxt = `<kbd>SPACE</kbd>Deploy parachute &nbsp; ${Math.round(me.y - sim.world.hf.at(me.x, me.z))}m`;
    if (me.phase === Phase.Chute) promptTxt = `<kbd>SPACE</kbd>Cut parachute &nbsp; ${Math.round(me.y - sim.world.hf.at(me.x, me.z))}m`;
    if (me.phase === Phase.Downed) { promptTxt = me.selfRevive ? '<kbd>F</kbd>Use Self-Revive' : `Bleeding out ${Math.ceil(me.downT)}s — wait for a teammate`; if (me.reviveBy >= 0) progV = me.reviveT / 5; }
    if (me.phase === Phase.GulagWait) promptTxt = '<kbd>Q</kbd>Throw rock — waiting for your Gulag match';
    this.set('prompt', this.prompt, promptTxt);
    this.prompt.style.display = promptTxt ? 'block' : 'none';
    this.prog.style.display = progV >= 0 ? 'block' : 'none';
    if (progV >= 0) (this.prog.firstChild as HTMLElement).style.width = `${Math.min(100, progV * 100)}%`;
    // banners
    this.bannerT -= dt; this.banner.style.opacity = String(Math.max(0, Math.min(1, this.bannerT)));
    this.noteT -= dt; this.note.style.opacity = String(Math.max(0, Math.min(1, this.noteT * 2)));
    // world markers: squadmates, pings, contract targets
    let mk = '';
    const addMk = (x: number, y: number, z: number, cls: string, txt: string) => { const [sx, sy, vis] = project(x, y, z); if (vis) mk += `<div class="dist ${cls}" style="left:${sx}px;top:${sy}px">${txt}</div>`; };
    for (const p of sim.players) if (p.squad === me.squad && p.id !== view.id && p.alive && p.phase !== Phase.GulagWait && p.phase !== Phase.Gulag && p.phase !== Phase.Plane && view.phase !== Phase.Plane) addMk(p.x, p.y + 2.1, p.z, 'sq', `▼ ${p.name}${p.phase === Phase.Downed ? ' (DOWN)' : ''} ${Math.round(Math.hypot(p.x - view.x, p.z - view.z))}m`);
    for (const pg of this.pings) addMk(pg.x, sim.world.hf.at(pg.x, pg.z) + 2, pg.z, 'mk', `◆ ${Math.round(Math.hypot(pg.x - view.x, pg.z - view.z))}m`);
    const ac = sim.active.find((a) => a.squad === me.squad);
    if (ac?.kind === 'recon') addMk(ac.zx!, ac.zy! + 3, ac.zz!, 'mk', `RECON ${Math.round(Math.hypot(ac.zx! - view.x, ac.zz! - view.z))}m`);
    if (ac?.kind === 'scavenger') { const ch = sim.chests.find((q) => q.id === ac.chest); if (ch) addMk(ch.x, ch.y + 2, ch.z, 'mk', `SUPPLY ${Math.round(Math.hypot(ch.x - view.x, ch.z - view.z))}m`); }
    for (const cr of sim.crates) if (cr.squad === me.squad) addMk(cr.x, cr.y + 2, cr.z, 'mk', `LOADOUT ${Math.round(Math.hypot(cr.x - view.x, cr.z - view.z))}m`);
    this.set('mk', this.markers, mk);
    // minimap
    this.drawMinimap(view, camYaw);
    if (opts.mapOpen) this.drawFullMap(view);
    this.fullmap.style.display = opts.mapOpen ? 'flex' : 'none';
    void camPitch; void eyeHeight;
  }

  private drawMinimap(me: Player, yaw: number) {
    const g = this.mmCtx, W = 232, sim = this.sim;
    const scale = me.phase === Phase.Plane || me.phase === Phase.Freefall || me.phase === Phase.Chute ? 0.22 : 0.9; // px per metre
    const T = this.tac, k = T.width / MAP_SIZE;
    g.save();
    g.fillStyle = '#1a1c1d'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2); g.rotate(yaw); g.scale(scale, scale); g.translate(-me.x, -me.z);
    g.drawImage(T, 0, 0, T.width, T.height, 0, 0, T.width / k, T.height / k);
    this.drawOverlays(g, me, 1 / scale);
    g.restore();
    // player arrow (always up)
    g.fillStyle = '#f6c343'; g.beginPath(); g.moveTo(W / 2, W / 2 - 8); g.lineTo(W / 2 + 6, W / 2 + 6); g.lineTo(W / 2, W / 2 + 3); g.lineTo(W / 2 - 6, W / 2 + 6); g.closePath(); g.fill();
    void sim;
  }

  /** Circles, squad, UAV, plane path, markers — in world coordinates on a transformed context. */
  private drawOverlays(g: CanvasRenderingContext2D, me: Player, px: number) {
    const sim = this.sim, c = sim.circle;
    // gas outside the current circle
    g.save();
    g.beginPath(); g.rect(-2000, -2000, MAP_SIZE + 4000, MAP_SIZE + 4000); g.arc(c.cx, c.cz, Math.max(0, c.r), 0, Math.PI * 2, true);
    g.fillStyle = 'rgba(230,120,30,0.35)'; g.fill('evenodd');
    g.restore();
    g.lineWidth = 2 * px; g.strokeStyle = '#f39a3a'; g.beginPath(); g.arc(c.cx, c.cz, Math.max(0, c.r), 0, Math.PI * 2); g.stroke();
    if (!c.done) { g.strokeStyle = '#ffffff'; g.lineWidth = 2 * px; g.beginPath(); g.arc(c.nx, c.nz, c.nr, 0, Math.PI * 2); g.stroke(); }
    if (sim.plane.active) {
      g.setLineDash([12 * px, 8 * px]); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2 * px;
      const pl = sim.plane; g.beginPath(); g.moveTo(pl.sx, pl.sz); g.lineTo(pl.sx + pl.dx * pl.dur * 62, pl.sz + pl.dz * pl.dur * 62); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(pl.x, pl.z, 6 * px, 0, Math.PI * 2); g.fill();
    }
    // UAV: enemies within range
    const uav = sim.squadUav.get(me.squad);
    if (uav && uav.until > sim.time) {
      g.fillStyle = '#ff3a2a';
      for (const p of sim.players) if (p.alive && p.squad !== me.squad && p.phase === Phase.Alive && Math.hypot(p.x - uav.x, p.z - uav.z) < 450) { g.beginPath(); g.arc(p.x, p.z, 4 * px, 0, Math.PI * 2); g.fill(); }
    }
    // shooters without suppressors show on the minimap briefly (red dots)
    g.fillStyle = 'rgba(255,60,40,0.9)';
    for (const p of sim.players) if (p.alive && p.squad !== me.squad && sim.time - p.lastShot < 1.2 && Math.hypot(p.x - me.x, p.z - me.z) < 160) { g.beginPath(); g.arc(p.x, p.z, 3.5 * px, 0, Math.PI * 2); g.fill(); }
    // bounty target
    const ac = sim.active.find((a) => a.squad === me.squad);
    if (ac?.kind === 'bounty') { const t = sim.players[ac.target!]; g.strokeStyle = '#ff4a3a'; g.lineWidth = 2 * px; g.beginPath(); g.arc(t.x + Math.sin(sim.time * 0.3) * 40, t.z + Math.cos(sim.time * 0.3) * 40, 90, 0, Math.PI * 2); g.stroke(); }
    if (ac?.kind === 'recon') { g.fillStyle = '#f6c343'; g.fillRect(ac.zx! - 6 * px, ac.zz! - 6 * px, 12 * px, 12 * px); }
    // contracts & buy stations icons
    for (const b of sim.buyStations) { g.fillStyle = '#3ad060'; g.fillRect(b.x - 4 * px, b.z - 4 * px, 8 * px, 8 * px); }
    for (const k of sim.contracts) if (!k.taken) { g.fillStyle = k.kind === 'bounty' ? '#ff6a4a' : k.kind === 'recon' ? '#f6c343' : '#6ab0ff'; g.beginPath(); g.arc(k.x, k.z, 3.5 * px, 0, Math.PI * 2); g.fill(); }
    // squad
    for (const p of sim.players) if (p.squad === me.squad && p.alive && p.id !== me.id && p.phase !== Phase.GulagWait && p.phase !== Phase.Gulag) {
      g.fillStyle = p.phase === Phase.Downed ? '#ff4a3a' : '#5aa8ff';
      g.save(); g.translate(p.x, p.z); g.rotate(-p.yaw); g.beginPath(); g.moveTo(0, -8 * px); g.lineTo(6 * px, 6 * px); g.lineTo(-6 * px, 6 * px); g.closePath(); g.fill(); g.restore();
    }
    for (const pg of this.pings) { g.strokeStyle = '#f6c343'; g.lineWidth = 2 * px; g.beginPath(); g.moveTo(pg.x, pg.z - 8 * px); g.lineTo(pg.x + 8 * px, pg.z); g.lineTo(pg.x, pg.z + 8 * px); g.lineTo(pg.x - 8 * px, pg.z); g.closePath(); g.stroke(); }
  }

  private drawFullMap(me: Player) {
    const g = this.fmCanvas.getContext('2d')!, W = this.fmCanvas.width, s = W / MAP_SIZE;
    g.drawImage(this.tac, 0, 0, W, W);
    g.save(); g.scale(s, s);
    this.drawOverlays(g, me, 1 / s);
    g.fillStyle = '#f6c343'; g.save(); g.translate(me.x, me.z); g.rotate(-me.yaw); g.beginPath(); g.moveTo(0, -14 / s); g.lineTo(10 / s, 10 / s); g.lineTo(-10 / s, 10 / s); g.closePath(); g.fill(); g.restore();
    g.restore();
    // grid A-J / 0-9 like the in-game tac map (one cell = 375 m)
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = 'bold 14px sans-serif';
    // grid registered to the 2020 tac map: column B starts at x=85 m, row 1 at z=118 m, cells 381 m
    const cell = 381 * s, ox = (85 - 381) * s, oz = (118 - 381) * s;
    for (let i = 0; i < 11; i++) {
      const x = ox + i * cell, z = oz + i * cell;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, W); g.stroke(); g.beginPath(); g.moveTo(0, z); g.lineTo(W, z); g.stroke();
      if (i < 10) { g.fillText('ABCDEFGHIJ'[i], x + cell / 2 - 5, 16); g.fillText(String(i), 4, z + cell / 2 + 5); }
    }
    g.font = 'bold 15px sans-serif'; g.textAlign = 'center';
    for (const p of POIS) if (p.tier === 'major') { g.fillStyle = 'rgba(0,0,0,0.55)'; const tw = g.measureText(p.name).width; g.fillRect(p.x * s - tw / 2 - 5, p.z * s - 12, tw + 10, 20); g.fillStyle = '#fff'; g.fillText(p.name, p.x * s, p.z * s + 3); }
    g.textAlign = 'left';
  }

  // ---------------------------------------------------------------- menus
  openBuy(onBuy: (item: keyof typeof PRICES, arg?: number) => string | null, onClose: () => void) {
    this.closePanel();
    const me = this.sim.players[this.localId];
    const p = el('div', 'panel');
    const items: [keyof typeof PRICES, string][] = [['plates', 'Armor Plates (refill)'], ['selfRevive', 'Self-Revive Kit'], ['gasMask', 'Gas Mask'], ['uav', 'UAV'], ['cluster', 'Cluster Strike'], ['airstrike', 'Precision Airstrike'], ['munitions', 'Munitions Box (refill ammo)'], ['loadout', 'Loadout Drop']];
    const render = (err = '') => {
      const dead = this.sim.players.filter((q) => q.squad === me.squad && q.id !== me.id && q.phase === Phase.Dead);
      p.innerHTML = `<h3>Buy Station</h3><div class="cash">$${me.cash.toLocaleString()}</div><div class="grid">${items.map(([k, n]) => `<div class="it ${me.cash < PRICES[k] ? 'no' : ''}" data-k="${k}">${n}<em>$${PRICES[k].toLocaleString()}</em></div>`).join('')}${dead.map((q) => `<div class="it ${me.cash < PRICES.buyback ? 'no' : ''}" data-k="buyback" data-a="${q.id}">Buyback ${q.name}<em>$${PRICES.buyback.toLocaleString()}</em></div>`).join('')}</div><div class="err">${err}</div><div class="close">Esc / F to close</div>`;
      p.querySelectorAll('.it').forEach((n) => n.addEventListener('click', () => { const k = (n as HTMLElement).dataset.k as keyof typeof PRICES; const a = (n as HTMLElement).dataset.a; const e = onBuy(k, a ? +a : undefined); render(e ?? ''); }));
    };
    render();
    this.panel = p; this.root.appendChild(p);
    (p as any).onClose = onClose;
  }
  openLoadout(onPick: (i: number) => void) {
    this.closePanel();
    const p = el('div', 'panel');
    p.innerHTML = `<h3>Loadout Drop</h3><div class="cash">Choose a custom class (all legendary blueprints)</div><div class="grid">${LOADOUTS.map((l, i) => `<div class="it" data-i="${i}">${l.name}<em>${LETHAL_NAMES[l.lethal]}</em></div>`).join('')}</div>`;
    p.querySelectorAll('.it').forEach((n) => n.addEventListener('click', () => { onPick(+(n as HTMLElement).dataset.i!); this.closePanel(); }));
    this.panel = p; this.root.appendChild(p);
  }
  closePanel() { if (this.panel) { const cb = (this.panel as any).onClose; this.panel.remove(); this.panel = null; cb?.(); } }
}
export { RARITY_NAMES };
