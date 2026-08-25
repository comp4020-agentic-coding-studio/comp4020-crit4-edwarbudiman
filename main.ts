import { createAudioEngine } from "./audio.ts";
import { CameraTracker, type PositionSample } from "./cameraTracker.ts";
import { HandTracker } from "./handTracker.ts";
import { PointerInput } from "./pointerInput.ts";
import {
  buildStrings,
  createCrossingState,
  detectCrossings,
  lineSpacing,
  lineX,
  type CrossingOptions,
} from "./strings.ts";

// ─── TUNABLES ───────────────────────────────────────────────────────────────
// Everything worth adjusting by ear lives here. Keep `pnpm dev` running and
// change these, not the code below.

/** true shows the camera testing overlay (bigger preview, boundary lines, live
 *  numbers). Flip to false to ship the clean instrument. */
const DEBUG_OVERLAY = false;

const STRING_COUNT = 8; // do re mi fa sol la si do'
const ROOT_FREQ = 261.6256; // C4 — so "do" is literally middle C

/** How far past a boundary line the Position must travel before that line can
 *  pluck again, as a fraction of the gap between lines. 0.15–0.30 is the useful
 *  range: lower re-triggers more eagerly (and picks up more camera noise),
 *  higher demands a bigger commitment to each stroke. */
const DEADBAND_FRACTION = 0.20;

/** Hard floor between two Plucks of the same String. 50ms = 20 plucks/sec,
 *  faster than a hand can wave, so it only ever suppresses jitter. */
const MIN_GAP_MS = 50;

/** The page-load Splash: held behind a Start prompt until the player's first
 *  gesture, so it can always play WITH sound — the autoplay policy forbids
 *  audio before that gesture on every browser, on every visit, with no
 *  exception, so the Splash simply waits for it instead of racing it. */
const SPLASH_MS = 1600; // total, including the pick's fade-out
const SPLASH_PICK_AT = 380; // ms before the pick starts moving
const SPLASH_PICK_MS = 620; // ms for the pick to cross the full width

/** The Flourish: fires on the Entry Gate click, the first moment sound is
 *  legal. Guitar-strum speed. */
const STRUM_MS = 30; // ms between strings
/** Quiet on purpose: eight voices 30ms apart at higher velocity clip. */
const STRUM_VELOCITY = 0.4;

const PLUCK_GLOW_MS = 450;
// ────────────────────────────────────────────────────────────────────────────

const strings = buildStrings(STRING_COUNT, ROOT_FREQ);
const crossingOpts: CrossingOptions = {
  count: STRING_COUNT,
  deadbandFraction: DEADBAND_FRACTION,
  minGapMs: MIN_GAP_MS,
};

const stage = document.querySelector<HTMLCanvasElement>("[data-testid='play-area']")!;
const stageCtx = stage.getContext("2d")!;
const gate = document.querySelector<HTMLElement>("[data-testid='entry-gate']")!;
const startPrompt = document.querySelector<HTMLElement>("[data-testid='tap-to-start']")!;
const startButton = document.querySelector<HTMLButtonElement>("[data-testid='start-button']")!;
const useCameraBtn = document.querySelector<HTMLButtonElement>("[data-testid='use-camera']")!;
const usePointerBtn = document.querySelector<HTMLButtonElement>("[data-testid='use-pointer']")!;
const controls = document.querySelector<HTMLElement>("#controls")!;
const switchInputBtn = document.querySelector<HTMLButtonElement>("#switch-input")!;
const preview = document.querySelector<HTMLVideoElement>("[data-testid='camera-preview']")!;
const cameraPanel = document.querySelector<HTMLElement>("#camera-panel")!;
const debugCanvas = document.querySelector<HTMLCanvasElement>("#debug-overlay")!;
const debugReadout = document.querySelector<HTMLElement>("#debug-readout")!;
const cameraView = document.querySelector<HTMLCanvasElement>("#camera-view")!;
const cameraStatus = document.querySelector<HTMLElement>("#camera-status")!;

const audio = createAudioEngine();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type InputMode = "camera" | "pointer";
type Phase = "start" | "splash" | "gate" | "playing";

let phase: Phase = "start";
let currentMode: InputMode | null = null;
let handTracker: HandTracker | null = null;
let cameraTracker: CameraTracker | null = null;
let pointerInput: PointerInput | null = null;
let cameraStream: MediaStream | null = null;

let crossings = createCrossingState(STRING_COUNT);
let markerX = 0.5;
let lastMagnitude = 0;
let lastPlucked: number | null = null;
const markerTrail: number[] = []; // recent Positions, for the Debug Overlay
const MARKER_TRAIL_LEN = 24;
const pluckedAt = strings.map(() => -Infinity);
const recentPlucks: number[] = []; // timestamps, for the debug plucks/sec figure

let splashStartedAt: number | null = null;
let splashStrummed = false;

let stageWidth = 0;
let stageHeight = 0;

function resizeStage(): void {
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  stageWidth = rect.width;
  stageHeight = rect.height;
  stage.width = stageWidth * dpr;
  stage.height = stageHeight * dpr;
  stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeStage);

function firePluck(index: number, velocity: number): void {
  const s = strings[index];
  audio.pluck(s.freq, velocity);
  const now = performance.now();
  pluckedAt[index] = now;
  lastPlucked = index;
  recentPlucks.push(now);
}

function handlePosition(sample: PositionSample): void {
  markerX = sample.x;
  lastMagnitude = sample.magnitude;
  markerTrail.push(sample.x);
  if (markerTrail.length > MARKER_TRAIL_LEN) markerTrail.shift();
  for (const index of detectCrossings(crossings, sample.x, performance.now(), crossingOpts)) {
    firePluck(index, sample.magnitude);
  }
}

function setStatus(text: string | null): void {
  cameraStatus.textContent = text ?? "";
  cameraStatus.hidden = text === null;
}

function stopInputs(): void {
  handTracker?.stop();
  handTracker = null;
  cameraTracker?.stop();
  cameraTracker = null;
  pointerInput?.stop();
  pointerInput = null;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  preview.hidden = true;
  cameraView.hidden = true;
  cameraPanel.hidden = true;
  debugCanvas.hidden = true;
  debugReadout.hidden = true;
  setStatus(null);
  crossings = createCrossingState(STRING_COUNT);
}

/** Crossing is a fact about movement between two samples, so when tracking
 *  lapses the previous sample must be forgotten — otherwise the next detection
 *  reads as one enormous jump and plucks every String in between. */
function resetCrossings(): void {
  crossings = createCrossingState(STRING_COUNT);
}

/**
 * Camera mode tries the Hand Tracker first — a real landmark model, which is
 * the only thing that actually knows a hand from a head (ADR 0003) — and drops
 * to the motion-diff Camera Tracker only if the model cannot load, since that
 * needs the network and a WASM runtime. Motion tracking is a worse instrument
 * but it is better than no camera at all.
 */
async function startCamera(): Promise<void> {
  stopInputs();
  currentMode = "camera";
  cameraPanel.hidden = false;
  cameraPanel.classList.toggle("debug", DEBUG_OVERLAY);
  debugReadout.hidden = !DEBUG_OVERLAY;
  cameraView.hidden = false;
  setStatus("Loading hand tracking…");

  const tracker = new HandTracker(cameraView, {
    onPosition: handlePosition,
    onLost: resetCrossings,
    drawExtra: drawLinesOnCamera,
    onStatus: (status, message) => {
      if (handTracker !== tracker) return; // a later start() superseded us
      if (status === "loading") setStatus("Loading hand tracking…");
      else if (status === "no-hand") setStatus("Show me a hand");
      else if (status === "closed") setStatus("Open your palm to play");
      else if (status === "error") setStatus(message ?? "Hand tracking failed");
      else setStatus(null);
    },
  });
  handTracker = tracker;

  if (await tracker.start()) return;
  if (handTracker !== tracker) return; // superseded while the model was loading

  handTracker = null;
  cameraView.hidden = true;
  await startMotionCamera();
}

/** Fallback Input Source: motion-diff on a plain video element. */
async function startMotionCamera(): Promise<void> {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    console.error("Camera unavailable, falling back to pointer input", err);
    // startPointer() calls stopInputs(), which clears the status — so the
    // message must be set *after* the fallback, not before it.
    startPointer();
    setStatus("Camera unavailable — switched you to touch / mouse.");
    return;
  }
  preview.srcObject = cameraStream;
  preview.hidden = false;
  cameraPanel.hidden = false;
  debugCanvas.hidden = !DEBUG_OVERLAY;
  cameraTracker = new CameraTracker(preview, handlePosition);
  cameraTracker.start();
  setStatus("Hand tracking unavailable — using motion tracking.");
}

function startPointer(): void {
  stopInputs();
  currentMode = "pointer";
  pointerInput = new PointerInput(stage, handlePosition);
  pointerInput.start();
}

function startInput(mode: InputMode): void {
  phase = "playing";
  controls.hidden = false;
  if (mode === "camera") void startCamera();
  else startPointer();
}

/**
 * The page-load Splash: the Strings rise in and a pick sweeps across them,
 * plucking each as it passes. Then the Entry Gate appears.
 *
 * Only ever called from `beginExperience`, i.e. from inside a real gesture —
 * so `audio.resume()` here is resolving a promise already made legal, not
 * hoping one becomes legal later, and the Splash can always play with sound.
 */
function runSplash(): void {
  phase = "splash";
  gate.hidden = true;
  splashStartedAt = performance.now();
  void audio.resume();

  const total = reduceMotion ? 500 : SPLASH_MS;
  window.setTimeout(() => {
    splashStartedAt = null;
    phase = "gate";
    gate.hidden = false;
  }, total);
}

/**
 * One-shot: the first gesture of any kind — anywhere on the page, not just the
 * Start button — begins the experience. Called from inside that gesture, so
 * `audio.resume()` is guaranteed legal, and the Splash that follows is never
 * silent.
 */
function beginExperience(): void {
  if (phase !== "start") return; // a digit key already skipped straight to playing
  startPrompt.hidden = true;
  void audio.resume();
  runSplash();
}

window.addEventListener("pointerdown", beginExperience, { once: true });
window.addEventListener("keydown", beginExperience, { once: true });
startButton.addEventListener("click", beginExperience);

/** The strum: every String in turn at guitar speed, ringing together. */
function runFlourish(): void {
  strings.forEach((_s, i) => {
    window.setTimeout(() => firePluck(i, STRUM_VELOCITY), i * STRUM_MS);
  });
}

/**
 * The Splash's strum, aligned to wherever the pick has already got to — so if
 * audio only becomes legal partway through the sweep, the notes still land
 * under the pick rather than restarting the sequence.
 */
function strumWithPick(): void {
  if (splashStrummed) return;
  splashStrummed = true;
  const elapsed = performance.now() - (splashStartedAt ?? performance.now());
  strings.forEach((_s, i) => {
    const at = SPLASH_PICK_AT + lineX(i, STRING_COUNT) * SPLASH_PICK_MS - elapsed;
    window.setTimeout(() => firePluck(i, STRUM_VELOCITY), Math.max(0, at));
  });
}

function enter(mode: InputMode): void {
  // Called, not awaited — see runSplash. The policy needs resume() to happen
  // inside the gesture; it does not need us to wait for it.
  void audio.resume();
  gate.hidden = true;
  runFlourish();
  // Not blocking: the visual introduction already happened at page load, so
  // making the player wait a second time after clicking would only delay them.
  // They can strum straight through the Flourish, which is the point.
  startInput(mode);
}

useCameraBtn.addEventListener("click", () => enter("camera"));
usePointerBtn.addEventListener("click", () => enter("pointer"));

switchInputBtn.addEventListener("click", () => {
  if (currentMode === "camera") startPointer();
  else void startCamera();
});

// Keyboard is a third, independent Input Source (spec: "mouse, keyboard or
// touch"): each digit key plucks its String directly, with no Position/
// Crossing tracking needed, so it works whichever Input Mode is active (or
// none at all) and needs no permission.
const KEY_TO_STRING = new Map(strings.map((s, i) => [String(i + 1), s]));

window.addEventListener("keydown", (e) => {
  if (e.repeat) return; // held key must not re-pluck, same discipline as Crossing
  const s = KEY_TO_STRING.get(e.key);
  if (!s) return;
  if (phase !== "playing") {
    // Someone who reaches for a key already knows what they want — give them
    // the note, and skip whatever introduction is still running.
    void audio.resume();
    splashStartedAt = null;
    gate.hidden = true;
    phase = "playing";
    controls.hidden = false;
  }
  firePluck(s.index, 0.7);
});

function stringPx(index: number): number {
  return lineX(index, STRING_COUNT) * stageWidth;
}

/** 0 before the splash's strings appear, 1 once they're fully in. */
function splashFade(elapsed: number): number {
  if (reduceMotion) return 1;
  return Math.min(1, elapsed / SPLASH_PICK_AT);
}

function drawStrings(now: number, fade: number): void {
  strings.forEach((_s, i) => {
    const x = stringPx(i);
    const age = now - pluckedAt[i];
    const glow = Math.max(0, 1 - age / PLUCK_GLOW_MS);
    const hue = (i / strings.length) * 300;
    const top = (1 - fade) * stageHeight * 0.5;

    stageCtx.beginPath();
    const segments = 10;
    for (let seg = 0; seg <= segments; seg++) {
      const t = seg / segments;
      const sway = Math.sin(t * Math.PI * 3 + i) * 3 + Math.sin(now / 700 + i) * (2 + glow * 8);
      stageCtx.lineTo(x + sway, top + t * (stageHeight - top * 2));
    }
    stageCtx.globalAlpha = fade;
    stageCtx.strokeStyle = `hsl(${hue} 75% ${55 + glow * 25}%)`;
    stageCtx.lineWidth = 4 + glow * 10;
    stageCtx.lineCap = "round";
    stageCtx.shadowColor = `hsl(${hue} 90% 60%)`;
    stageCtx.shadowBlur = glow * 35;
    stageCtx.stroke();
    stageCtx.shadowBlur = 0;
    stageCtx.globalAlpha = 1;
  });
}

function drawPick(elapsed: number): void {
  const t = (elapsed - SPLASH_PICK_AT) / SPLASH_PICK_MS;
  if (t < 0 || t > 1.35) return;

  const x = Math.min(1, t) * stageWidth;
  const fade = t <= 1 ? 1 : 1 - (t - 1) / 0.35;

  const trail = stageCtx.createLinearGradient(x - 90, 0, x, 0);
  trail.addColorStop(0, "rgba(255, 209, 102, 0)");
  trail.addColorStop(1, "rgba(255, 209, 102, 0.55)");
  stageCtx.globalAlpha = fade;
  stageCtx.fillStyle = trail;
  stageCtx.fillRect(x - 90, 0, 90, stageHeight);

  stageCtx.beginPath();
  stageCtx.moveTo(x, 0);
  stageCtx.lineTo(x, stageHeight);
  stageCtx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  stageCtx.lineWidth = 3;
  stageCtx.shadowColor = "#ffd166";
  stageCtx.shadowBlur = 24;
  stageCtx.stroke();
  stageCtx.shadowBlur = 0;
  stageCtx.globalAlpha = 1;
}

function drawMarker(): void {
  const mx = markerX * stageWidth;
  stageCtx.beginPath();
  stageCtx.arc(mx, stageHeight - 22, 9, 0, Math.PI * 2);
  stageCtx.fillStyle = "rgba(35, 30, 45, 0.85)";
  stageCtx.fill();
}

/**
 * The boundary lines, each line's Deadband and the tracked Position, drawn onto
 * the Hand Tracker's own canvas. Runs inside the tracker's draw call, after the
 * frame and the landmarks, in the same mirrored space — so what you see your
 * hand touching is what the Crossing logic is judging.
 */
function drawLinesOnCamera(c: CanvasRenderingContext2D, w: number, h: number): void {
  if (!DEBUG_OVERLAY) return;
  const deadbandPx = DEADBAND_FRACTION * lineSpacing(STRING_COUNT) * w;
  const now = performance.now();

  strings.forEach((s, i) => {
    const x = lineX(i, STRING_COUNT) * w;
    const glow = Math.max(0, 1 - (now - pluckedAt[i]) / PLUCK_GLOW_MS);

    c.fillStyle = "rgba(255, 209, 102, 0.14)";
    c.fillRect(x - deadbandPx, 0, deadbandPx * 2, h);

    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.strokeStyle = glow > 0 ? `rgba(255, 120, 160, ${0.5 + glow * 0.5})` : "rgba(255,255,255,0.45)";
    c.lineWidth = glow > 0 ? 3 : 1;
    c.stroke();

    c.fillStyle = "rgba(255,255,255,0.85)";
    c.font = "9px system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText(s.label, x, 11);
  });

  // Position after smoothing and Reach Gain — which is what actually plucks,
  // and is deliberately not the same as the raw landmark ring the tracker drew.
  const mx = markerX * w;
  c.beginPath();
  c.moveTo(mx, 0);
  c.lineTo(mx, h);
  c.strokeStyle = "#39ff88";
  c.lineWidth = 2;
  c.stroke();
}

function drawDebugOverlay(): void {
  const frameW = debugCanvas.clientWidth;
  const frameH = debugCanvas.clientHeight;
  if (frameW === 0 || frameH === 0) return;

  const dpr = window.devicePixelRatio || 1;
  if (debugCanvas.width !== frameW * dpr || debugCanvas.height !== frameH * dpr) {
    debugCanvas.width = frameW * dpr;
    debugCanvas.height = frameH * dpr;
  }
  const c = debugCanvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, frameW, frameH);

  // The video is CSS-mirrored; this canvas is not, and the tracker's x is
  // already inverted to match — so drawing at `x * width` lands where the
  // player sees their hand. Do not mirror this canvas.
  const deadbandPx = DEADBAND_FRACTION * lineSpacing(STRING_COUNT) * frameW;
  const now = performance.now();

  strings.forEach((s, i) => {
    const x = lineX(i, STRING_COUNT) * frameW;
    const glow = Math.max(0, 1 - (now - pluckedAt[i]) / PLUCK_GLOW_MS);

    c.fillStyle = "rgba(255, 209, 102, 0.16)";
    c.fillRect(x - deadbandPx, 0, deadbandPx * 2, frameH);

    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, frameH);
    c.strokeStyle = glow > 0 ? `rgba(255, 120, 160, ${0.5 + glow * 0.5})` : "rgba(255,255,255,0.5)";
    c.lineWidth = glow > 0 ? 3 : 1;
    c.stroke();

    c.fillStyle = "rgba(255,255,255,0.85)";
    c.font = "9px system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText(s.label, x, frameH - 4);
  });

  // What the tracker is actually looking at. If these bars pile up over your
  // torso instead of your hand, the tracking is not the problem the deadband
  // or the gain can solve — that is the "it follows my body" failure, and the
  // orange bar marks the column it locked onto.
  const energy = cameraTracker?.lastEnergy ?? [];
  const peak = cameraTracker?.lastPeak ?? -1;
  if (energy.length > 0) {
    const maxE = Math.max(...energy, 1);
    const bw = frameW / energy.length;
    energy.forEach((e, i) => {
      const h = (e / maxE) * (frameH * 0.32);
      c.fillStyle = i === peak ? "rgba(255, 160, 60, 0.95)" : "rgba(57, 255, 136, 0.45)";
      c.fillRect(i * bw + 0.5, frameH - h, bw - 1, h);
    });
  }

  // Trail: where Position has been, so lag shows up as a tail behind your hand.
  markerTrail.forEach((tx, i) => {
    const a = (i + 1) / markerTrail.length;
    c.beginPath();
    c.arc(tx * frameW, frameH * 0.28, 2 + a * 2, 0, Math.PI * 2);
    c.fillStyle = `rgba(57, 255, 136, ${a * 0.5})`;
    c.fill();
  });

  const mx = markerX * frameW;
  c.beginPath();
  c.moveTo(mx, 0);
  c.lineTo(mx, frameH);
  c.strokeStyle = "#39ff88";
  c.lineWidth = 2;
  c.stroke();
  c.beginPath();
  c.arc(mx, frameH / 2, 5 + lastMagnitude * 14, 0, Math.PI * 2);
  c.fillStyle = "rgba(57, 255, 136, 0.35)";
  c.fill();

  writeReadout(deadbandPx, peak, energy.length);
}

function writeReadout(deadbandPx: number, peak = -1, columns = 0): void {
  const now = performance.now();
  while (recentPlucks.length && now - recentPlucks[0] > 1000) recentPlucks.shift();
  const last = lastPlucked === null ? "—" : `${strings[lastPlucked].label} (${lastPlucked + 1})`;
  const lines = [
    `source    ${handTracker ? "hand landmarks" : cameraTracker ? "motion (fallback)" : "pointer"}`,
    `x         ${markerX.toFixed(3)}`,
    `magnitude ${lastMagnitude.toFixed(3)}`,
    `last      ${last}`,
    `plucks/s  ${recentPlucks.length}`,
    `deadband  ${DEADBAND_FRACTION} (${deadbandPx.toFixed(1)}px)`,
    `min gap   ${MIN_GAP_MS}ms`,
  ];
  if (handTracker) {
    lines.push(`landmark  ${handTracker.trackedLandmark}`);
    lines.push(
      `palm      ${handTracker.lastLandmarks ? (handTracker.lastOpen ? "open" : "closed") : "—"}`,
    );
  } else if (columns > 0) {
    lines.push(
      `peak col  ${peak < 0 ? "—" : `${peak}/${columns} (x≈${((peak + 0.5) / columns).toFixed(2)})`}`,
    );
  }
  debugReadout.textContent = lines.join("\n");
}

function render(): void {
  stageCtx.clearRect(0, 0, stageWidth, stageHeight);
  const now = performance.now();

  if (phase === "start") {
    // Waiting on the Start prompt: same not-yet-introduced look the Splash
    // itself opens on, so beginning the Splash a moment later is seamless.
    drawStrings(now, splashFade(0));
  } else if (phase === "splash" && splashStartedAt !== null) {
    // Polled, not promised: the moment audio is actually running, the Splash
    // starts sounding. `runSplash` only ever runs from inside a real gesture
    // (see `beginExperience`), so this is a matter of *when* resume()
    // resolves, not *whether* it ever will.
    if (!splashStrummed && audio.running()) strumWithPick();
    const elapsed = now - splashStartedAt;
    // The pick has no audio to trigger yet, so it lights each String itself as
    // it passes — the glow is what carries the introduction.
    if (!reduceMotion) {
      const pickX = (elapsed - SPLASH_PICK_AT) / SPLASH_PICK_MS;
      strings.forEach((_s, i) => {
        if (pluckedAt[i] === -Infinity && pickX >= lineX(i, STRING_COUNT)) pluckedAt[i] = now;
      });
    }
    drawStrings(now, splashFade(elapsed));
    if (!reduceMotion) drawPick(elapsed);
  } else {
    drawStrings(now, 1);
    if (phase === "playing") drawMarker();
  }

  if (DEBUG_OVERLAY && currentMode === "camera") {
    // The Hand Tracker paints its own canvas from its own loop (including the
    // boundary lines, via drawExtra), so here we only keep its numbers fresh.
    if (handTracker) writeReadout(DEADBAND_FRACTION * lineSpacing(STRING_COUNT) * 224);
    else if (!debugCanvas.hidden) drawDebugOverlay();
  }

  requestAnimationFrame(render);
}

resizeStage();
requestAnimationFrame(render);
