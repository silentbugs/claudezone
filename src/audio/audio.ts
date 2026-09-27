/**
 * Synthesised audio: every sound is generated into an AudioBuffer at startup (no shipped assets),
 * then played through HRTF panners positioned in the world.
 */
type SoundName =
  | 'ar' | 'smg' | 'lmg' | 'sniper' | 'shotgun' | 'pistol' | 'marksman' | 'rocket' | 'distant' | 'distantSniper'
  | 'hit' | 'hitArmor' | 'armorBreak' | 'headshot' | 'kill' | 'plate' | 'reload' | 'reloadEnd' | 'swap' | 'dry'
  | 'step' | 'stepMetal' | 'land' | 'pickup' | 'cash' | 'chute' | 'explosion' | 'whiz' | 'impact' | 'impactMetal'
  | 'uiClick' | 'uiBuy' | 'downed' | 'gasTick' | 'beep' | 'revive' | 'jump' | 'slide' | 'bodyHit' | 'crate';

export class Audio {
  ctx: AudioContext | null = null;
  private buffers = new Map<SoundName, AudioBuffer[]>();
  private master!: GainNode;
  private sfx!: GainNode;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }>();
  volume = 0.7;
  private lx = 0; private ly = 0; private lz = 0;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.gain.value = this.sfxVol;
    this.uiBus = ctx.createGain(); this.uiBus.connect(this.master); this.uiBus.gain.value = this.uiVol;
    this.generate();
  }

  private uiBus!: GainNode;
  sfxVol = 1; uiVol = 0.8;
  setVolume(v: number, sfx = this.sfxVol, ui = this.uiVol) { this.volume = v; this.sfxVol = sfx; this.uiVol = ui; if (this.master) { this.master.gain.value = v; this.sfx.gain.value = sfx; this.uiBus.gain.value = ui; } }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    const ctx = this.ctx; if (!ctx) return;
    this.lx = x; this.ly = y; this.lz = z;
    const L = ctx.listener, t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      (L as any).setPosition(x, y, z); (L as any).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Play a sound; with a position it is spatialised and distance-filtered. */
  play(name: SoundName, opts: { x?: number; y?: number; z?: number; vol?: number; rate?: number; range?: number } = {}) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const list = this.buffers.get(name); if (!list) return;
    const buf = list[(Math.random() * list.length) | 0];
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain(); g.gain.value = opts.vol ?? 1;
    src.connect(g);
    if (opts.x !== undefined) {
      const dx = opts.x - this.lx, dy = (opts.y ?? 0) - this.ly, dz = (opts.z ?? 0) - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = opts.range ?? 60;
      if (d > range * 12) return;
      // air absorption: far sounds lose their top end
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(500, 18000 / (1 + d / (range * 0.6)));
      const p = ctx.createPanner(); p.panningModel = d < 40 ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = range * 0.15; p.rolloffFactor = 1.1; p.maxDistance = range * 12;
      p.positionX.value = opts.x; p.positionY.value = opts.y ?? 0; p.positionZ.value = opts.z ?? 0;
      g.connect(lp); lp.connect(p); p.connect(this.sfx);
    } else g.connect(this.sfx);
    src.start();
  }

  /** Continuous loop (plane engine, wind, gas). vol 0 stops it smoothly. */
  loop(key: 'engine' | 'wind' | 'gas' | 'chute', vol: number, rate = 1, cutoff = 20000) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    let l = this.loops.get(key);
    if (!l) {
      if (vol <= 0.001) return;
      const src = ctx.createBufferSource();
      src.buffer = key === 'engine' ? this.engineBuf : key === 'gas' ? this.gasBuf : this.windBuf;
      src.loop = true; src.loopStart = 0; src.loopEnd = src.buffer!.duration * 0.9; // edges are crossfaded
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter); filter.connect(gain); gain.connect(this.master); src.start();
      l = { src, gain, filter }; this.loops.set(key, l);
    }
    const t = ctx.currentTime;
    l.gain.gain.setTargetAtTime(vol, t, 0.15);
    l.src.playbackRate.setTargetAtTime(rate, t, 0.2);
    l.filter.frequency.setTargetAtTime(cutoff, t, 0.2);
  }

  private engineBuf!: AudioBuffer; private windBuf!: AudioBuffer; private gasBuf!: AudioBuffer;

  // ---------------------------------------------------------------- synthesis
  private buf(len: number, fn: (t: number, i: number, sr: number) => number, stereo = false): AudioBuffer {
    const ctx = this.ctx!, sr = ctx.sampleRate, n = Math.max(1, Math.floor(len * sr));
    const b = ctx.createBuffer(stereo ? 2 : 1, n, sr);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, sr);
    }
    // normalise
    let peak = 0; for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    if (peak > 0) for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] /= peak; }
    return b;
  }
  private add(name: SoundName, ...b: AudioBuffer[]) { this.buffers.set(name, b); }

  private generate() {
    const noise = () => Math.random() * 2 - 1;
    // one-pole filtered noise helpers
    const lpNoise = (k: number) => { let s = 0; return () => (s += (noise() - s) * k); };
    const gun = (body: number, crack: number, tail: number, pitch: number, len: number) => {
      const lp = lpNoise(0.25 * pitch), lp2 = lpNoise(0.03);
      return this.buf(len, (t) => {
        const cr = noise() * Math.exp(-t * 180) * crack;
        const bd = lp() * Math.exp(-t * 28) * body * 2.2 + Math.sin(2 * Math.PI * 60 * pitch * t * (1 - t)) * Math.exp(-t * 35) * body;
        const tl = lp2() * Math.exp(-t * (6 / tail)) * 3.2 * tail;
        return Math.tanh((cr + bd + tl) * 1.6);
      });
    };
    this.add('ar', gun(1, 0.8, 0.5, 1, 0.9), gun(1, 0.9, 0.55, 1.05, 0.9), gun(1.05, 0.8, 0.5, 0.95, 0.9));
    this.add('smg', gun(0.7, 0.9, 0.35, 1.35, 0.6), gun(0.7, 1, 0.35, 1.4, 0.6));
    this.add('lmg', gun(1.2, 0.7, 0.6, 0.85, 1.0), gun(1.2, 0.75, 0.6, 0.8, 1.0));
    this.add('sniper', gun(1.6, 1, 1.2, 0.6, 2.0));
    this.add('marksman', gun(1.3, 1, 0.9, 0.75, 1.5));
    this.add('shotgun', gun(1.5, 0.6, 0.8, 0.7, 1.3));
    this.add('pistol', gun(0.6, 1, 0.3, 1.5, 0.5));
    this.add('rocket', this.buf(1.2, (t) => { const n = noise(); return n * Math.exp(-t * 4) * (1 - Math.exp(-t * 60)); }));
    { const l = lpNoise(0.02); this.add('distant', this.buf(1.6, (t) => l() * Math.exp(-t * 4) * (1 - Math.exp(-t * 200)))); }
    { const l = lpNoise(0.04); this.add('distantSniper', this.buf(2.2, (t) => l() * Math.exp(-t * 2.5) * (1 - Math.exp(-t * 200)))); }
    const tick = (f: number, d: number, n = 0.2) => this.buf(d, (t) => (Math.sin(2 * Math.PI * f * t) + noise() * n) * Math.exp(-t / (d * 0.25)));
    this.add('hit', tick(2600, 0.06, 0.4));
    this.add('hitArmor', this.buf(0.09, (t) => (Math.sin(2 * Math.PI * 3400 * t) * 0.6 + Math.sin(2 * Math.PI * 5100 * t) * 0.4 + noise() * 0.3) * Math.exp(-t * 60)));
    this.add('armorBreak', this.buf(0.45, (t) => { const f = 2400 + Math.sin(t * 300) * 900; return (noise() * 0.7 + Math.sin(2 * Math.PI * f * t) * 0.5) * Math.exp(-t * 9) * (t < 0.02 ? t / 0.02 : 1); }));
    this.add('headshot', this.buf(0.16, (t) => (Math.sin(2 * Math.PI * 1800 * t) + Math.sin(2 * Math.PI * 900 * t) * 0.5 + noise() * 0.3) * Math.exp(-t * 28)));
    this.add('kill', this.buf(0.3, (t) => (Math.sin(2 * Math.PI * 1300 * t) * 0.7 + Math.sin(2 * Math.PI * 650 * t) * 0.5 + noise() * 0.25) * Math.exp(-t * 14)));
    this.add('bodyHit', this.buf(0.12, (t) => { let s = 0; return (noise() * 0.6 + Math.sin(2 * Math.PI * 180 * t)) * Math.exp(-t * 40); }));
    this.add('plate', this.buf(0.5, (t) => { const k = t < 0.2 ? 0 : 1; return (Math.sin(2 * Math.PI * (k ? 1900 : 700) * t) * 0.6 + noise() * (k ? 0.3 : 0.6)) * Math.exp(-((t - k * 0.25) % 0.25) * 30); }));
    this.add('reload', this.buf(0.18, (t) => (noise() * 0.7 + Math.sin(2 * Math.PI * 900 * t) * 0.5) * Math.exp(-t * 35)));
    this.add('reloadEnd', this.buf(0.14, (t) => (noise() * 0.6 + Math.sin(2 * Math.PI * 1500 * t) * 0.6) * Math.exp(-t * 45)));
    this.add('swap', this.buf(0.25, (t) => noise() * Math.exp(-t * 18) * 0.6 + Math.sin(2 * Math.PI * 500 * t) * Math.exp(-t * 30) * 0.3));
    this.add('dry', tick(1200, 0.05, 0.6));
    { const mk = () => { const l = lpNoise(0.15); return this.buf(0.12, (t) => l() * Math.exp(-t * 40) * (1 - Math.exp(-t * 400))); }; this.add('step', mk(), mk(), mk(), mk()); }
    { const mk = () => this.buf(0.14, (t) => (noise() * 0.5 + Math.sin(2 * Math.PI * (700 + Math.random() * 300) * t) * 0.5) * Math.exp(-t * 35)); this.add('stepMetal', mk(), mk()); }
    { const l = lpNoise(0.08); this.add('land', this.buf(0.3, (t) => l() * Math.exp(-t * 16))); }
    this.add('jump', this.buf(0.15, (t) => noise() * Math.exp(-t * 30) * 0.5));
    { const l = lpNoise(0.1); this.add('slide', this.buf(0.7, (t) => l() * Math.exp(-t * 3) * (1 - Math.exp(-t * 50)))); }
    this.add('pickup', this.buf(0.15, (t) => (noise() * 0.5 + Math.sin(2 * Math.PI * 1100 * t) * 0.4) * Math.exp(-t * 30)));
    this.add('cash', this.buf(0.35, (t) => (Math.sin(2 * Math.PI * 2200 * t) * 0.5 + Math.sin(2 * Math.PI * 3300 * t) * 0.4) * Math.exp(-(t % 0.09) * 40) * Math.exp(-t * 4)));
    { const l = lpNoise(0.2); this.add('chute', this.buf(0.6, (t) => l() * (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 8)))); }
    {
      const l = lpNoise(0.03), l2 = lpNoise(0.2);
      this.add('explosion', this.buf(2.5, (t) => Math.tanh((l() * 6 * Math.exp(-t * 2.2) + l2() * 2 * Math.exp(-t * 12) + Math.sin(2 * Math.PI * 40 * t) * Math.exp(-t * 5)) * 1.5)));
    }
    this.add('whiz', this.buf(0.18, (t) => { const f = 3000 - t * 9000; return (Math.sin(2 * Math.PI * f * t) * 0.3 + noise() * 0.7) * Math.sin(Math.PI * t / 0.18); }));
    this.add('impact', this.buf(0.1, (t) => noise() * Math.exp(-t * 60)));
    this.add('impactMetal', this.buf(0.25, (t) => (Math.sin(2 * Math.PI * 2300 * t) * 0.6 + Math.sin(2 * Math.PI * 3700 * t) * 0.3 + noise() * 0.3) * Math.exp(-t * 18)));
    this.add('uiClick', tick(1800, 0.04, 0.1));
    this.add('uiBuy', this.buf(0.3, (t) => (Math.sin(2 * Math.PI * (t < 0.1 ? 880 : 1320) * t)) * Math.exp(-(t % 0.1) * 20)));
    this.add('downed', this.buf(1.2, (t) => { const l = Math.sin(2 * Math.PI * 70 * t); return (l + noise() * 0.1) * Math.exp(-t * 2.5); }));
    this.add('gasTick', this.buf(0.3, (t) => (noise() * 0.4 + Math.sin(2 * Math.PI * 220 * t) * 0.6) * Math.exp(-t * 12)));
    this.add('beep', tick(1500, 0.12, 0));
    this.add('revive', this.buf(0.4, (t) => Math.sin(2 * Math.PI * (600 + t * 1200) * t) * Math.exp(-t * 6)));
    this.add('crate', this.buf(0.5, (t) => (noise() * 0.5 + Math.sin(2 * Math.PI * 300 * t) * 0.5) * Math.exp(-t * 9)));
    // loops
    {
      const l = lpNoise(0.05);
      this.engineBuf = this.buf(4, (t) => l() * 0.6 + Math.sin(2 * Math.PI * 58 * t) * 0.35 + Math.sin(2 * Math.PI * 116 * t) * 0.2 + Math.sin(2 * Math.PI * 29 * t) * 0.3, true);
    }
    { const l = lpNoise(0.08), l2 = lpNoise(0.01); this.windBuf = this.buf(4, (t) => l() * (0.6 + 0.4 * Math.sin(t * 3.1)) + l2() * 2, true); }
    { const l = lpNoise(0.02); this.gasBuf = this.buf(4, (t) => l() * (0.7 + 0.3 * Math.sin(t * 1.7)) + Math.sin(2 * Math.PI * 45 * t) * 0.15, true); }
    // loop buffers need seamless ends; crossfade the edges
    for (const b of [this.engineBuf, this.windBuf, this.gasBuf]) for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c), n = d.length, f = Math.floor(n * 0.1);
      for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
    }
  }
}

export const audio = new Audio();
