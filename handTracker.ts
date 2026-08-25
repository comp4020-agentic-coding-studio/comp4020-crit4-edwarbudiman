// Hand Tracker (CONTEXT.md, ADR 0003): an Input Source that derives Position
// from a real hand-landmark model instead of from motion in the frame.
//
// Technique adapted from a classmate's COMP4020 assignment-1 prototype
// (comp4020-ass1-Januaraine), which uses MediaPipe Tasks Vision the same way:
// npm for the JS API, CDN at a pinned version for the WASM runtime and model,
// exponential smoothing on the tracked landmark, and a short grace window so a
// single dropped detection doesn't snap the tracked point. Their prototype
// tracks a whole arm chain for inverse kinematics; this one needs a single
// horizontal coordinate, so it uses HandLandmarker rather than
// HolisticLandmarker and reads one landmark.

import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { PositionListener } from "./cameraTracker.ts";

// ─── TUNABLES ───────────────────────────────────────────────────────────────

/** Must match the installed @mediapipe/tasks-vision, so the WASM runtime and
 *  the bundled JS API are the same version. Bump both together. */
const TASKS_VISION_VERSION = "1.0.1";
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * Which of the 21 hand landmarks becomes Position.
 *
 * 4 = THUMB_TIP. On an open palm held up to strum, the thumb is the leading
 * edge — the part that would physically hit the string first — which is why it
 * is the default. The cost is jitter: fingertips move faster and wobble more
 * than the knuckles behind them. If the thumb feels twitchy, 8
 * (INDEX_FINGER_TIP) is similar, and 5 (INDEX_FINGER_MCP, the knuckle) is the
 * steadiest point on the hand at the price of feeling less like a fingertip.
 */
const TRACKED_LANDMARK = 4;

/**
 * Exponential smoothing on Position: `next = prev + (raw - prev) * SMOOTHING`.
 *
 * 1.0 is no smoothing at all — every frame's raw landmark, maximum
 * responsiveness, maximum jitter. Lower is steadier but adds lag, and lag on a
 * strum instrument reads as the tracked point trailing your hand, which is the
 * very thing we are trying to fix. Landmarks are far steadier than the old
 * motion centroid, so this can sit much higher than it could before.
 */
const SMOOTHING = 0.45;

/**
 * Only track while the palm is open; a closed hand stops producing Position
 * and therefore stops plucking. This is the Arm/Disarm idea CONTEXT.md parked:
 * a fist is the mute. Set false to track whenever a hand is visible at all.
 */
const REQUIRE_OPEN_PALM = true;
/** How many of the four fingers (not the thumb) must be extended to count as open. */
const OPEN_PALM_MIN_FINGERS = 3;

/**
 * Hold the last known Position for this long when detection blinks out, rather
 * than immediately reporting the hand as gone. Motion blur mid-strum drops a
 * frame regularly, and without this the marker flickers between tracked and
 * lost — which feels exactly like ghosting.
 */
const TRACKING_LOSS_HYSTERESIS_MS = 300;

/** getUserMedia hands back raw sensor pixels — never mirrored — so a hand moved
 *  to your right appears at DECREASING image x. Invert so the instrument runs
 *  the way you see it. */
const MIRROR_X = true;

/** Arm reach is smaller than the camera's field of view: without this the outer
 *  Strings need you to physically reach the edge of frame. */
const REACH_GAIN = 1.6;

/** Position delta -> velocity, matching PointerInput so Pluck loudness is
 *  comparable across Input Sources. */
const VELOCITY_SCALE = 40;

/** Requesting a small frame keeps inference cheap; the model does not need more. */
const CAPTURE_WIDTH = 320;
const CAPTURE_HEIGHT = 240;
// ────────────────────────────────────────────────────────────────────────────

// 21-point hand topology. Each finger is MCP (knuckle) -> PIP -> DIP -> TIP.
const FINGERS = [
  { pip: 6, tip: 8 }, // index
  { pip: 10, tip: 12 }, // middle
  { pip: 14, tip: 16 }, // ring
  { pip: 18, tip: 20 }, // pinky
] as const;
const WRIST = 0;

export type HandTrackingStatus = "loading" | "tracking" | "no-hand" | "closed" | "error";

export interface HandTrackerOptions {
  onPosition: PositionListener;
  /** Called when tracking lapses, so Crossing state can be reset — otherwise
   *  the next detection looks like one huge jump and plucks everything between. */
  onLost: () => void;
  onStatus?: (status: HandTrackingStatus, message?: string) => void;
  /** Drawn last, in the same mirrored space as the frame — so the caller can
   *  put the boundary lines over the picture without owning the draw loop. */
  drawExtra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/**
 * A hand is "open" when at least OPEN_PALM_MIN_FINGERS fingertips sit further
 * from the wrist than their own middle joint. Comparing each finger against its
 * own PIP rather than against an absolute distance keeps this working as the
 * hand moves toward or away from the camera, and as it rotates.
 */
export function isPalmOpen(
  landmarks: NormalizedLandmark[],
  minFingers: number = OPEN_PALM_MIN_FINGERS,
): boolean {
  const wrist = landmarks[WRIST];
  if (!wrist) return false;
  const from = (lm: NormalizedLandmark | undefined): number =>
    lm ? Math.hypot(lm.x - wrist.x, lm.y - wrist.y) : 0;
  let extended = 0;
  for (const { pip, tip } of FINGERS) {
    if (from(landmarks[tip]) > from(landmarks[pip])) extended++;
  }
  return extended >= minFingers;
}

/** Mirror, then expand about centre so the player needn't reach the frame edge. */
export function shapeX(x: number, mirror: boolean = MIRROR_X, gain: number = REACH_GAIN): number {
  const mirrored = mirror ? 1 - x : x;
  return Math.min(1, Math.max(0, 0.5 + (mirrored - 0.5) * gain));
}

export class HandTracker {
  private video = document.createElement("video");
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private stopped = false;

  private smoothedX: number | null = null;
  private lastReportedX: number | null = null;
  private lastT: number | null = null;
  private lastGoodAt: number | null = null;
  private lostSignalled = false;

  /** Latest landmarks and open state, for the Debug Overlay to draw. */
  lastLandmarks: NormalizedLandmark[] | null = null;
  lastOpen = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private options: HandTrackerOptions,
  ) {
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start(): Promise<boolean> {
    this.options.onStatus?.("loading");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });

      if (this.stopped) return false;
      this.options.onStatus?.("tracking");
      this.loop();
      return true;
    } catch (error) {
      // Never falls back on its own — the caller decides what to do instead.
      this.options.onStatus?.(
        "error",
        error instanceof Error ? error.message : "Hand tracking failed to start.",
      );
      this.stop();
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.lastLandmarks = null;
    this.smoothedX = null;
    this.lastReportedX = null;
    this.lastT = null;
  }

  private loop = (): void => {
    if (this.stopped || !this.landmarker) return;
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.drawFrame();
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      const hand = result.landmarks[0] ?? null;
      const open = hand ? isPalmOpen(hand) : false;
      this.lastLandmarks = hand;
      this.lastOpen = open;

      const usable = hand && (!REQUIRE_OPEN_PALM || open);
      if (usable) {
        this.report(hand[TRACKED_LANDMARK]);
      } else if (
        this.lastGoodAt !== null &&
        performance.now() - this.lastGoodAt < TRACKING_LOSS_HYSTERESIS_MS
      ) {
        // Inside the grace window: say nothing, change nothing. A dropped frame
        // is not a hand leaving.
        this.options.onStatus?.("tracking");
      } else {
        this.lapse(hand ? "closed" : "no-hand");
      }
      this.drawOverlay();
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private report(landmark: NormalizedLandmark | undefined): void {
    if (!landmark) return;
    const raw = shapeX(landmark.x);
    this.smoothedX =
      this.smoothedX === null ? raw : this.smoothedX + (raw - this.smoothedX) * SMOOTHING;
    const x = this.smoothedX;
    const now = performance.now();

    if (this.lastReportedX !== null && this.lastT !== null) {
      const dt = Math.max(1, now - this.lastT);
      const magnitude = Math.min(1, (Math.abs(x - this.lastReportedX) / dt) * VELOCITY_SCALE);
      this.options.onPosition({ x, magnitude });
    }
    this.lastReportedX = x;
    this.lastT = now;
    this.lastGoodAt = now;
    this.lostSignalled = false;
    this.options.onStatus?.("tracking");
  }

  private lapse(status: HandTrackingStatus): void {
    if (!this.lostSignalled) {
      this.lostSignalled = true;
      this.smoothedX = null;
      this.lastReportedX = null;
      this.lastT = null;
      this.options.onLost();
    }
    this.options.onStatus?.(status);
  }

  /**
   * Draws the camera frame mirrored into the canvas, rather than CSS-mirroring
   * the canvas afterwards. Everything drawn on top therefore lives in the same
   * space the player sees, so overlay text reads the right way round and the
   * boundary lines cannot drift out of alignment with the picture.
   */
  private drawFrame(): void {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, -w, 0, w, h);
    ctx.restore();
  }

  private drawOverlay(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const hand = this.lastLandmarks;
    if (!hand) {
      this.options.drawExtra?.(ctx, w, h);
      return;
    }

    // Same mirroring the frame got, applied to landmark coordinates.
    const px = (lm: NormalizedLandmark): [number, number] => [(1 - lm.x) * w, lm.y * h];

    ctx.fillStyle = this.lastOpen ? "rgba(57, 255, 136, 0.9)" : "rgba(255, 120, 120, 0.9)";
    for (const lm of hand) {
      const [x, y] = px(lm);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const tracked = hand[TRACKED_LANDMARK];
    if (tracked) {
      const [x, y] = px(tracked);
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = this.lastOpen ? "#39ff88" : "#ff7878";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (REQUIRE_OPEN_PALM && !this.lastOpen) {
      ctx.fillStyle = "rgba(255, 120, 120, 0.95)";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("open your palm", w / 2, h - 10);
    }

    this.options.drawExtra?.(ctx, w, h);
  }

  /** Which landmark index Position is read from, for the Debug Overlay. */
  get trackedLandmark(): number {
    return TRACKED_LANDMARK;
  }

  get requiresOpenPalm(): boolean {
    return REQUIRE_OPEN_PALM;
  }
}
