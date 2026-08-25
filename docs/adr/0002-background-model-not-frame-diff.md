# Track what is both moving and not the room

ADR 0001 chose frame-differencing for the Camera Tracker. Two defects showed up
in play, and each of the obvious single-signal fixes has the other one.

**Differencing against the previous frame** sees the hand leave the old position
and arrive at the new one, and both register as motion. Measured on synthetic
frames, a hand crossing 0.30 to 0.75 of frame width in one sample was reported
at **0.298** — the departure point — and a stroke 0.35→0.65 was
*indistinguishable* from 0.65→0.35. Direction of travel was invisible, which for
an instrument whose entire input is "which way did your hand go" is fatal. The
player experienced it as the tracked point ghosting behind the hand.

**Differencing against an adapting background** fixes that (max error 0.009 on
the same sweep, directions clearly distinct) but replaces it with something
worse: it makes the whole *person* the signal, not the motion. A torso is far
larger than a hand. On a synthetic body silhouette — head, torso, arm, hand —
the tracker reported **0.514 regardless of where the hand was**, locked onto the
torso, only becoming accurate after the body sat still long enough to be
absorbed into the background. That is a marker parked near the middle that
barely answers the hand.

So we keep both signals and use their **product**: a column's energy is the sum
of `motion x foreground` over its pixels, counted only where both exceed the
noise threshold. The two failure modes cancel. A hand that has departed is
moving but is back to being room, so foreground is ~0. A settled torso is
foreground but not moving, so motion is ~0. Only something that is both
somewhere new *and* not the room survives.

Consequences worth naming. The difference magnitude no longer encodes speed, so
velocity is derived from how far Position moved between samples — the same way
Pointer Input always has, which makes Pluck loudness consistent across both
Input Sources for the first time. A hand held perfectly still is absorbed into
the background after ~2.1s and returns on the next movement.

**What this does not fix.** It still cannot tell a hand from a head, because
there is no model of a hand anywhere in it — it tracks whichever column has the
most new-and-moving energy. When the head moves more than the hand, the head
wins. ADR 0001's reasoning (no multi-MB model fetch, no CDN dependency, one
moving point rather than a skeleton) still holds, and this ADR does not reverse
it. But the honest record is that three successive rounds of tuning were each
validated against a synthetic scene that turned out not to represent the real
one, and each time the real failure was something the synthetic scene omitted.
A hand-landmark model is the only thing that makes "track my hand, not my head"
true rather than approximately true. The Debug Overlay now draws the per-column
energy histogram precisely so that this class of question can be answered by
looking rather than by guessing.
