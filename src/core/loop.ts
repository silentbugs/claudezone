/** Fixed-step clock with render interpolation alpha. */
export class FixedStep {
  acc = 0;
  alpha = 0;
  constructor(public readonly dt: number, private maxSteps = 6) {}
  advance(elapsed: number, step: (dt: number) => void) {
    this.acc += Math.min(elapsed, this.dt * this.maxSteps);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) { step(this.dt); this.acc -= this.dt; n++; }
    if (n === this.maxSteps) this.acc = 0;
    this.alpha = this.acc / this.dt;
    return n;
  }
}
