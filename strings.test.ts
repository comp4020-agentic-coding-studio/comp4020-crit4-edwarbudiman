import { describe, expect, it } from "vitest";
import { buildScale, buildStrings, crossingsBetween, zoneAt } from "./strings.ts";

describe("buildScale", () => {
  it("returns the requested count of frequencies", () => {
    expect(buildScale(7, 220)).toHaveLength(7);
  });

  it("starts on the root frequency", () => {
    expect(buildScale(5, 220)[0]).toBe(220);
  });

  it("wraps the pentatonic pattern up an octave after 5 steps", () => {
    const freqs = buildScale(6, 220);
    expect(freqs[5]).toBeCloseTo(440);
  });

  it("is monotonically increasing", () => {
    const freqs = buildScale(10, 220);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    }
  });
});

describe("buildStrings", () => {
  it("indexes strings 0..count-1 in ascending pitch order", () => {
    const strings = buildStrings(7, 220);
    expect(strings.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(strings.map((s) => s.freq)).toEqual(buildScale(7, 220));
  });
});

describe("zoneAt", () => {
  it("maps the left edge to zone 0", () => {
    expect(zoneAt(0, 7)).toBe(0);
  });

  it("maps the right edge (just under 1) to the last zone", () => {
    expect(zoneAt(0.999, 7)).toBe(6);
  });

  it("clamps out-of-range x", () => {
    expect(zoneAt(-0.5, 7)).toBe(0);
    expect(zoneAt(1.5, 7)).toBe(6);
  });

  it("divides the range into equal zones", () => {
    expect(zoneAt(0.5, 4)).toBe(2);
  });
});

describe("crossingsBetween", () => {
  it("returns nothing when the zone hasn't changed (jitter inside one string)", () => {
    expect(crossingsBetween(2, 2)).toEqual([]);
  });

  it("returns the single zone entered on a one-step move", () => {
    expect(crossingsBetween(2, 3)).toEqual([3]);
  });

  it("rings every zone skipped by a fast sweep, in order", () => {
    expect(crossingsBetween(2, 5)).toEqual([3, 4, 5]);
  });

  it("works in the reverse direction too", () => {
    expect(crossingsBetween(5, 2)).toEqual([4, 3, 2]);
  });

  it("never re-enters the starting zone", () => {
    expect(crossingsBetween(0, 6)).not.toContain(0);
  });
});
