import { describe, expect, it } from "vitest";
import { focusedCentroid, summedLuminance } from "./cameraTracker.ts";

// Tiny synthetic RGBA frames so the tracking math can be checked without a real
// canvas/video. Each pixel is 4 bytes (R,G,B,A); alpha is irrelevant.
//
// These are sanity checks on the seam, not a claim that the tracking feels
// right — that is judged on a real camera, and a synthetic scene has now
// misled me three times about real behaviour (see ADR 0002). They exist to
// catch a wiring mistake: a flipped axis, a threshold that lets noise through.
function frame(size: number, fill: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = fill(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

const SIZE = 8;
const room = frame(SIZE, () => 50);
const background = summedLuminance(room, SIZE);
const prev = summedLuminance(room, SIZE);

describe("focusedCentroid", () => {
  it("finds nothing when the frame still matches the room", () => {
    expect(focusedCentroid(background, prev, room, SIZE, 4)).toBeNull();
  });

  it("locks left when the only new, moving thing is on the left", () => {
    const curr = frame(SIZE, (x) => (x < SIZE / 2 ? 220 : 50));
    const result = focusedCentroid(background, prev, curr, SIZE, 4);
    expect(result).not.toBeNull();
    expect(result!.x).toBeLessThan(0.5);
  });

  it("locks right when the only new, moving thing is on the right", () => {
    const curr = frame(SIZE, (x) => (x >= SIZE / 2 ? 220 : 50));
    const result = focusedCentroid(background, prev, curr, SIZE, 4);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThan(0.5);
  });

  it("ignores sub-threshold noise", () => {
    const curr = frame(SIZE, () => 51); // tiny 1-level flicker
    expect(focusedCentroid(background, prev, curr, SIZE, 4)).toBeNull();
  });

  it("ignores something present but not moving", () => {
    const body = frame(SIZE, (x) => (x < SIZE / 2 ? 220 : 50));
    const settled = summedLuminance(body, SIZE);
    expect(focusedCentroid(background, settled, body, SIZE, 4)).toBeNull();
  });
});
