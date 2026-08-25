import { createAudioEngine } from "./audio.ts";
import { CameraTracker, type PositionSample } from "./cameraTracker.ts";
import { PointerInput } from "./pointerInput.ts";
import { buildStrings, crossingsBetween, zoneAt } from "./strings.ts";

const STRING_COUNT = 7;
const ROOT_FREQ = 220; // A3
const PLUCK_GLOW_MS = 450;

const strings = buildStrings(STRING_COUNT, ROOT_FREQ);

const stage = document.querySelector<HTMLCanvasElement>("[data-testid='play-area']")!;
const stageCtx = stage.getContext("2d")!;
const gate = document.querySelector<HTMLElement>("[data-testid='entry-gate']")!;
const useCameraBtn = document.querySelector<HTMLButtonElement>("[data-testid='use-camera']")!;
const usePointerBtn = document.querySelector<HTMLButtonElement>("[data-testid='use-pointer']")!;
const controls = document.querySelector<HTMLElement>("#controls")!;
const switchInputBtn = document.querySelector<HTMLButtonElement>("#switch-input")!;
const flipCameraBtn = document.querySelector<HTMLButtonElement>("#flip-camera")!;
const preview = document.querySelector<HTMLVideoElement>("[data-testid='camera-preview']")!;
const cameraError = document.querySelector<HTMLElement>("#camera-error")!;

const audio = createAudioEngine();

type InputMode = "camera" | "pointer";

let currentMode: InputMode | null = null;
let cameraTracker: CameraTracker | null = null;
let pointerInput: PointerInput | null = null;
let cameraStream: MediaStream | null = null;
let facingMode: "environment" | "user" = "environment";

let prevZone: number | null = null;
let markerX = 0.5;
const pluckedAt = strings.map(() => -Infinity);

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

function handlePosition(sample: PositionSample): void {
  markerX = sample.x;
  const zone = zoneAt(sample.x, strings.length);

  if (prevZone === null) {
    prevZone = zone;
    return;
  }

  for (const z of crossingsBetween(prevZone, zone)) {
    const s = strings[z];
    audio.pluck(s.freq, sample.magnitude);
    pluckedAt[z] = performance.now();
  }
  prevZone = zone;
}

function stopInputs(): void {
  cameraTracker?.stop();
  cameraTracker = null;
  pointerInput?.stop();
  pointerInput = null;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  preview.hidden = true;
  flipCameraBtn.hidden = true;
  cameraError.hidden = true;
  prevZone = null;
}

async function startCamera(): Promise<void> {
  stopInputs();
  currentMode = "camera";
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: false,
    });
  } catch (err) {
    console.error("Camera unavailable, falling back to pointer input", err);
    // startPointer() calls stopInputs(), which resets cameraError.hidden — so
    // the error must be shown *after* the fallback, not before it.
    startPointer();
    cameraError.hidden = false;
    return;
  }
  preview.srcObject = cameraStream;
  preview.hidden = false;
  flipCameraBtn.hidden = false;
  cameraTracker = new CameraTracker(preview, handlePosition);
  cameraTracker.start();
}

function startPointer(): void {
  stopInputs();
  currentMode = "pointer";
  pointerInput = new PointerInput(stage, handlePosition);
  pointerInput.start();
}

async function enter(mode: InputMode): Promise<void> {
  await audio.resume(); // requested inside this gesture handler, per the autoplay policy
  gate.hidden = true;
  controls.hidden = false;
  if (mode === "camera") await startCamera();
  else startPointer();
}

useCameraBtn.addEventListener("click", () => void enter("camera"));
usePointerBtn.addEventListener("click", () => void enter("pointer"));

switchInputBtn.addEventListener("click", () => {
  if (currentMode === "camera") startPointer();
  else void startCamera();
});

flipCameraBtn.addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  void startCamera();
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
  if (!gate.hidden) {
    void audio.resume();
    gate.hidden = true;
    controls.hidden = false;
  }
  audio.pluck(s.freq, 0.7);
  pluckedAt[s.index] = performance.now();
});

function stringX(index: number): number {
  return ((index + 0.5) / strings.length) * stageWidth;
}

function render(): void {
  stageCtx.clearRect(0, 0, stageWidth, stageHeight);
  const now = performance.now();

  strings.forEach((_s, i) => {
    const x = stringX(i);
    const age = now - pluckedAt[i];
    const glow = Math.max(0, 1 - age / PLUCK_GLOW_MS);
    const hue = (i / strings.length) * 300;

    stageCtx.beginPath();
    const segments = 10;
    for (let seg = 0; seg <= segments; seg++) {
      const t = seg / segments;
      const sway = Math.sin(t * Math.PI * 3 + i) * 3 + Math.sin(now / 700 + i) * (2 + glow * 8);
      stageCtx.lineTo(x + sway, t * stageHeight);
    }
    stageCtx.strokeStyle = `hsl(${hue} 75% ${55 + glow * 25}%)`;
    stageCtx.lineWidth = 4 + glow * 10;
    stageCtx.lineCap = "round";
    stageCtx.shadowColor = `hsl(${hue} 90% 60%)`;
    stageCtx.shadowBlur = glow * 35;
    stageCtx.stroke();
    stageCtx.shadowBlur = 0;
  });

  const mx = markerX * stageWidth;
  stageCtx.beginPath();
  stageCtx.arc(mx, stageHeight - 22, 9, 0, Math.PI * 2);
  stageCtx.fillStyle = "rgba(35, 30, 45, 0.85)";
  stageCtx.fill();

  requestAnimationFrame(render);
}

resizeStage();
requestAnimationFrame(render);
