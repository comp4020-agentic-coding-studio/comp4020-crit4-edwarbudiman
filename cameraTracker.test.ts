import { describe, expect, it } from "vitest";
import { columnMotionCentroid } from "./cameraTracker.ts";

// Tiny synthetic RGBA frames (4x4) so the motion math can be checked without
// a real canvas/video. Each pixel is 4 bytes (R,G,B,A); alpha is irrelevant.
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

describe("columnMotionCentroid", () => {
  it("reports no magnitude when nothing moved", () => {
    const size = 8;
    const still = frame(size, () => 100);
    const result = columnMotionCentroid(still, still, size, 4);
    expect(result.magnitude).toBe(0);
  });

  it("centroid sits on the left when motion is only on the left", () => {
    const size = 8;
    const prev = frame(size, () => 50);
    const curr = frame(size, (x) => (x < size / 2 ? 220 : 50));
    const result = columnMotionCentroid(prev, curr, size, 4);
    expect(result.magnitude).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(0.5);
  });

  it("centroid sits on the right when motion is only on the right", () => {
    const size = 8;
    const prev = frame(size, () => 50);
    const curr = frame(size, (x) => (x >= size / 2 ? 220 : 50));
    const result = columnMotionCentroid(prev, curr, size, 4);
    expect(result.magnitude).toBeGreaterThan(0);
    expect(result.x).toBeGreaterThan(0.5);
  });

  it("ignores sub-threshold noise", () => {
    const size = 8;
    const prev = frame(size, () => 100);
    const curr = frame(size, () => 101); // tiny 1-level flicker
    const result = columnMotionCentroid(prev, curr, size, 4);
    expect(result.magnitude).toBe(0);
  });
});
