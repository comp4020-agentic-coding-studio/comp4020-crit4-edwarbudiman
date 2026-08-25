import { describe, expect, it } from "vitest";
import { buildScale, buildStrings } from "./strings.ts";

// Pruned deliberately. The Scale's tuning and the boundary-line Crossing feel
// are judged by ear on the dev server, not here — a passing assertion about
// 261.63Hz tells you nothing about whether the instrument sounds right. What's
// left is the arithmetic that would be silently, stupidly wrong: a miscounted
// row of Strings or a scale that stops ascending.

describe("buildScale", () => {
  it("returns the requested count of frequencies", () => {
    expect(buildScale(8, 261.6256)).toHaveLength(8);
  });

  it("starts on the root frequency", () => {
    expect(buildScale(8, 261.6256)[0]).toBe(261.6256);
  });

  it("is monotonically increasing", () => {
    const freqs = buildScale(12, 261.6256);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    }
  });
});

describe("buildStrings", () => {
  it("indexes strings 0..count-1 in ascending pitch order", () => {
    const strings = buildStrings(8, 261.6256);
    expect(strings.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(strings.map((s) => s.freq)).toEqual(buildScale(8, 261.6256));
  });
});
