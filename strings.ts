// Pure logic for the instrument's Strings (CONTEXT.md): a diatonic major
// Scale laid out left-to-right, and the boundary-line Crossing detection that
// decides which Strings a moving Position plucks.
//
// Crossing is judged against a *line* per String, sitting at that String's
// drawn position — so what you see and what you hear are the same coordinate.
// Crossing a line in either direction plucks it, which is what makes waving
// back and forth over one String repeat that String.

// Major scale, semitones above the root: do re mi fa sol la si.
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGE = ["do", "re", "mi", "fa", "sol", "la", "si"];

export interface StringDef {
  index: number;
  freq: number;
  /** "do", "re", … "si", then "do'" an octave up — for the debug readout. */
  label: string;
}

/** Frequencies for `count` Strings, cycling the major pattern up an octave at a time. */
export function buildScale(count: number, rootFreq: number): number[] {
  const freqs: number[] = [];
  for (let i = 0; i < count; i++) {
    const octave = Math.floor(i / MAJOR_STEPS.length);
    const step = MAJOR_STEPS[i % MAJOR_STEPS.length];
    const semitones = step + octave * 12;
    freqs.push(rootFreq * Math.pow(2, semitones / 12));
  }
  return freqs;
}

export function buildStrings(count: number, rootFreq: number): StringDef[] {
  return buildScale(count, rootFreq).map((freq, index) => ({
    index,
    freq,
    label: SOLFEGE[index % SOLFEGE.length] + "'".repeat(Math.floor(index / SOLFEGE.length)),
  }));
}

/** Normalized x (0..1) of String `index`'s boundary line — also where it's drawn. */
export function lineX(index: number, count: number): number {
  return (index + 0.5) / count;
}

/** Normalized gap between adjacent boundary lines. */
export function lineSpacing(count: number): number {
  return 1 / count;
}

export interface CrossingOptions {
  count: number;
  /** How far past a line the Position must travel before that line re-arms, as a fraction of line spacing. */
  deadbandFraction: number;
  /** A line cannot pluck twice within this many milliseconds. */
  minGapMs: number;
}

export interface CrossingState {
  prevX: number | null;
  armed: boolean[];
  lastPluckAt: number[];
}

export function createCrossingState(count: number): CrossingState {
  return {
    prevX: null,
    armed: new Array(count).fill(true),
    lastPluckAt: new Array(count).fill(-Infinity),
  };
}

/**
 * Which Strings the Position plucked moving to `x`, in travel order.
 *
 * A line fires when the segment between the previous and current Position
 * passes it, in either direction. Two guards stop a hand parked on a line
 * from machine-gunning it on camera noise: the line disarms after firing and
 * only re-arms once the Position has moved a deadband clear of it, and it
 * cannot fire twice inside `minGapMs`.
 *
 * Mutates `state` — the state is the whole point, since Crossing is a fact
 * about movement between samples, not about a single Position.
 */
export function detectCrossings(
  state: CrossingState,
  x: number,
  now: number,
  opts: CrossingOptions,
): number[] {
  const { count, deadbandFraction, minGapMs } = opts;
  const deadband = deadbandFraction * lineSpacing(count);

  // Re-arm every line the Position has moved clear of, before judging crossings.
  for (let i = 0; i < count; i++) {
    if (!state.armed[i] && Math.abs(x - lineX(i, count)) > deadband) state.armed[i] = true;
  }

  const prev = state.prevX;
  state.prevX = x;
  if (prev === null) return []; // first sample establishes a position, plucks nothing

  const lo = Math.min(prev, x);
  const hi = Math.max(prev, x);

  // Half-open: a line exactly at the previous Position isn't crossed again.
  const passed: number[] = [];
  for (let i = 0; i < count; i++) {
    const lx = lineX(i, count);
    if (lx > lo && lx <= hi) passed.push(i);
  }
  if (x < prev) passed.reverse(); // travel order, so a fast sweep rings left-to-right or right-to-left

  const fired: number[] = [];
  for (const i of passed) {
    if (!state.armed[i]) continue;
    if (now - state.lastPluckAt[i] < minGapMs) continue;
    state.armed[i] = false;
    state.lastPluckAt[i] = now;
    fired.push(i);
  }
  return fired;
}
