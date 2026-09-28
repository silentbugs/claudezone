/**
 * Hinged doors (Warzone 2020 behaviour): they swing both ways, always away from whoever opens them.
 * Walking into a door pushes it open, sprinting into it slams it open, Use opens / closes it, and aiming
 * while pressing Use cracks it open a little and quietly. Bullets pass through (wood). Each door is a
 * small collision structure rotated about its hinge, so collision and bullets follow it for free.
 */
import type { Sim } from './sim';
import type { Player } from './types';
import type { Structure } from '../world/collision';

const OPEN = 1.5, CRACK = 0.32;

export class Doors {
  open: Float32Array; target: Float32Array; speed: Float32Array;
  private active = new Set<number>();
  /** doors whose pose changed since the renderer last looked */
  dirty = new Set<number>();
  byStructure = new Map<number, number>();
  private sts: Structure[] = [];

  constructor(private sim: Sim) {
    const recs = sim.world.doors ?? [];
    const n = recs.length;
    this.open = new Float32Array(n); this.target = new Float32Array(n); this.speed = new Float32Array(n);
    recs.forEach((d, i) => {
      const st = sim.world.col.structures[d.sid]; this.sts.push(st); this.byStructure.set(d.sid, i);
      // 2020 Verdansk: plenty of doors left open or ajar by earlier squads; most start closed
      const r = sim.rng.next();
      this.open[i] = this.target[i] = r < 0.55 ? 0 : r < 0.8 ? (sim.rng.chance(0.5) ? OPEN : -OPEN) : (sim.rng.chance(0.5) ? CRACK : -CRACK);
      this.apply(i);
    });
  }
  get count() { return this.open.length; }
  structure(i: number) { return this.sts[i]; }

  private apply(i: number) {
    const st = this.sts[i], a = this.sim.world.doors[i].base + this.open[i];
    st.angle = a; st.cos = Math.cos(a); st.sin = Math.sin(a);
    this.dirty.add(i);
  }

  /** Which way to swing so the leaf moves away from a person at (x, z). */
  private awaySign(i: number, x: number, z: number) {
    const st = this.sts[i], base = this.sim.world.doors[i].base;
    const nx = Math.sin(base), nz = Math.cos(base); // closed leaf's +z normal
    return (x - st.x) * nx + (z - st.z) * nz > 0 ? 1 : -1; // +angle moves the leaf toward -z
  }

  swing(i: number, target: number, speed: number, by: Player | null, loud: boolean) {
    if (Math.abs(this.target[i] - target) < 1e-3) return;
    this.target[i] = target; this.speed[i] = speed; this.active.add(i);
    const st = this.sts[i];
    this.sim.emit({ t: 'door', x: st.x, y: st.y + 1, z: st.z, open: target !== 0, loud, p: by?.id ?? -1 });
  }

  /** Use: open away from the player (cracked if aiming) or close. */
  interact(i: number, p: Player) {
    if (Math.abs(this.open[i]) > 0.15 || Math.abs(this.target[i]) > 0.15) { this.swing(i, 0, 5, p, false); return; }
    const crack = p.ads > 0.5;
    this.swing(i, this.awaySign(i, p.x, p.z) * (crack ? CRACK : OPEN), crack ? 1.6 : 5, p, false);
  }

  /** Called from movement: a player moving into a door leaf pushes it open (slams it when sprinting). */
  pushBy(p: Player, radius: number, wantX: number, wantZ: number) {
    const col = this.sim.world.col, near = col.near(p.x, p.z, 1.6, this.tmp);
    for (const st of near) {
      if (st.kind !== 'door') continue;
      const i = this.byStructure.get(st.id); if (i === undefined) continue;
      if (p.y > st.y + 1.5 || p.y + 1.7 < st.y) continue;
      const dx = p.x - st.x, dz = p.z - st.z;
      const lx = dx * st.cos - dz * st.sin, lz = dx * st.sin + dz * st.cos, w = this.sim.world.doors[i].w;
      if (lx < -0.2 || lx > w + 0.2 || Math.abs(lz) > radius + 0.25) continue;
      // intended movement toward the leaf, in the leaf's frame (the leaf itself stops actual velocity)
      const vz = wantX * st.sin + wantZ * st.cos;
      if (-Math.sign(lz) * vz < 0.6) continue;
      // already opening / open: leave it (re-aiming it as we cross the wall plane would swing it back into us)
      if (Math.abs(this.target[i]) >= OPEN - 0.01 && Math.abs(this.open[i]) > 0.3) continue;
      const sprint = p.sprinting;
      const tgt = this.awaySign(i, p.x, p.z) * OPEN;
      if (Math.sign(this.target[i]) === Math.sign(tgt) && Math.abs(this.target[i]) >= OPEN - 0.01) continue;
      this.swing(i, tgt, sprint ? 11 : 4.5, p, sprint);
    }
  }
  private tmp: Structure[] = [];

  update(dt: number) {
    for (const i of this.active) {
      const d = this.target[i] - this.open[i], step = this.speed[i] * dt;
      if (Math.abs(d) <= step) { this.open[i] = this.target[i]; this.active.delete(i); }
      else this.open[i] += Math.sign(d) * step;
      this.apply(i);
    }
  }
}
