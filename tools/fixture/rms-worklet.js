/**
 * The capture-side instrument for `capture-mute`. TEST CODE — never shipped.
 *
 * It is a FILE rather than a string inside the probe so it can be read and
 * reviewed on its own, and it is loaded into the engine renderer as a `blob:`
 * module by `tools/gate/capture-mute.mjs`: `tools/` is not on any `app://` root
 * (`src/main/main.js` ROOTS serves `/model/`, `/vendor/` and `src/renderer/`),
 * and putting it on one would be shipping a meter. `docs/TESTING.md` §8, "The
 * capture-side instrument is not shipped".
 *
 * Lifted from `spike/host.html`'s `WORKLET_SRC`, unchanged except for the
 * processor name and the two comments below.
 *
 * ---------------------------------------------------------------------------
 * WHY A WORKLET AND NOT AN AnalyserNode
 * ---------------------------------------------------------------------------
 * A worklet sees EVERY sample of every 128-frame render quantum and can COUNT
 * the quanta it saw. An `AnalyserNode` poll sees whatever happens to be in the
 * FFT window at the instant it is read, and it cannot count anything — so it
 * cannot carry either half of `docs/TESTING.md` §8 assertion 3, which is
 * grounded on a quanta count precisely BECAUSE wall seconds jitter 3.979–4.011 s
 * around 4.0 and a literal `>= 4 s` assertion goes red on ~10 % of unmodified
 * runs. A gate whose verdict changes on code that did not change is measuring
 * the machine.
 *
 * ---------------------------------------------------------------------------
 * 0 QUANTA IS AN ERROR, NEVER A SILENCE
 * ---------------------------------------------------------------------------
 * `quanta`, `quantaWithChannels` and `n` are all reported separately, and the
 * caller turns each zero into a REASON rather than an RMS of 0. A worklet that
 * was never pulled and a worklet fed digital silence both compute 0; only these
 * three counters tell them apart.
 */
class WbRmsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reset();
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.reset(); this.running = true; }
      else if (e.data === 'stop') { this.running = false; this.port.postMessage(this.snapshot()); }
    };
  }

  reset() {
    this.running = false;
    this.sum = 0; this.n = 0; this.peak = 0;
    this.quanta = 0; this.quantaWithChannels = 0; this.series = [];
  }

  snapshot() {
    return {
      sum: this.sum, n: this.n, peak: this.peak,
      quanta: this.quanta, quantaWithChannels: this.quantaWithChannels,
      series: this.series, sampleRate,
    };
  }

  process(inputs) {
    if (!this.running) return true;
    this.quanta++;
    const ch = inputs[0];
    // Pulled, but nothing connected. Counted as a quantum and NOT as a sample,
    // which is what makes `quanta > 0 && quantaWithChannels === 0` a diagnosable
    // state instead of a quiet one.
    if (!ch || ch.length === 0) return true;
    this.quantaWithChannels++;
    let qs = 0, qn = 0;
    for (let c = 0; c < ch.length; c++) {
      const d = ch[c];
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        this.sum += v * v; qs += v * v; qn++;
        const a = v < 0 ? -v : v;
        if (a > this.peak) this.peak = a;
      }
      this.n += d.length;
    }
    // One point per ~0.1 s, so a capture that decays under AGC or dies mid-window
    // is VISIBLE in the record instead of being averaged away into a mean that
    // still sits inside the band.
    if (this.quanta % 40 === 0) this.series.push(Math.sqrt(qs / (qn || 1)));
    return true;
  }
}

registerProcessor('wb-rms', WbRmsProcessor);
