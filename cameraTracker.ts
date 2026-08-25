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

/**
 * Column-wise motion energy between two same-size RGBA frames, reduced to a
 * single weighted centroid. Pure function, no DOM/canvas — the seam that
 * makes the tracking math testable outside a real camera.
 */
export function columnMotionCentroid(
  prev: Uint8ClampedArray,
  curr: Uint8ClampedArray,
  size: number,
  columns: number,
): PositionSample {
  const colWidth = size / columns;
  const energy = new Array(columns).fill(0);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const prevLum = prev[i] + prev[i + 1] + prev[i + 2];
      const currLum = curr[i] + curr[i + 1] + curr[i + 2];
      const delta = Math.abs(currLum - prevLum);
      if (delta > PER_PIXEL_THRESHOLD) {
        const col = Math.min(columns - 1, Math.floor(x / colWidth));
        energy[col] += delta;
      }
    }
  }

  let totalEnergy = 0;
  let weightedSum = 0;
  for (let c = 0; c < columns; c++) {
    totalEnergy += energy[c];
    weightedSum += energy[c] * (c + 0.5);
  }

  if (totalEnergy === 0) return { x: 0, magnitude: 0 };

  const x = weightedSum / totalEnergy / columns;
  const magnitude = Math.min(1, totalEnergy / (size * size * 60));
  return { x, magnitude };
}

export class CameraTracker {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private prevFrame: Uint8ClampedArray | null = null;
  private rafId: number | null = null;

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
    this.prevFrame = null;
  }

  private sampleFrame(): void {
    if (this.video.readyState < 2) return;
    this.ctx.drawImage(this.video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const frame = this.ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

    if (this.prevFrame) {
      const sample = columnMotionCentroid(this.prevFrame, frame, SAMPLE_SIZE, COLUMNS);
      if (sample.magnitude > 0) this.onPosition(sample);
    }
    this.prevFrame = frame;
  }
}
