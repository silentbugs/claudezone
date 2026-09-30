/**
 * Synthesised audio modelled on the Modern Warfare / Warzone (2020) sound signatures — every sound is
 * generated into AudioBuffers at startup (no shipped assets) and played through HRTF panners:
 *  - gunshots: saturated transient + crack + low body + bolt/carrier clack; outdoor slapback echoes or
 *    a boxy indoor tail; distant shots arrive late (d/343 s), low-passed, with a long rolling tail
 *  - hitmarkers: dry flesh "tk", bright ceramic armour "tink", the glassy armour-break crunch
 *  - plates: velcro rip → slide → hollow clack → velcro pat; canvas parachute snap; gas coughs
 *  - radio announcer lines via speech synthesis (optional)
 */
import { Sig, noiseSig, rng } from './dsp';

export type SoundName =
  | 'shot_ar' | 'shot_smg' | 'shot_lmg' | 'shot_sniper' | 'shot_marksman' | 'shot_shotgun' | 'shot_pistol' | 'shot_launcher'
  | 'shotIn_ar' | 'shotIn_smg' | 'shotIn_lmg' | 'shotIn_sniper' | 'shotIn_marksman' | 'shotIn_shotgun' | 'shotIn_pistol' | 'shotIn_launcher'
  | 'far_rifle' | 'far_light' | 'far_heavy'
  | 'hit' | 'hitArmor' | 'armorBreak' | 'headshot' | 'kill' | 'down' | 'selfArmorBreak' | 'bodyHit'
  | 'plate' | 'magOut' | 'magIn' | 'bolt' | 'swap' | 'dry' | 'melee' | 'throw' | 'pin'
  | 'step_dirt' | 'step_concrete' | 'step_metal' | 'step_wood' | 'land' | 'jump' | 'slide' | 'gear'
  | 'flareLaunch' | 'reconTick' | 'hbPing' | 'reconThud' | 'reconStab' | 'reconPulse' | 'reconHat' | 'reconPad' | 'vehicleCrash' | 'chestHum' | 'jet' | 'callin' | 'contractStart' | 'contractDone' | 'contractStep' | 'pickup' | 'cash' | 'chute' | 'chuteCut' | 'explosion' | 'explosionFar' | 'whiz' | 'impact' | 'impactMetal' | 'impactWood' | 'impactGlass' | 'impactWater'
  | 'musicInfil' | 'musicVictory' | 'musicDefeat'
  | 'uiOpen' | 'uiHover' | 'uiBuy' | 'uiDeny' | 'downed' | 'cough' | 'heartbeat' | 'breath' | 'doorOpen' | 'doorClose' | 'doorSlam' | 'beep' | 'revive' | 'crate' | 'stinger' | 'flag' | 'rock';

type Loop = 'engine' | 'wind' | 'gas' | 'chute' | 'vehicle' | 'heli' | 'tinnitus';

/** Audible radius (m) of an unsuppressed shot per weapon class. */
const GUN_RANGE: Record<string, number> = { pistol: 150, smg: 200, shotgun: 220, ar: 300, lmg: 330, marksman: 380, sniper: 550, launcher: 400 };

/** Recon capture music bar length (s). */
export const RECON_BAR = 1.3;

export class Audio {
  ctx: AudioContext | null = null;
  private buffers = new Map<SoundName, AudioBuffer[]>();
  private loopBufs = new Map<Loop, AudioBuffer>();
  private master!: GainNode; private sfx!: GainNode; private uiBus!: GainNode; private muffle!: BiquadFilterNode;
  private musicBus!: GainNode; musicVol = 0.6;
  setMusic(v: number) { this.musicVol = v; if (this.musicBus) this.musicBus.gain.value = v; }
  private roomSend!: GainNode; private room!: ConvolverNode;
  private loops = new Map<Loop, { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }>();
  volume = 0.7; sfxVol = 1; uiVol = 0.8; voiceOn = true;
  indoor = false;
  private lx = 0; private ly = 0; private lz = 0;
  private last = new Map<string, number>();

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.12;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.muffle); this.muffle.connect(this.master);
    this.uiBus = ctx.createGain(); this.uiBus.gain.value = this.uiVol; this.uiBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.master);
    this.room = ctx.createConvolver(); this.room.buffer = this.roomIR();
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 0;
    this.sfx.connect(this.roomSend); this.roomSend.connect(this.room); this.room.connect(this.muffle);
    this.generate();
    void this.loadSamples();
  }

  setVolume(v: number, sfx = this.sfxVol, ui = this.uiVol) { this.volume = v; this.sfxVol = sfx; this.uiVol = ui; if (this.master) { this.master.gain.value = v; this.sfx.gain.value = sfx; this.uiBus.gain.value = ui; } }
  /** Indoors: more room reverb. Muffle 0..1 low-passes the world (gas, downed, stun). */
  setEnvironment(indoor: boolean, muffle: number) {
    const ctx = this.ctx; if (!ctx) return;
    this.indoor = indoor;
    const t = ctx.currentTime;
    this.roomSend.gain.setTargetAtTime(indoor ? 0.35 : 0.0, t, 0.2);
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(0.03, muffle), t, 0.15);
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    const ctx = this.ctx; if (!ctx) return;
    this.lx = x; this.ly = y; this.lz = z;
    const L = ctx.listener, t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { (L as any).setPosition(x, y, z); (L as any).setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  /** Play a sound; positioned sounds are HRTF-panned, air-absorbed and (optionally) delayed by distance. */
  play(name: SoundName, opts: { x?: number; y?: number; z?: number; vol?: number; rate?: number; range?: number; maxDist?: number; delay?: boolean; ui?: boolean; music?: boolean; throttle?: number; key?: string; /** no random pitch variation (music) */ exact?: boolean } = {}) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const list = this.buffers.get(name); if (!list) return;
    if (opts.throttle) { const k = opts.key ?? name + (opts.x ?? ''); const l = this.last.get(k) ?? 0; if (ctx.currentTime - l < opts.throttle) return; this.last.set(k, ctx.currentTime); }
    const buf = list[(Math.random() * list.length) | 0];
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (opts.exact ? 1 : 0.97 + Math.random() * 0.06);
    const g = ctx.createGain(); g.gain.value = opts.vol ?? 1;
    src.connect(g);
    let when = ctx.currentTime;
    if (opts.x !== undefined) {
      const dx = opts.x - this.lx, dy = (opts.y ?? 0) - this.ly, dz = opts.z! - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = opts.range ?? 60;
      // maxDist: hard audible radius with a linear fade to silence (gunshots); otherwise the old soft inverse falloff
      if (d > (opts.maxDist ?? range * 4)) return;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(350, 20000 / (1 + d / (range * 0.5)));
      const p = ctx.createPanner(); p.panningModel = d < 60 ? 'HRTF' : 'equalpower';
      if (opts.maxDist) { p.distanceModel = 'linear'; p.refDistance = Math.min(8, opts.maxDist * 0.1); p.maxDistance = opts.maxDist; p.rolloffFactor = 1; }
      else { p.distanceModel = 'inverse'; p.refDistance = range * 0.12; p.rolloffFactor = 1.15; p.maxDistance = range * 4; }
      p.positionX.value = opts.x; p.positionY.value = opts.y ?? 0; p.positionZ.value = opts.z!;
      g.connect(lp); lp.connect(p); p.connect(this.sfx);
      if (opts.delay) when += d / 343;
    } else g.connect(opts.music ? this.musicBus : opts.ui ? this.uiBus : this.sfx);
    src.start(when);
  }

  /** Gunshot: close or distant layers depending on distance; local shots are dry and full. */
  /**
   * Gunshot with Warzone-like audible radii: a sharp close layer out to ~40% of the class range and a
   * low distant "crack/boom" tail out to the full range, fading linearly to silence. Suppressed guns
   * only carry ~40 m and have no tail. Distant tails are rate-limited per shooter and capped globally,
   * so a busy lobby doesn't turn into constant far-off gunfire.
   */
  private farVoices: number[] = [];
  gunshot(cls: string, pos: { x: number; y: number; z: number } | null, vol = 1, suppressed = false, shooter = -1) {
    const c = cls === 'tactical' ? 'ar' : cls === 'melee' ? 'pistol' : cls;
    const close = (this.indoor ? 'shotIn_' : 'shot_') + c as SoundName;
    if (!pos) { this.play(close, { vol: (suppressed ? 0.55 : 0.85) * vol, rate: suppressed ? 1.15 : 1 }); return; }
    const d = Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz);
    if (suppressed) { if (d < 40) this.play(close, { ...pos, maxDist: 40, vol: 0.55 * vol, rate: 1.15, delay: true }); return; }
    const range = GUN_RANGE[c] ?? 300, near = Math.min(120, range * 0.4);
    if (d < near) this.play(close, { ...pos, maxDist: near, vol: 1.1 * vol, delay: true });
    if (d > near * 0.6 && d < range) {
      const now = this.ctx?.currentTime ?? 0;
      this.farVoices = this.farVoices.filter((t) => t > now);
      if (this.farVoices.length >= 6) return;
      const tail = c === 'sniper' || c === 'marksman' || c === 'shotgun' || c === 'launcher' ? 'far_heavy' : c === 'smg' || c === 'pistol' ? 'far_light' : 'far_rifle';
      const k = Math.min(1, (d - near * 0.6) / (near * 0.4));
      this.play(tail, { ...pos, maxDist: range, vol: k * vol, delay: true, throttle: 0.11, key: 'far' + shooter });
      this.farVoices.push(now + d / 343 + 0.6);
    }
  }

  /** Radio-style announcer line (speech synthesis; British voice when available). */
  say(text: string) {
    if (!this.voiceOn || typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find((x) => /en-GB/i.test(x.lang) && /male|daniel|george|arthur/i.test(x.name)) ?? speechSynthesis.getVoices().find((x) => /en-GB/i.test(x.lang));
      if (v) u.voice = v;
      u.rate = 1.08; u.pitch = 0.75; u.volume = Math.min(1, this.volume * this.uiVol * 1.2);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      this.play('beep', { ui: true, vol: 0.35, rate: 1.4 });
    } catch { /* not supported */ }
  }

  /**
   * Recorded samples (public/sfx, CC0) replace the synthesized versions where available. Each file is
   * trimmed (manifest hints + automatic leading-silence trim), peak-normalised and faded out.
   */
  samplesLoaded = 0;
  async loadSamples(base = 'sfx/') {
    const ctx = this.ctx; if (!ctx) return;
    let man: Record<string, { file: string; trimStart?: number; trimEnd?: number; gain?: number }>;
    try { const r = await fetch(base + 'manifest.json'); if (!r.ok) return; man = await r.json(); } catch { return; }
    const decoded = new Map<string, AudioBuffer>();
    await Promise.all(Object.entries(man).map(async ([key, m]) => {
      try { const r = await fetch(base + m.file); if (!r.ok) return; const b = await ctx.decodeAudioData(await r.arrayBuffer()); decoded.set(key, this.prep(b, m.trimStart, m.trimEnd, key.endsWith('_loop'))); } catch { /* skip unreadable file */ }
    }));
    const group = (prefix: string) => [...decoded.entries()].filter(([k]) => (k === prefix || k.startsWith(prefix + '_')) && !k.includes('burst') && !k.endsWith('_loop_2')).map(([, b]) => b);
    const set = (name: SoundName, bufs: AudioBuffer[]) => { if (bufs.length) { this.buffers.set(name, bufs); this.samplesLoaded++; } };
    for (const cls of ['ar', 'smg', 'pistol', 'sniper', 'shotgun', 'lmg', 'launcher']) {
      let b = group('shot_' + cls);
      if (!b.length && cls === 'lmg') b = group('shot_ar');
      if (!b.length && cls === 'smg') b = group('shot_pistol');
      set(('shot_' + cls) as SoundName, b); set(('shotIn_' + cls) as SoundName, b);
    }
    set('shot_marksman', group('shot_sniper')); set('shotIn_marksman', group('shot_sniper'));
    const far = group('far');
    set('far_rifle', far); set('far_light', far); set('far_heavy', far.length ? far : group('explosionFar'));
    const direct: [SoundName, string][] = [['explosion', 'explosion'], ['explosionFar', 'explosionFar'], ['impact', 'impact'], ['impactMetal', 'impactMetal'], ['impactWood', 'impactWood'], ['impactGlass', 'impactGlass'], ['impactWater', 'impactWater'], ['whiz', 'whiz'], ['magOut', 'magOut'], ['magIn', 'magIn'], ['bolt', 'bolt'], ['swap', 'swap'], ['dry', 'dry'], ['step_dirt', 'step_dirt'], ['step_concrete', 'step_concrete'], ['step_metal', 'step_metal'], ['step_wood', 'step_wood'], ['land', 'land'], ['chute', 'chute'], ['cough', 'cough'], ['uiBuy', 'uiBuy'], ['crate', 'crate'], ['hitArmor', 'armorTink'], ['armorBreak', 'armorBreak'], ['selfArmorBreak', 'armorBreak'], ['gear', 'cloth'], ['uiHover', 'uiClick'], ['heartbeat', 'heartbeat']];
    for (const [n, k] of direct) set(n, group(k).filter((b) => !(n === 'explosion' && b.duration < 0.6)));
    // plate insert: recorded velcro + clack laid out like the real sequence
    const vel = group('velcro')[0], clack = group('plateClack')[0];
    if (vel || clack) {
      const len = 1.25, out = ctx.createBuffer(1, Math.floor(len * ctx.sampleRate), ctx.sampleRate), d = out.getChannelData(0);
      const put = (b: AudioBuffer | undefined, at: number, g: number, maxLen = 1) => { if (!b) return; const s = b.getChannelData(0), o = Math.floor(at * ctx.sampleRate); for (let i = 0; i < s.length && i < maxLen * ctx.sampleRate && o + i < d.length; i++) d[o + i] += s[i] * g; };
      put(vel, 0, 0.8, 0.3); put(clack, 0.66, 1); put(vel, 0.92, 0.45, 0.14);
      this.buffers.set('plate', [out]); this.samplesLoaded++;
    }
    for (const [loop, k] of [['wind', 'wind_loop'], ['engine', 'engine_loop'], ['heli', 'heli_loop'], ['vehicle', 'vehicle_loop'], ['gas', 'gas_loop']] as [Loop, string][]) {
      const b = decoded.get(k); if (b) { this.loopBufs.set(loop, b); this.samplesLoaded++; const l = this.loops.get(loop); if (l) { l.src.stop(); this.loops.delete(loop); } }
    }
  }
  /** Trim, drop leading silence, normalise, fade the tail. Loops get crossfaded ends. */
  private prep(b: AudioBuffer, t0 = 0, t1?: number, loop = false): AudioBuffer {
    const ctx = this.ctx!, sr = b.sampleRate;
    let s = Math.floor(t0 * sr), e = Math.min(b.length, t1 !== undefined ? Math.floor(t1 * sr) : b.length);
    const mono = new Float32Array(b.length);
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < b.length; i++) mono[i] += d[i] / b.numberOfChannels; }
    let peak = 0; for (let i = s; i < e; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (!loop) { const th = peak * 0.05; while (s < e && Math.abs(mono[s]) < th) s++; s = Math.max(0, s - Math.floor(0.002 * sr)); }
    const n = Math.max(1, e - s), out = ctx.createBuffer(loop ? 2 : 1, n, sr);
    for (let c = 0; c < out.numberOfChannels; c++) {
      const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1)), d = out.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (loop ? src[s + i] : mono[s + i]) / Math.max(1e-4, peak) * 0.95;
      const f = Math.min(n, Math.floor((loop ? 0.1 * n : 0.03 * sr)));
      if (loop) for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
      else for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
    }
    return out;
  }

  loop(key: Loop, vol: number, rate = 1, cutoff = 20000) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    let l = this.loops.get(key);
    if (!l) {
      if (vol <= 0.001) return;
      const src = ctx.createBufferSource(); src.buffer = this.loopBufs.get(key)!;
      src.loop = true; src.loopStart = 0; src.loopEnd = src.buffer.duration * 0.9;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter); filter.connect(gain); gain.connect(key === 'tinnitus' ? this.master : this.sfx); src.start();
      l = { src, gain, filter }; this.loops.set(key, l);
    }
    const t = ctx.currentTime;
    l.gain.gain.setTargetAtTime(vol, t, 0.15);
    l.src.playbackRate.setTargetAtTime(rate, t, 0.2);
    l.filter.frequency.setTargetAtTime(cutoff, t, 0.2);
  }
  stopLoops() { for (const k of this.loops.keys()) this.loop(k, 0); }

  // ================================================================ synthesis
  private toBuf(s: Sig, stereo = false): AudioBuffer {
    const b = this.ctx!.createBuffer(stereo ? 2 : 1, s.len, s.sr);
    b.getChannelData(0).set(s.d);
    if (stereo) { const r = b.getChannelData(1), d = s.d, off = Math.floor(s.sr * 0.011); for (let i = 0; i < s.len; i++) r[i] = d[(i + off) % s.len]; }
    return b;
  }
  private add(name: SoundName, ...s: Sig[]) { this.buffers.set(name, s.map((x) => this.toBuf(x.edges().normalize()))); }

  private roomIR(): AudioBuffer {
    const sr = this.ctx!.sampleRate, s = noiseSig(0.6, sr, 99);
    s.env((t) => Math.exp(-t * 11) * (t < 0.004 ? 0 : 1));
    // early reflections
    for (const [dt, g] of [[0.007, 0.8], [0.013, 0.6], [0.021, 0.5], [0.029, 0.35]]) s.d[Math.floor(dt * sr)] += g * 6;
    s.filter('lp', 5000).filter('hp', 180);
    const b = this.ctx!.createBuffer(2, s.len, sr); b.getChannelData(0).set(s.d);
    const r2 = noiseSig(0.6, sr, 98).env((t) => Math.exp(-t * 11)).filter('lp', 5000); b.getChannelData(1).set(r2.d);
    return b;
  }

  /** Weapon report. body: low-end weight, crack: 2-5 kHz snap, pitch: 1 = rifle, mech: bolt clack level. */
  private shot(seed: number, o: { body: number; crack: number; pitch: number; mech: number; tail: number; indoor: boolean }): Sig {
    const sr = this.ctx!.sampleRate, len = o.indoor ? 0.7 : 1.1 + o.tail * 0.8;
    const out = Sig.make(len, sr), r = rng(seed);
    // 1) transient: 2 ms of hard-clipped noise
    out.add((t) => (t < 0.0025 ? r() * 3 : 0));
    // 2) crack
    const crack = noiseSig(0.06, sr, seed + 1).filter('bp', 3200 * o.pitch, 0.7).env((t) => Math.exp(-t * 160)).gain(o.crack * 2.4);
    out.mix(crack);
    // 3) body: pitch-dropping thump + low noise
    const f0 = 58 * (0.8 + o.pitch * 0.4);
    let ph = 0;
    const body = Sig.make(0.25, sr).add((t) => { ph += (2 * Math.PI * f0 * (1 + 2.5 * Math.exp(-t * 90))) / sr; return Math.sin(ph) * Math.exp(-t * (26 / o.body)); });
    body.mix(noiseSig(0.25, sr, seed + 2).filter('lp', 420 * o.pitch).env((t) => Math.exp(-t * 22)), 1.6);
    out.mix(body, o.body * 1.8);
    // 4) mechanical clack (carrier/bolt) ~20 ms later
    const mt = 0.018 + (r() * 0.5 + 0.5) * 0.012;
    const mech = Sig.make(0.05, sr).add((t) => (Math.sin(2 * Math.PI * 1850 * t) * 0.5 + Math.sin(2 * Math.PI * 3150 * t) * 0.35 + Math.sin(2 * Math.PI * 4720 * t) * 0.25) * Math.exp(-t * 170));
    mech.mix(noiseSig(0.05, sr, seed + 3).filter('hp', 2500).env((t) => Math.exp(-t * 220)), 0.6);
    out.mix(mech, o.mech * 0.5, mt);
    out.sat(2.2);
    if (!o.indoor) {
      // 5) outdoor: diffuse low tail + terrain/building slapbacks
      out.mix(noiseSig(len, sr, seed + 4).filter('lp', 900).env((t) => (1 - Math.exp(-t * 40)) * Math.exp(-t * (3.2 / o.tail))), 0.55 * o.body);
      const slap = Sig.make(0.25, sr).mix(body, 1).mix(crack, 0.25).filter('lp', 1500);
      for (const [dt, g] of [[0.085, 0.42], [0.16, 0.3], [0.27, 0.22], [0.41, 0.15], [0.6, 0.09]]) out.mix(slap, g * (0.8 + r() * 0.4), dt + r() * 0.015);
    } else {
      // indoor: boxy early reflections, short mid tail
      out.mix(noiseSig(len, sr, seed + 5).filter('bp', 700, 0.6).env((t) => Math.exp(-t * 9)), 0.5 * o.body);
      for (const [dt, g] of [[0.006, 0.6], [0.011, 0.45], [0.019, 0.35], [0.031, 0.25]]) out.mix(Sig.make(0.2, sr).mix(body, 1).mix(crack, 0.5), g, dt);
    }
    return out;
  }
  private far(seed: number, weight: number, len: number): Sig {
    const sr = this.ctx!.sampleRate, s = Sig.make(len, sr);
    const boom = noiseSig(len, sr, seed).filter('lp', 380 + weight * 120).env((t) => (1 - Math.exp(-t * 120)) * Math.exp(-t * 7));
    s.mix(boom, 1.4);
    s.mix(noiseSig(0.02, sr, seed + 1).filter('bp', 1400, 0.8).env((t) => Math.exp(-t * 150)), 0.3 * weight);
    // rolling echoes across the valley
    const r = rng(seed + 2);
    for (let k = 0; k < 7; k++) s.mix(Sig.make(0.5, sr).mix(boom, 1).filter('lp', 500), 0.5 * Math.pow(0.72, k), 0.12 + k * (0.16 + r() * 0.08));
    s.mix(noiseSig(len, sr, seed + 3).filter('lp', 260).env((t) => Math.exp(-t * 1.6) * (1 - Math.exp(-t * 20))), 0.6);
    return s;
  }

  private generate() {
    const sr = this.ctx!.sampleRate;
    const N = (sec: number, seed: number) => noiseSig(sec, sr, seed);
    const S = (sec: number) => Sig.make(sec, sr);
    const tone = (sec: number, fn: (t: number) => number) => S(sec).add(fn);
    // ---- weapons (3 variations each; outdoor and indoor)
    const P: Record<string, { body: number; crack: number; pitch: number; mech: number; tail: number }> = {
      ar: { body: 1, crack: 0.9, pitch: 1, mech: 0.9, tail: 1 }, smg: { body: 0.7, crack: 1, pitch: 1.35, mech: 1, tail: 0.7 },
      lmg: { body: 1.2, crack: 0.8, pitch: 0.9, mech: 1.1, tail: 1.1 }, sniper: { body: 1.7, crack: 1.1, pitch: 0.75, mech: 0.6, tail: 2 },
      marksman: { body: 1.35, crack: 1.05, pitch: 0.85, mech: 0.7, tail: 1.5 }, shotgun: { body: 1.6, crack: 0.6, pitch: 0.7, mech: 0.5, tail: 1.4 },
      pistol: { body: 0.6, crack: 1.1, pitch: 1.5, mech: 1.2, tail: 0.6 }, launcher: { body: 1.4, crack: 0.3, pitch: 0.5, mech: 0.2, tail: 1.6 },
    };
    let seed = 100;
    for (const [k, p] of Object.entries(P)) {
      this.add(('shot_' + k) as SoundName, this.shot(seed++, { ...p, indoor: false }), this.shot(seed++, { ...p, indoor: false, pitch: p.pitch * 1.04 }), this.shot(seed++, { ...p, indoor: false, pitch: p.pitch * 0.97 }));
      this.add(('shotIn_' + k) as SoundName, this.shot(seed++, { ...p, indoor: true }), this.shot(seed++, { ...p, indoor: true, pitch: p.pitch * 1.04 }));
    }
    this.add('far_rifle', this.far(300, 1, 2.2), this.far(301, 1, 2.2));
    this.add('far_light', this.far(302, 0.6, 1.6));
    this.add('far_heavy', this.far(303, 1.8, 3.0));
    // ---- hit feedback (attacker side)
    this.add('hit', N(0.05, 1).filter('bp', 1200, 1.2).env((t) => Math.exp(-t * 110)).mix(tone(0.05, (t) => Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 60)), 0.6).mix(tone(0.01, (t) => Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t * 400)), 0.3));
    this.add('hitArmor', tone(0.11, (t) => (Math.sin(2 * Math.PI * 2310 * t) * 0.5 + Math.sin(2 * Math.PI * 3870 * t) * 0.4 + Math.sin(2 * Math.PI * 5230 * t) * 0.3 + Math.sin(2 * Math.PI * 7120 * t) * 0.15) * Math.exp(-t * 48)).mix(N(0.02, 2).filter('hp', 3000).env((t) => Math.exp(-t * 300)), 0.5),
      tone(0.11, (t) => (Math.sin(2 * Math.PI * 2450 * t) * 0.5 + Math.sin(2 * Math.PI * 4010 * t) * 0.4 + Math.sin(2 * Math.PI * 5600 * t) * 0.3) * Math.exp(-t * 52)).mix(N(0.02, 3).filter('hp', 3000).env((t) => Math.exp(-t * 300)), 0.5));
    const crunch = (seed2: number, low: number) => {
      const s = S(0.45);
      const r = rng(seed2);
      for (let k = 0; k < 38; k++) { const at = Math.abs(r()) * 0.22 * Math.abs(r()); s.mix(N(0.02, seed2 + k).filter('bp', 2000 + Math.abs(r()) * 6000, 2).env((t) => Math.exp(-t * (200 + Math.abs(r()) * 300))), 0.9 * (1 - at * 3), at); }
      s.mix(N(0.3, seed2 + 99).filter('bp', 3500, 0.6).env((t) => Math.exp(-t * 14)), 0.5);
      s.mix(tone(0.3, (t) => Math.sin(2 * Math.PI * (90 - t * 60) * t) * Math.exp(-t * 16)), low);
      return s.sat(1.6);
    };
    this.add('armorBreak', crunch(400, 0.8), crunch(460, 0.8));
    this.add('selfArmorBreak', crunch(520, 1.6).filter('lp', 5000));
    this.add('headshot', N(0.08, 4).filter('bp', 900, 1).env((t) => Math.exp(-t * 60)).mix(tone(0.08, (t) => Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t * 45)), 0.9).mix(tone(0.04, (t) => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 120)), 0.4));
    this.add('down', tone(0.25, (t) => Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 20)).mix(N(0.05, 5).filter('bp', 1500).env((t) => Math.exp(-t * 90)), 0.6).mix(tone(0.2, (t) => Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 25)), 0.25));
    this.add('kill', tone(0.35, (t) => Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t * 14)).mix(N(0.06, 6).filter('bp', 1200).env((t) => Math.exp(-t * 70)), 0.7).mix(tone(0.3, (t) => (Math.sin(2 * Math.PI * 880 * t) + Math.sin(2 * Math.PI * 1320 * t) * 0.6) * Math.exp(-t * 12)), 0.35));
    this.add('bodyHit', N(0.14, 7).filter('lp', 700).env((t) => Math.exp(-t * 35)).mix(tone(0.14, (t) => Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 30)), 1));
    // ---- plate insert: velcro rip → slide → hollow clack → velcro pat
    {
      const s = S(1.2), r = rng(700);
      const velcro = (dur: number, sd: number) => N(dur, sd).filter('hp', 1400).env((t) => (0.5 + 0.5 * Math.abs(Math.sin(t * 380 + Math.sin(t * 90) * 3))) * Math.min(1, t * 60) * Math.exp(-t * 2));
      s.mix(velcro(0.26, 701), 0.7, 0.0);
      s.mix(N(0.3, 702).filter('lp', 1800).env((t) => Math.sin(Math.PI * t / 0.3)), 0.35, 0.3);
      const clack = N(0.12, 703).filter('bp', 950, 1.4).env((t) => Math.exp(-t * 45)).mix(tone(0.12, (t) => (Math.sin(2 * Math.PI * 610 * t) + Math.sin(2 * Math.PI * 2230 * t) * 0.5) * Math.exp(-t * 40)), 0.8);
      s.mix(clack, 1.1, 0.68);
      s.mix(velcro(0.12, 704), 0.45, 0.92);
      void r;
      this.add('plate', s);
    }
    // ---- weapon handling
    const clk = (f: number, d: number, sd: number) => tone(d, (t) => (Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 1.73 * t) * 0.3) * Math.exp(-t * (6 / d))).mix(N(d, sd).filter('hp', 1500).env((t) => Math.exp(-t * (10 / d))), 0.6);
    this.add('magOut', clk(900, 0.12, 800).mix(N(0.2, 801).filter('bp', 600).env((t) => Math.exp(-t * 20)), 0.4, 0.03));
    this.add('magIn', clk(1200, 0.1, 802).mix(clk(1800, 0.06, 803), 0.8, 0.05));
    this.add('bolt', clk(1500, 0.08, 804).mix(clk(1100, 0.1, 805), 0.9, 0.12));
    this.add('swap', N(0.3, 806).filter('bp', 1100, 0.7).env((t) => Math.exp(-t * 14)).mix(clk(1400, 0.06, 807), 0.6, 0.18));
    this.add('dry', clk(2200, 0.05, 808));
    this.add('melee', N(0.25, 809).filter('bp', (t) => 700 + t * 3000, 0.8).env((t) => Math.sin(Math.PI * Math.min(1, t / 0.25))).mix(tone(0.12, (t) => Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 30)), 0.8, 0.15));
    this.add('throw', N(0.25, 810).filter('bp', (t) => 1500 - t * 3000, 0.9).env((t) => Math.sin(Math.PI * t / 0.25)));
    this.add('pin', clk(3200, 0.05, 811).mix(clk(2600, 0.08, 812), 0.6, 0.06));
    // ---- footsteps by surface, plus gear rattle
    const step = (sd: number, surf: string) => {
      const s = S(0.2);
      if (surf === 'dirt') s.mix(N(0.15, sd).filter('bp', 1100, 0.6).env((t) => Math.min(1, t * 300) * Math.exp(-t * 28)), 1).mix(N(0.08, sd + 1).filter('lp', 300).env((t) => Math.exp(-t * 60)), 0.8);
      if (surf === 'concrete') s.mix(N(0.06, sd).filter('bp', 2400, 1).env((t) => Math.exp(-t * 90)), 1).mix(tone(0.06, (t) => Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t * 70)), 0.8);
      if (surf === 'metal') s.mix(tone(0.2, (t) => (Math.sin(2 * Math.PI * 820 * t) * 0.5 + Math.sin(2 * Math.PI * 1370 * t) * 0.35 + Math.sin(2 * Math.PI * 2210 * t) * 0.2) * Math.exp(-t * 22)), 1).mix(N(0.03, sd).filter('hp', 2000).env((t) => Math.exp(-t * 150)), 0.5);
      if (surf === 'wood') s.mix(tone(0.12, (t) => Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 40)), 1).mix(N(0.06, sd).filter('bp', 900, 1.2).env((t) => Math.exp(-t * 70)), 0.6);
      s.mix(N(0.06, sd + 7).filter('hp', 4000).env((t) => Math.exp(-t * 60)), 0.25, 0.05); // gear
      return s;
    };
    for (const surf of ['dirt', 'concrete', 'metal', 'wood']) this.add(('step_' + surf) as SoundName, step(900 + surf.length * 10, surf), step(950 + surf.length * 10, surf), step(990 + surf.length * 10, surf), step(1030 + surf.length * 10, surf));
    this.add('gear', N(0.2, 1100).filter('hp', 3000).env((t) => Math.abs(Math.sin(t * 90)) * Math.exp(-t * 14)));
    this.add('land', N(0.3, 1101).filter('lp', 500).env((t) => Math.exp(-t * 18)).mix(tone(0.2, (t) => Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 25)), 1).mix(N(0.2, 1102).filter('hp', 3000).env((t) => Math.abs(Math.sin(t * 70)) * Math.exp(-t * 15)), 0.25));
    this.add('jump', N(0.18, 1103).filter('bp', 900).env((t) => Math.exp(-t * 25)).mix(N(0.15, 1104).filter('hp', 3500).env((t) => Math.abs(Math.sin(t * 80)) * Math.exp(-t * 18)), 0.3));
    this.add('slide', N(0.9, 1105).filter('bp', 1300, 0.5).env((t) => Math.min(1, t * 30) * Math.exp(-t * 2.4)).mix(N(0.9, 1106).filter('lp', 250).env((t) => Math.exp(-t * 3)), 0.6));
    // ---- pickups & economy
    this.add('pickup', N(0.2, 1200).filter('bp', 1600, 0.8).env((t) => Math.exp(-t * 25)).mix(clk(1400, 0.05, 1201), 0.5, 0.05));
    this.add('cash', S(0.35).add((t) => { let v = 0; for (let k = 0; k < 7; k++) { const tt = t - k * 0.035; if (tt > 0) v += (Math.random() * 2 - 1) * Math.exp(-tt * 90); } return v; }).filter('bp', 3000, 0.7).mix(tone(0.3, (t) => Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-t * 16)), 0.25, 0.12));
    this.add('crate', N(0.6, 1202).filter('lp', 900).env((t) => Math.exp(-t * 8)).mix(clk(700, 0.1, 1203), 1).mix(clk(520, 0.12, 1204), 0.8, 0.2).mix(tone(0.6, (t) => (Math.sin(2 * Math.PI * 1175 * t) + Math.sin(2 * Math.PI * 1568 * t) * 0.6) * Math.exp(-t * 6)), 0.2, 0.2));
    // ---- parachute: canvas FWUMP snap; cut = zip
    this.add('chute', N(0.5, 1300).filter('lp', 1200).env((t) => Math.min(1, t * 200) * Math.exp(-t * 11)).mix(tone(0.3, (t) => Math.sin(2 * Math.PI * 85 * t) * Math.exp(-t * 14)), 1.2).mix(N(0.3, 1301).filter('bp', 2200).env((t) => Math.abs(Math.sin(t * 120)) * Math.exp(-t * 12)), 0.3, 0.08));
    this.add('chuteCut', N(0.3, 1302).filter('bp', (t) => 3000 - t * 6000, 0.8).env((t) => Math.sin(Math.PI * t / 0.3)));
    // ---- explosions
    const expl = (sd: number, far: boolean) => {
      const len = far ? 3.5 : 2.6, s = S(len);
      s.mix(N(0.01, sd).filter('lp', 5000), far ? 0 : 3);
      s.mix(tone(1.2, (t) => Math.sin(2 * Math.PI * (48 - t * 20) * t) * Math.exp(-t * 3.5)), 1.6);
      s.mix(N(len, sd + 1).filter('lp', far ? 300 : 900).env((t) => Math.min(1, t * 80) * Math.exp(-t * (far ? 1.4 : 2.2))), 1.8);
      if (!far) { const r = rng(sd + 2); for (let k = 0; k < 40; k++) s.mix(N(0.02, sd + 10 + k).filter('hp', 2000).env((t) => Math.exp(-t * 200)), 0.25, 0.15 + Math.abs(r()) * 1.4); }
      return s.sat(1.8);
    };
    this.add('explosion', expl(1400, false), expl(1450, false));
    this.add('explosionFar', expl(1500, true));
    this.add('whiz', S(0.2).add((t) => Math.sin(2 * Math.PI * (3400 - t * 12000) * t)).mix(N(0.2, 1600).filter('bp', 4500, 2), 0.8).env((t) => Math.sin(Math.PI * t / 0.2) ** 2));
    // ---- impacts
    this.add('impact', N(0.12, 1700).filter('bp', 1800, 0.7).env((t) => Math.exp(-t * 60)).mix(N(0.2, 1701).filter('hp', 3000).env((t) => Math.exp(-t * 20)), 0.2, 0.02));
    this.add('impactMetal', tone(0.35, (t) => (Math.sin(2 * Math.PI * 2310 * t) * 0.6 + Math.sin(2 * Math.PI * 3730 * t) * 0.3 + Math.sin(2 * Math.PI * 1180 * t) * 0.3) * Math.exp(-t * 14)).mix(N(0.02, 1702), 0.6));
    this.add('impactWood', tone(0.12, (t) => Math.sin(2 * Math.PI * 240 * t) * Math.exp(-t * 45)).mix(N(0.08, 1703).filter('bp', 900).env((t) => Math.exp(-t * 60)), 0.9));
    this.add('impactGlass', crunch(1704, 0.1).filter('hp', 2500));
    this.add('impactWater', N(0.4, 1705).filter('bp', (t) => 800 + t * 1500, 0.8).env((t) => Math.min(1, t * 100) * Math.exp(-t * 9)));
    // ---- UI
    this.add('uiOpen', tone(0.2, (t) => Math.sin(2 * Math.PI * (t < 0.08 ? 660 : 990) * t) * Math.exp(-((t % 0.08) * 30)) * 0.6));
    this.add('uiHover', tone(0.03, (t) => Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 200)));
    this.add('uiBuy', clk(500, 0.12, 1800).mix(clk(380, 0.14, 1801), 1, 0.07).mix(tone(0.6, (t) => [1318, 1661, 1975].reduce((a, f, k) => a + (t > k * 0.06 ? Math.sin(2 * Math.PI * f * t) * Math.exp(-(t - k * 0.06) * 7) : 0), 0)), 0.5, 0.12));
    this.add('uiDeny', tone(0.25, (t) => Math.sign(Math.sin(2 * Math.PI * 180 * t)) * Math.exp(-t * 12) * 0.4));
    this.add('beep', tone(0.1, (t) => Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 30)));
    this.add('stinger', tone(1.8, (t) => (Math.sin(2 * Math.PI * 73 * t) * 0.7 + Math.sin(2 * Math.PI * 110 * t) * 0.4 + Math.sin(2 * Math.PI * 146.8 * t) * 0.3) * Math.min(1, t * 8) * Math.exp(-t * 1.6)).mix(N(1.8, 1900).filter('lp', 200).env((t) => Math.exp(-t * 2)), 0.8));
    // music cues: a brooding drum/string infil ostinato, a brass-ish victory swell, a low defeat hit
    {
      const drum = (sd: number) => tone(0.5, (t) => Math.sin(2 * Math.PI * (70 - t * 40) * t) * Math.exp(-t * 9)).mix(N(0.3, sd).filter('lp', 400).env((t) => Math.exp(-t * 20)), 0.6);
      const pad = (f: number, len: number) => S(len).add((t) => [1, 2.001, 3.002, 4.003].reduce((s, h, i) => s + Math.sign(Math.sin(2 * Math.PI * f * h * t)) * 0.12 / (i + 1), 0)).filter('lp', 1400).env((t) => Math.min(1, t * 2) * Math.min(1, (len - t) * 1.5));
      const infil = S(8);
      infil.mix(pad(55, 8), 0.8).mix(pad(82.4, 8), 0.5).mix(pad(65.4, 4), 0.4, 4);
      for (let b = 0; b < 16; b++) infil.mix(drum(4000 + b), b % 4 === 3 ? 0.6 : 1, b * 0.5);
      this.add('musicInfil', infil);
      const vic = S(6);
      for (const [f, at] of [[196, 0], [246.9, 0.25], [293.7, 0.5], [392, 1.0]] as [number, number][]) vic.mix(pad(f, 5 - at), 0.7, at);
      for (let b = 0; b < 6; b++) vic.mix(drum(4100 + b), 1, b * 0.25);
      this.add('musicVictory', vic);
      this.add('musicDefeat', pad(49, 3.5).mix(drum(4200), 1.5).mix(pad(58.3, 3.5), 0.6));
    }
    // contract cues: a rising three-note radio chime on accept, a brighter fanfare on completion, a blip per step
    const notes = (fs: number[], gap: number, dec: number) => (t: number) => fs.reduce((a, f, k) => a + (t > k * gap ? (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-(t - k * gap) * dec) : 0), 0) * 0.55;
    // jet flyover: a roar that swells and fades with a falling whine (Doppler-ish)
    // supply box: a soft shimmering hum with a faint chime on top (you can follow it to the box)
    // recon flare: a thump, a rising rocket hiss and the crackling pop of the burn
    this.add('flareLaunch', N(3.2, 9911).filter('bp', 1800, 0.6).env((t) => (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 1.1)) * (t < 2.4 ? 1 : Math.exp(-(t - 2.4) * 6)) * 0.7)
      .mix(tone(0.25, (t) => Math.sin(2 * Math.PI * (90 - t * 120) * t) * Math.exp(-t * 14) * 0.9), 1)
      .mix(N(1.2, 9912).filter('hp', 3000).env((t) => Math.exp(-t * 3) * (0.5 + 0.5 * Math.sin(t * 90))), 0.5, 2.4));
    // recon capture: the repeating data-upload chirp while the zone is being held
    // recon capture: a deep rhythmic thud (a kick-drum like thump: falling low sine + a soft low-passed knock)
    this.add('reconTick', tone(0.5, (t) => { const f = 48 + 70 * Math.exp(-t * 28); return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7.5) * (t < 0.004 ? t / 0.004 : 1) * 0.95; }).mix(N(0.08, 4242).filter('lp', 420).env((t) => Math.exp(-t * 45)), 0.45));
    // recon capture music (2020): a steady, unhurried 1.3 s bar (~92 bpm) at one pitch throughout, in five layers played
    // together - the client fades the upper layers in as the upload progresses, so it starts as a bare thud and builds
    const BAR = RECON_BAR, H = BAR / 2;
    const stab = (t: number, t0: number, f: number, acc: number) => { const u = t - t0; if (u < 0 || u > 0.12) return 0; let v = 0; for (let k = 1; k <= 6; k++) v += Math.sin(2 * Math.PI * f * k * u + k) / k; return v * Math.exp(-u * 32) * Math.min(1, u / 0.003) * acc * 0.3; };
    this.add('reconThud', tone(BAR, (t) => { let v = 0; for (const [t0, a] of [[0, 0.85], [H, 0.7]]) { const u = t - t0; if (u >= 0 && u < 0.5) v += Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-u * 28)) * u) * Math.exp(-u * 7.5) * Math.min(1, u / 0.004) * a; } return v; }));
    this.add('reconStab', tone(BAR, (t) => { let v = 0; for (let i = 0; i < 3; i++) { v += stab(t, i * 0.14, 220, i === 0 ? 1 : 0.75); v += stab(t, H + i * 0.14, 220, i === 0 ? 1 : 0.75); } return v; }));
    this.add('reconPulse', tone(BAR, (t) => { const u = t % (BAR / 8); let v = 0; for (let k = 1; k <= 5; k++) v += Math.sin(2 * Math.PI * 55 * k * t) / k; return v * Math.exp(-u * 18) * Math.min(1, u / 0.004) * 0.3; }));
    this.add('reconHat', N(BAR, 6060).filter('bp', 7500, 1.2).env((t) => { const q = BAR / 16, u = t % q, acc = Math.floor(t / q) % 4 === 2 ? 1 : 0.55; return Math.exp(-u * 80) * acc * 0.9; }));
    this.add('reconPad', tone(BAR, (t) => { const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 9 * t); return (Math.sin(2 * Math.PI * 440 * t) * 0.5 + Math.sin(2 * Math.PI * 466.2 * t) * 0.35 + Math.sin(2 * Math.PI * 659.3 * t) * 0.2) * trem * 0.22 * Math.min(1, t / 0.02, (BAR - t) / 0.02); }));
    // heartbeat sensor contact: a soft electronic blip
    this.add('hbPing', tone(0.25, (t) => (Math.sin(2 * Math.PI * 1480 * t) * 0.6 + Math.sin(2 * Math.PI * 2960 * t) * 0.15) * Math.min(1, t / 0.004) * Math.exp(-t * 22)));
    // vehicle crash: a heavy body thump, crunching sheet metal and a short metallic ring
    const vcrunch = (sd: number) => tone(0.9, (t) => Math.sin(2 * Math.PI * (70 + 60 * Math.exp(-t * 20)) * t) * Math.exp(-t * 9) * 0.9 + (Math.sin(2 * Math.PI * 610 * t) * 0.25 + Math.sin(2 * Math.PI * 1370 * t) * 0.15) * Math.exp(-t * 7))
      .mix(N(0.5, sd).filter('lp', 2600).env((t) => Math.min(1, t * 400) * (Math.exp(-t * 16) + 0.35 * Math.exp(-Math.pow((t - 0.12) / 0.05, 2)))), 0.9)
      .mix(N(0.3, sd + 7).filter('bp', 3400, 2).env((t) => Math.exp(-t * 25) * 0.5), 0.6);
    this.add('vehicleCrash', vcrunch(5101), vcrunch(5202), vcrunch(5303));
    this.add('chestHum', tone(1.4, (t) => { const env = Math.sin(Math.PI * Math.min(1, t / 1.4)); return (Math.sin(2 * Math.PI * 196 * t) * 0.35 + Math.sin(2 * Math.PI * 294 * t + Math.sin(t * 9) * 0.6) * 0.25 + Math.sin(2 * Math.PI * 1175 * t) * 0.08 * Math.exp(-t * 3)) * env * 0.7; }));
    this.add('jet', N(4, 4321).filter('lp', 900).env((t) => Math.exp(-Math.pow((t - 1.6) / 0.7, 2)) * 1.3).mix(tone(4, (t) => Math.sin(2 * Math.PI * (1500 - t * 260) * t) * 0.06 * Math.exp(-Math.pow((t - 1.5) / 0.6, 2))), 1));
    this.add('callin', tone(0.5, (t) => (Math.sin(2 * Math.PI * 1760 * t) * (t < 0.08 ? 1 : 0) + Math.sin(2 * Math.PI * 1320 * t) * (t > 0.12 && t < 0.2 ? 1 : 0)) * 0.3).mix(N(0.3, 77).filter('bp', 2500, 0.5).env((t) => Math.exp(-t * 20) * 0.15), 1));
    this.add('contractStart', tone(0.9, notes([587, 784, 1175], 0.11, 5)));
    this.add('contractDone', tone(1.3, notes([784, 988, 1175, 1568], 0.1, 3.5)));
    this.add('contractStep', tone(0.35, notes([988, 1319], 0.07, 9)));
    this.add('flag', tone(0.5, (t) => Math.sin(2 * Math.PI * (440 + t * 400) * t) * Math.exp(-t * 5)));
    // ---- body / status
    this.add('downed', tone(1.2, (t) => Math.sin(2 * Math.PI * 62 * t) * Math.exp(-t * 2.5)).mix(N(1.2, 2000).filter('lp', 300).env((t) => Math.exp(-t * 3)), 0.5));
    const cough = (sd: number) => { const s = S(0.9); for (let k = 0; k < 3; k++) s.mix(N(0.16, sd + k).filter('bp', 520 + k * 60, 3).mix(N(0.16, sd + 10 + k).filter('bp', 1650, 4), 0.6).env((t) => Math.min(1, t * 120) * Math.exp(-t * 18)), 1 - k * 0.2, k * 0.24); return s; };
    this.add('cough', cough(2100), cough(2200), cough(2300));
    // low health: a thumping heartbeat (replaced by the recording when loaded) and a pained in/out breath
    const beat = (sd: number) => tone(0.35, (t) => Math.sin(2 * Math.PI * 48 * t) * Math.exp(-t * 18)).mix(tone(0.35, (t) => t < 0.16 ? 0 : Math.sin(2 * Math.PI * 44 * (t - 0.16)) * Math.exp(-(t - 0.16) * 20)), 0.7).mix(N(0.35, sd).filter('lp', 120).env((t) => Math.exp(-t * 20)), 0.4);
    this.add('heartbeat', beat(2500));
    // doors: a latch click + hinge creak; closing ends in a thud; a slam is a loud wooden bang
    const creak = (sd: number, f0: number) => tone(0.45, (t) => Math.sin(2 * Math.PI * (f0 + 40 * Math.sin(t * 25)) * t) * 0.25 * Math.sin(Math.min(1, t / 0.45) * Math.PI)).mix(N(0.45, sd).filter('bp', 1800, 4).env((t) => Math.sin(Math.min(1, t / 0.45) * Math.PI) * 0.3), 1);
    const latch = (sd: number) => N(0.05, sd).filter('bp', 3200, 3).env((t) => Math.exp(-t * 90));
    const thud = (sd: number) => tone(0.3, (t) => Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t * 22)).mix(N(0.3, sd).filter('lp', 700).env((t) => Math.exp(-t * 25)), 0.8);
    this.add('doorOpen', latch(2700).mix(creak(2701, 420), 0.8, 0.04), latch(2702).mix(creak(2703, 360), 0.8, 0.04));
    this.add('doorClose', creak(2704, 380).mix(thud(2705), 1, 0.35).mix(latch(2706), 1, 0.38));
    this.add('doorSlam', thud(2707).mix(N(0.25, 2708).filter('bp', 900, 1.2).env((t) => Math.exp(-t * 18)), 1).mix(thud(2709), 0.6, 0.02));
    const breath = (sd: number) => N(1.5, sd).filter('bp', 900, 0.8).mix(N(1.5, sd + 1).filter('bp', 2400, 1.2), 0.35).env((t) => t < 0.55 ? Math.sin((t / 0.55) * Math.PI) * 0.8 : t > 0.7 ? Math.sin(((t - 0.7) / 0.8) * Math.PI) * 0.55 : 0);
    this.add('breath', breath(2600), breath(2610), breath(2620));
    this.add('revive', tone(0.6, (t) => Math.sin(2 * Math.PI * (500 + t * 700) * t) * Math.exp(-t * 5)).mix(N(0.3, 2400).filter('hp', 2500).env((t) => Math.exp(-t * 10)), 0.3));
    this.add('rock', N(0.1, 2500).filter('bp', 1300, 1.2).env((t) => Math.exp(-t * 70)).mix(tone(0.06, (t) => Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 90)), 0.7));
    // ---- loops (edges crossfaded so they loop seamlessly over 90% of their length)
    const loopify = (s: Sig, stereo = true) => { const n = s.len, f = Math.floor(n * 0.1); for (let i = 0; i < f; i++) { const k = i / f; s.d[i] = s.d[i] * k + s.d[n - f + i] * (1 - k); } return this.toBuf(s.normalize(0.8), stereo); };
    { // C-130 turboprop: blade pass ~68 Hz + harmonics beating between engines, ramp wind rush
      const s = S(6); let a = 0, b = 0;
      s.add((t) => { a += (2 * Math.PI * 68) / sr; b += (2 * Math.PI * 68.9) / sr; return (Math.sin(a) + Math.sin(b)) * 0.3 + (Math.sin(2 * a) + Math.sin(2 * b)) * 0.18 + Math.sin(3 * a) * 0.12 + Math.sin(34 * t * 2 * Math.PI) * 0.1; });
      s.mix(N(6, 2600).filter('lp', 700), 0.9).mix(N(6, 2601).filter('bp', 2500, 0.5), 0.15);
      this.loopBufs.set('engine', loopify(s));
    }
    this.loopBufs.set('wind', loopify(N(6, 2700).filter('bp', 700, 0.4).env((t) => 0.7 + 0.3 * Math.sin(t * 2.1) * Math.sin(t * 0.7)).mix(N(6, 2701).filter('lp', 150), 1.4)));
    this.loopBufs.set('chute', loopify(N(4, 2800).filter('bp', 400, 0.7).env((t) => 0.6 + 0.4 * Math.abs(Math.sin(t * 7 + Math.sin(t * 2))))));
    this.loopBufs.set('gas', loopify(N(6, 2900).filter('lp', 250).mix(S(6).add((t) => Math.sin(2 * Math.PI * 45 * t) * 0.15))));
    this.loopBufs.set('tinnitus', loopify(S(4).add((t) => Math.sin(2 * Math.PI * 6800 * t) * 0.25)));
    this.loopBufs.set('vehicle', loopify(S(4).add((t) => { const f = 42; return Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.2 + Math.sin(2 * Math.PI * f * 2 * t) * 0.3; }).filter('lp', 900).mix(N(4, 3000).filter('lp', 500), 0.6)));
    this.loopBufs.set('heli', loopify(S(4).add((t) => Math.pow(Math.max(0, Math.sin(2 * Math.PI * 5.5 * t)), 8) * 1.4 + Math.sin(2 * Math.PI * 22 * t) * 0.2).mix(N(4, 3100).filter('lp', 600), 0.5).mix(N(4, 3101).filter('bp', 3000), 0.08)));
  }
}

export const audio = new Audio();
