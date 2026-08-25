# Process overview

## What I built

A camera-and-touch strum harp: eight boundary lines laid out left-to-right
across the screen, tuned to a scale, that ring when a tracked point — a hand
in front of the camera, or a finger/mouse on touch/pointer — crosses them.
The idea started from seeing a classmate's (comp4020-ass1-Januaraine) camera
hand-tracking work for an unrelated assignment and wanting the same input for
sound instead of motion.

## The moments that mattered

1. **What happened**: the first working version
   ([`2b83ffd`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-edwarbudiman/commit/2b83ffd69edc8508ebe25564e4218acd18a92a6a))
   used plain frame-to-frame motion diffing (`columnMotionCentroid`) as the
   only camera input — no hand model, just "which columns changed the most
   between two frames." It played, but tracking felt wrong the moment a head
   or torso was in frame: anything that moved competed with the hand for the
   centroid.
   **What I did instead of the obvious thing**: rather than re-prompting for
   a better threshold or smoothing constant, I asked for the actual failure
   mode to be measured on synthetic frames rather than guessed at, which
   produced two concrete, named bugs — recorded as decisions, not just fixed
   in place: ADR 0002 measured that diffing against the *previous* frame
   makes direction unrecoverable on a fast stroke (a 0.30→0.75 sweep reported
   as 0.298), and that diffing against an *adapting background* fixes that
   but then tracks a whole torso instead of a hand (0.514 regardless of where
   the hand was). ADR 0003 is the conclusion those two failures point to: no
   arrangement of motion-diff signals knows what a hand is, so camera input
   was rebuilt on MediaPipe's `HandLandmarker` — a real detected hand
   landmark — with the old motion-diff tracker kept only as a fallback for
   when that model can't load.
   **How I knew it was right**: the ADRs' own measurements (span shrinking
   from 0.90 to 0.54 with a moving head in frame, before the fix), then
   playing it live with a head deliberately bobbing in frame — the harp
   stayed locked on the hand instead of drifting toward the head, and
   `pnpm check` (typecheck, build, all 30 vitest cases) stayed green through
   the rewrite of `cameraTracker.ts` and `strings.ts`'s crossing detection.
   **Citation**:
   [`2b83ffd...f95a809`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-edwarbudiman/compare/2b83ffd69edc8508ebe25564e4218acd18a92a6a...f95a809)
   (see `docs/adr/0002-background-model-not-frame-diff.md` and
   `docs/adr/0003-hand-landmarks-for-camera-input.md` for the measurements).

2. **What happened**: the same commit's full-width sweep test — eight
   strings plucked in fast succession — clipped audibly at the original
   `MASTER_GAIN` of 0.8.
   **What I did instead of the obvious thing**: instead of ear-balancing a
   lower gain by feel, I asked for the actual worst case (8 voices 37ms
   apart at full velocity) to be measured against the ±1.0 ceiling, which is
   what settled on 0.6 (peaks at 0.99) rather than an arbitrary "turn it
   down a bit."
   **How I knew it was right**: played a deliberate full-width sweep after
   the change and it no longer clipped, at either input source.
   **Citation**:
   [`f95a809`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-edwarbudiman/commit/f95a809)

3. **What happened**: `strings.ts` originally plucked by discrete "zone,"
   so a hand parked near a boundary could re-trigger on camera jitter with
   no way to damp it.
   **What I did instead of the obvious thing**: rather than adding a
   one-off debounce timer around the existing zone model, the crossing
   model itself was replaced with boundary-line crossings that carry a
   deadband (a line must be moved clear of before it re-arms) and a minimum
   gap in milliseconds — a structural fix in the harness the instrument
   plays against, not a patch around a symptom.
   **How I knew it was right**: the rewritten `strings.test.ts` cases
   (pruned to the arithmetic that can be silently wrong — string count,
   ascending scale — rather than asserting exact frequencies) plus playing
   a hand held still directly on a line and confirming it doesn't
   machine-gun.
   **Citation**:
   [`f95a809`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-edwarbudiman/commit/f95a809)

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that a
reflection entry the marker reads is in `reflections/`, and that your
`CLAUDE.md` is there --- before a marker ever opens the file. It checks that
your map is traceable, not that it is good: the marker judges whether your
small, deliberately chosen set of moments shows real judgement and reflection. A
green check is not a substitute for that curation.

Images aren't checked: whether one renders is visible the moment you look. Open
this file on GitHub and look at it before you ship.
