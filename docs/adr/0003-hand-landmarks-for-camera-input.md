# Use a hand-landmark model for camera input, motion-diff as fallback

ADR 0001 chose motion-diffing over a hand model, and ADR 0002 records what
happened next: three rounds of tuning the motion approach, each validated
against synthetic frames, each fixing what the previous round broke, and the
player still reporting the tracked point wandering. The final round — weighting
motion by difference-from-background — measured best of all synthetically and
was reported *worse* in an actual room. That is the signal to stop.

The root cause never moved: motion-diffing does not know what a hand is. It
follows whichever part of the frame has the most energy, and a torso, a head,
or a sibling walking past all outrank a hand. Every fix was a heuristic
standing in for the thing the algorithm structurally lacks.

Camera input now uses **MediaPipe Tasks Vision `HandLandmarker`**: 21 landmarks
on an actual detected hand, and Position is one of them. Motion-diffing is kept
as a fallback for when the model cannot load.

What this costs, measured rather than estimated:

- **Bundle: 11 kB -> 171 kB JS** (52 kB gzipped). Only the JS API is bundled.
- **Runtime: ~7.8 MB model** from `storage.googleapis.com`, plus the WASM
  runtime from `cdn.jsdelivr.net` at a version pinned to the installed package.
  Both verified reachable. Neither is in the repo, so GitHub Pages serves the
  same tiny site it did before.
- **A third-party CDN dependency and a network requirement at runtime**, which
  ADR 0001 explicitly wanted to avoid. This is the real reversal. It is accepted
  because the model load happens behind the Splash, and because an instrument
  that tracks your torso is not an instrument.

What it buys beyond accuracy: the thing being tracked is now *nameable*. Position
comes from a specific landmark (thumb tip by default, tunable to index tip or
the steadier index knuckle), and "is the palm open" is computable rather than
guessed — so a closed fist mutes the instrument. That is the Arm/Disarm Gesture
CONTEXT.md parked at the start, now buildable because the model exposes fingers.

Two techniques taken from a classmate's COMP4020 assignment-1 prototype
(comp4020-ass1-Januaraine), which solves the same camera problem for an inverse
kinematics demo: exponential smoothing on the tracked landmark, and a ~300ms
grace window before treating a dropped detection as the hand leaving. The second
matters more than it looks — motion blur mid-strum drops frames routinely, and
without the grace window the marker flickers between tracked and lost, which
feels exactly like the ghosting we set out to remove. Their prototype needs a
whole arm chain and uses `HolisticLandmarker`; this needs one horizontal
coordinate, so `HandLandmarker` with `numHands: 1` is smaller and faster.

The lesson worth keeping from ADR 0002: a synthetic test scene validated three
consecutive fixes that did not hold up in a real room, because each time the
scene omitted whatever actually dominated the real signal. Cheap loops are worth
building, but a loop whose inputs you invented tells you about your invention.
