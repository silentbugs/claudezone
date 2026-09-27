/** Tiny offline DSP kit for synthesizing sound buffers (all sample-domain, deterministic per seed). */
export class Sig {
  constructor(public d: Float32Array, public sr: number) {}
  static make(sec: number, sr: number) { return new Sig(new Float32Array(Math.max(1, Math.floor(sec * sr))), sr); }
  get len() { return this.d.length; }
  /** d[i] += fn(t, i) */
  add(fn: (t: number, i: number) => number, from = 0) { const s = Math.floor(from * this.sr); for (let i = s; i < this.d.length; i++) this.d[i] += fn((i - s) / this.sr, i); return this; }
  mix(o: Sig, gain = 1, at = 0) { const s = Math.floor(at * this.sr); for (let i = 0; i < o.d.length && s + i < this.d.length; i++) if (s + i >= 0) this.d[s + i] += o.d[i] * gain; return this; }
  gain(g: number) { for (let i = 0; i < this.d.length; i++) this.d[i] *= g; return this; }
  env(fn: (t: number) => number) { for (let i = 0; i < this.d.length; i++) this.d[i] *= fn(i / this.sr); return this; }
  sat(drive: number) { for (let i = 0; i < this.d.length; i++) this.d[i] = Math.tanh(this.d[i] * drive) / Math.tanh(drive); return this; }
  /** RBJ biquad; type lp/hp/bp, f in Hz (can be a function of time), q. */
  filter(type: 'lp' | 'hp' | 'bp', f: number | ((t: number) => number), q = 0.707) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const sr = this.sr, fixed = typeof f === 'number';
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    const coef = (fr: number) => {
      const w = (2 * Math.PI * Math.min(fr, sr * 0.45)) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
      let c0, c1, c2; const a0 = 1 + al;
      if (type === 'lp') { c0 = (1 - cs) / 2; c1 = 1 - cs; c2 = (1 - cs) / 2; }
      else if (type === 'hp') { c0 = (1 + cs) / 2; c1 = -(1 + cs); c2 = (1 + cs) / 2; }
      else { c0 = al; c1 = 0; c2 = -al; }
      b0 = c0 / a0; b1 = c1 / a0; b2 = c2 / a0; a1 = (-2 * cs) / a0; a2 = (1 - al) / a0;
    };
    if (fixed) coef(f as number);
    for (let i = 0; i < this.d.length; i++) {
      if (!fixed && (i & 31) === 0) coef((f as (t: number) => number)(i / sr));
      const x = this.d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; this.d[i] = y;
    }
    return this;
  }
  normalize(peak = 0.95) { let m = 0; for (const v of this.d) m = Math.max(m, Math.abs(v)); if (m > 0) this.gain(peak / m); return this; }
  /** Fade in/out at the ends to avoid clicks. */
  edges(ms = 2) { const n = Math.floor((ms / 1000) * this.sr); for (let i = 0; i < n && i < this.d.length; i++) { const k = i / n; this.d[i] *= k; this.d[this.d.length - 1 - i] *= k; } return this; }
}

export function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; }; }
export function noiseSig(sec: number, sr: number, seed: number) { const r = rng(seed), s = Sig.make(sec, sr); for (let i = 0; i < s.len; i++) s.d[i] = r(); return s; }
