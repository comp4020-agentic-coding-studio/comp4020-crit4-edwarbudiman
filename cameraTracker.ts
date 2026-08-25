// Camera Tracker (CONTEXT.md, ADR 0001): derives Position by motion-diffing
// the raw video feed against the previous frame — one moving region (whole
// hand), not a per-finger/pose model.

export interface PositionSample {
  /** Normalized horizontal position, 0 (left) to 1 (right). */
  x: number;
  /** How strongly something moved this frame, 0..1. 0 means "no motion". */
  magnitude: number;
}

export type PositionListener = (sample: PositionSample) => void;

const SAMPLE_SIZE = 64; // downsample the video to this square for cheap per-frame diffing
const COLUMNS = 24;
const PER_PIXEL_THRESHOLD = 12 * 3; // summed R+G+B delta below this counts as noise

// ─── TUNABLES ───────────────────────────────────────────────────────────────

// A user-facing camera hands us an un-mirrored image: move your hand to your
// right and it appears at *decreasing* image x, so the raw centroid walks down
// the Scale while your hand walks up it.
//
// MUST stay in step with `#camera-preview { transform: scaleX(-1) }` in
// styles.css: mirror one without the other and the preview lies to the player.
const MIRROR_X = true;

/**
 * Half-width, in columns, of the window kept around the strongest-moving
 * column. Everything outside it is discarded before the centroid is taken.
 *
 * This is the fix for "it tracks my head too". A centroid over *all* columns
 * is a mean, so a second moving thing drags it toward itself and the mean can
 * never reach past its contributors — measured, a head drifting one pixel per
 * frame shrank the reachable span from 0.90 to 0.54, leaving 4 of 8 Strings
 * physically unplayable. Keeping only a window around the dominant motion
 * restores the full span. 3 columns of 24 is ~1/8 of the frame — about a hand.
 *
 * Raise it to average over a wider region (steadier, more head contamination);
 * lower it to lock harder onto the single strongest thing (twitchier).
 */
const PEAK_WINDOW_COLS = 3;

/**
 * Multiplies Position's distance from centre, so the player does not have to
 * physically reach the edge of the camera's view to reach the outer Strings.
 *
 * Needed because arm reach is smaller than the camera's field of view: a hand
 * sweeping only the middle 70% of frame width leaves the outer Strings
 * unreachable no matter how good the tracking is. 1.8 maps that 70% onto the
 * full width. Raise it if the edges still feel far; lower it if the middle
 * Strings feel cramped and twitchy.
 */
const REACH_GAIN = 1.8;

/**
 * Ignore everything above this fraction of frame height. 0 disables it.
 *
 * Left off by default on purpose. Measured, it is a knife-edge: a head centred
 * at 0.26 of frame height is correctly ignored at ROI 0.5, but one at 0.32 is
 * still followed — a *moving* head's difference region reaches below the head
 * itself and leaks in. Meanwhile a hand raised above ~0.38 stops being tracked
 * at all, so the instrument goes silent with no explanation. Try it only if
 * you can hold your framing still.
 */
const ROI_TOP = 0;

/**
 * How fast the background model absorbs the current frame, per frame.
 *
 * This is the fix for ghosting. Diffing against the *previous frame* sees the
 * hand leave the old spot AND arrive at the new one — both are "motion", so on
 * a fast stroke the tracker locked onto the departure lobe and reported where
 * the hand *had been*: measured, a hand crossing 0.30 -> 0.75 in one frame was
 * reported at 0.298, and 0.35->0.65 was indistinguishable from 0.65->0.35.
 * Direction was invisible. Diffing against a slowly-adapting background gives
 * where the hand *is* instead — max error 0.009 across the same sweep.
 *
 * The trade: a hand held perfectly still is absorbed into the background and
 * disappears. At 0.02 that takes ~2.1s at 60fps, and it comes straight back on
 * the next movement. Raise it to shrug off lighting changes faster; lower it to
 * let a near-still hand linger longer.
 */
const BACKGROUND_ADAPT = 0.02;

/** Position delta -> velocity, matching PointerInput so both Input Sources
 *  produce comparable Pluck loudness. */
const VELOCITY_SCALE = 40;
// ────────────────────────────────────────────────────────────────────────────

/** Mirror, then expand about centre so the player needn't reach the frame edge. */
export function shapePosition(
  sample: PositionSample,
  mirror: boolean = MIRROR_X,
  gain: number = REACH_GAIN,
): PositionSample {
  const mirrored = mirror ? 1 - sample.x : sample.x;
  const expanded = 0.5 + (mirrored - 0.5) * gain;
  return { x: Math.min(1, Math.max(0, expanded)), magnitude: sample.magnitude };
}

/** Per-pixel summed R+G+B, the form the background model is kept in. */
export function summedLuminance(rgba: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    out[i] = rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2];
  }
  return out;
}

export interface Detection {
  x: number;
  presence: number;
  /** Per-column energy, and the column the tracker locked onto. Debug only. */
  energy: number[];
  peak: number;
}

/**
 * The peak-windowed centroid of the motion between two frames.
 *
 * This is the FALLBACK Input Source now (ADR 0003): it runs only when the Hand
 * Tracker's model cannot load. It is deliberately the plain frame-difference
 * version — an attempt to also weight by difference-from-background measured
 * better on synthetic frames and was reported worse in an actual room, and the
 * honest conclusion (ADR 0002) is that no arrangement of these signals knows
 * what a hand is.
 */
export function focusedCentroid(
  background: Float32Array,
  prevFrame: Float32Array,
  frame: Uint8ClampedArray,
  size: number,
  columns: number,
  peakWindowCols: number = PEAK_WINDOW_COLS,
  roiTop: number = ROI_TOP,
): Detection | null {
  const colWidth = size / columns;
  const energy = new Array(columns).fill(0);
  const yStart = Math.floor(Math.min(0.95, Math.max(0, roiTop)) * size);
  void background; // kept in the signature so the seam and its tests stay stable

  for (let y = yStart; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const lum = frame[i * 4] + frame[i * 4 + 1] + frame[i * 4 + 2];
      const moving = Math.abs(lum - prevFrame[i]);
      if (moving > PER_PIXEL_THRESHOLD) {
        energy[Math.min(columns - 1, Math.floor(x / colWidth))] += moving;
      }
    }
  }

  let peak = 0;
  for (let c = 1; c < columns; c++) if (energy[c] > energy[peak]) peak = c;
  if (energy[peak] === 0) return null;

  let total = 0;
  let weighted = 0;
  for (let c = 0; c < columns; c++) {
    if (Math.abs(c - peak) > peakWindowCols) continue;
    total += energy[c];
    weighted += energy[c] * (c + 0.5);
  }
  if (total === 0) return null;

  const scale = size * size * 60;
  return {
    x: weighted / total / columns,
    presence: Math.min(1, total / scale),
    energy,
    peak,
  };
}

export class CameraTracker {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  /** Slowly-adapting summed-luminance background — "the room". */
  private background: Float32Array | null = null;
  /** The immediately previous frame's luminance — "what just moved". */
  private prevFrame: Float32Array | null = null;
  private lastX: number | null = null;
  private lastT: number | null = null;
  private rafId: number | null = null;
  /** Last per-column energy and locked column, for the Debug Overlay only. */
  lastEnergy: number[] = [];
  lastPeak = -1;

  constructor(
    private video: HTMLVideoElement,
    private onPosition: PositionListener,
  ) {
    this.canvas.width = SAMPLE_SIZE;
    this.canvas.height = SAMPLE_SIZE;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  start(): void {
    const tick = () => {
      this.sampleFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.background = null;
    this.prevFrame = null;
    this.lastX = null;
    this.lastT = null;
    this.lastEnergy = [];
    this.lastPeak = -1;
  }

  private sampleFrame(): void {
    if (this.video.readyState < 2) return;
    this.ctx.drawImage(this.video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const frame = this.ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

    if (this.background === null || this.prevFrame === null) {
      // First frame is both the background and the previous frame; whatever is
      // in shot at that moment becomes "the room".
      this.background = summedLuminance(frame, SAMPLE_SIZE);
      this.prevFrame = summedLuminance(frame, SAMPLE_SIZE);
      return;
    }

    const detection = focusedCentroid(
      this.background,
      this.prevFrame,
      frame,
      SAMPLE_SIZE,
      COLUMNS,
    );
    this.adaptBackground(frame);
    this.prevFrame = summedLuminance(frame, SAMPLE_SIZE);
    if (detection === null) {
      this.lastEnergy = [];
      this.lastPeak = -1;
      return;
    }
    this.lastEnergy = detection.energy;
    this.lastPeak = detection.peak;

    const x = shapePosition({ x: detection.x, magnitude: 0 }).x;
    const now = performance.now();

    // Velocity from how far Position moved, the same way PointerInput does it —
    // the background difference tells us the hand's size, not its speed.
    if (this.lastX !== null && this.lastT !== null) {
      const dt = Math.max(1, now - this.lastT);
      const magnitude = Math.min(1, (Math.abs(x - this.lastX) / dt) * VELOCITY_SCALE);
      if (magnitude > 0) this.onPosition({ x, magnitude });
    }
    this.lastX = x;
    this.lastT = now;
  }

  private adaptBackground(frame: Uint8ClampedArray): void {
    const bg = this.background!;
    for (let i = 0; i < bg.length; i++) {
      const lum = frame[i * 4] + frame[i * 4 + 1] + frame[i * 4 + 2];
      bg[i] = bg[i] * (1 - BACKGROUND_ADAPT) + lum * BACKGROUND_ADAPT;
    }
  }
}
