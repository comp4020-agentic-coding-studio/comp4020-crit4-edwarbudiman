// Web Audio engine: one AudioContext, one master GainNode, and a Pluck
// (CONTEXT.md) is a short-lived oscillator voice fired per Crossing.

// ─── TUNABLES ───────────────────────────────────────────────────────────────
// 0.6, not 0.8: eight Plucks overlapping on a fast sweep sum past the ±1.0
// ceiling at 0.8 and the output hard-clips. At 0.6 the worst realistic sweep
// (8 Plucks 37ms apart at full velocity) peaks at 0.99. Turn it up here if the
// instrument feels thin, but listen to a fast full-width sweep before you do.
const MASTER_GAIN = 0.6;
const PLUCK_DURATION = 0.65; // seconds
// ────────────────────────────────────────────────────────────────────────────

export interface AudioEngine {
  /** Must be called from inside a user-gesture handler (autoplay policy). */
  resume(): Promise<void>;
  /** Whether the context is actually running — i.e. whether a Pluck would be
   *  audible. False before the player's first gesture. */
  running(): boolean;
  /** Fire a Pluck for one String. `velocity` (0..1) scales loudness and brightness. */
  pluck(freq: number, velocity: number): void;
}

export function createAudioEngine(): AudioEngine {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);

  return {
    async resume() {
      if (ctx.state === "suspended") {
        // Rejects when there has been no user gesture yet; that is expected at
        // page load, so it is swallowed rather than thrown.
        await ctx.resume().catch(() => {});
      }
    },

    running() {
      return ctx.state === "running";
    },

    pluck(freq, velocity) {
      const v = Math.min(1, Math.max(0, velocity));
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700 + v * 4500; // faster crossing -> brighter pluck

      const gain = ctx.createGain();
      const peak = 0.12 + v * 0.55; // faster crossing -> louder pluck
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + PLUCK_DURATION);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);

      osc.start(now);
      osc.stop(now + PLUCK_DURATION + 0.05);
      osc.addEventListener("ended", () => {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      });
    },
  };
}
