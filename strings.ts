// Pure logic for the instrument's Strings (CONTEXT.md): a fixed pentatonic
// Scale laid out left-to-right, and the Crossing detection that decides
// which Strings a moving Position plucks.

// Major pentatonic, semitones above the root: root, 2nd, 3rd, 5th, 6th.
const PENTATONIC_STEPS = [0, 2, 4, 7, 9];

export interface StringDef {
  index: number;
  freq: number;
}

/** Frequencies for `count` Strings, cycling the pentatonic pattern up an octave at a time. */
export function buildScale(count: number, rootFreq: number): number[] {
  const freqs: number[] = [];
  for (let i = 0; i < count; i++) {
    const octave = Math.floor(i / PENTATONIC_STEPS.length);
    const step = PENTATONIC_STEPS[i % PENTATONIC_STEPS.length];
    const semitones = step + octave * 12;
    freqs.push(rootFreq * Math.pow(2, semitones / 12));
  }
  return freqs;
}

export function buildStrings(count: number, rootFreq: number): StringDef[] {
  return buildScale(count, rootFreq).map((freq, index) => ({ index, freq }));
}

/** Which String's zone a normalized x (0..1) falls in. */
export function zoneAt(x: number, count: number): number {
  const clamped = Math.min(0.999999, Math.max(0, x));
  return Math.min(count - 1, Math.floor(clamped * count));
}

/**
 * Every zone boundary crossed moving from `prevZone` to `currZone`, in
 * order, excluding `prevZone` itself. Empty when the zone hasn't changed
 * (jitter inside one String plucks nothing). A multi-zone jump rings every
 * zone in between, so a fast sweep skips no notes.
 */
export function crossingsBetween(prevZone: number, currZone: number): number[] {
  if (prevZone === currZone) return [];
  const step = currZone > prevZone ? 1 : -1;
  const crossings: number[] = [];
  for (let z = prevZone + step; ; z += step) {
    crossings.push(z);
    if (z === currZone) break;
  }
  return crossings;
}
