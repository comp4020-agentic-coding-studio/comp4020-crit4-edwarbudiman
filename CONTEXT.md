# Browser Strum Instrument

A crit-4 prototype: a horizontal strum instrument played by hand movement (webcam)
or pointer/touch, built on the Web Audio API and shipped as a static site.

## Language

**String**:
A fixed pitch with a position — a vertical line at a known horizontal
coordinate, tuned to one note of the Scale. Strings are laid out left to right
in Scale order. A String is a line, not a band: the coordinate it is drawn at
is the same coordinate that judges a Crossing, which is why sight and sound
agree.
_Avoid_: key, note zone, band, column, zone

**Scale**:
The fixed set of pitches assigned to the Strings: a diatonic major scale
spanning exactly one octave, `do re mi fa sol la si do'`, rooted on C4 so that
"do" is literally middle C. Chosen because it is the scale a stranger already
has in their head — the row starts and ends home, and a sweep across it
resolves. This is a deliberate trade: unlike a pentatonic set, a major scale
_can_ be made to clash (the `fa`/`si` tritone, the `si`–`do'` semitone). The
instrument has no wrong note in the sense that matters — no score, no fail
state — but it no longer claims that every combination is consonant.
_Avoid_: notes, keys, pentatonic

**Position**:
The current horizontal coordinate (plus recent velocity) describing where the
player is pointing, produced by whichever Input Source is active.
_Avoid_: hand position, cursor

**Crossing**:
The event of Position passing over a String's line, in _either_ direction. A
Crossing is what triggers a Pluck, so waving back and forth over one String
repeats that String — the line is the judge, not the territory between lines.
A fast movement that passes several lines between two samples produces a
Crossing for each, in travel order. Two guards keep a hand held on a line from
machine-gunning it: the line disarms after firing and re-arms only once
Position has moved a Deadband clear of it, and it cannot fire twice inside a
minimum gap.
_Avoid_: strum, wave, sweep, gesture

**Deadband**:
How far clear of a String's line Position must travel before that line can
Pluck again, expressed as a fraction of the gap between lines. Exists because
the Camera Tracker's centroid is noisy: without it, a still hand resting on a
line would Pluck on every frame of jitter.
_Avoid_: threshold, tolerance, hysteresis

**Pluck**:
The audible (percussive note with attack/decay envelope) and visual (VFX on
that String) response to a Crossing. Louder/brighter the faster the Crossing
happened.
_Avoid_: note, trigger, hit

**Input Source**:
Whatever produces Position for the instrument to read: the Hand Tracker, the
Camera Tracker (its fallback) and Pointer Input. All feed the same
Crossing/Pluck logic, so the instrument behaves identically regardless of
source.
_Avoid_: input method, controller

**Hand Tracker**:
The primary camera Input Source: a hand-landmark model (MediaPipe
`HandLandmarker`) detects an actual hand and Position is read from one named
landmark of the 21 — the thumb tip by default, because on an open palm held up
to strum the thumb is the leading edge. Unlike the Camera Tracker it knows what
it is looking at, which is the whole point (ADR 0003). Needs the network on
first load; falls back to the Camera Tracker if the model cannot load.
_Avoid_: hand detection, MediaPipe, gesture recognition

**Palm Open**:
Whether at least three of the four fingers are extended, measured by each
fingertip sitting further from the wrist than that finger's own middle joint —
so it survives the hand moving nearer, further, or rotating. Only an open palm
produces Position: a closed fist is the mute. This is the Arm/Disarm Gesture
parked below, finally buildable now that the Input Source can see fingers.
_Avoid_: fist, gesture, pinch

**Smoothing**:
Exponential averaging applied to Position as it arrives, plus a short grace
window that holds the last known Position when a detection blinks out rather
than declaring the hand gone. The grace window is the less obvious half: motion
blur mid-strum drops frames routinely, and a marker flickering between tracked
and lost feels the same as a marker that wanders.
_Avoid_: filtering, lerp, damping

**Camera Tracker**:
The **fallback** camera Input Source, used only when the Hand Tracker's model
cannot load. Derives Position from the strongest column of
`motion x foreground` — the dominant thing that is both moving and not the
room — taking the centroid of a window around it rather than an average over
the whole frame. Always Mirrored,
then scaled by Reach Gain. Velocity comes from how far Position moved between
samples, not from the difference magnitude (ADR 0002).

It has no concept of a hand. It cannot distinguish a hand from a head, a
sibling walking past, or a curtain: it follows whatever moves most. Windowing
on the peak means a hand actively strumming wins over a head shifting in the
background; it does **not** help when the head moves more than the hand, and no
amount of tuning will make it. That limit is inherent to motion-diffing (ADR
0001) and is the thing a real hand-landmark model would buy.
_Avoid_: hand tracking, gesture recognition, hand detection

**Mirror**:
The horizontal inversion applied to the camera path so that moving your hand
to your right moves Position to the right. A front-facing camera hands over an
un-mirrored image, which would otherwise run the instrument backwards. It is
applied in two places that must agree — the inversion inside the Camera
Tracker and the CSS transform on the Camera Preview — and it is not
configurable: there is no correct reason for a player to want it off.
_Avoid_: flip, facing mode

**Pointer Input**:
An Input Source that derives Position directly from mouse or touch
coordinates on the page.

**Input Mode**:
Which Input Source is currently active (Camera or Pointer). Chosen at the
Entry Gate; switchable afterward without leaving the page.

**Entry Gate**:
The opening screen where the player picks an Input Mode. Selecting one starts
audio (satisfies the browser's autoplay-gesture requirement) and hands
straight to the Splash. Sound is never gated behind a separate "enable" step.

**Splash**:
The introduction that runs the moment the page opens, before the Entry Gate:
the Strings rise into place and a pick sweeps left to right, lighting each as
it passes. Then the Entry Gate appears.

The Splash is **silent, and cannot be otherwise** — the browser's autoplay
policy keeps the AudioContext suspended until the player's first gesture, and
at page load there hasn't been one. This is a browser rule, not a design
choice. The sound half of the introduction is the Flourish.
_Avoid_: intro, loading screen, tutorial

**Flourish**:
The strum that fires the instant the player picks an Input Mode — every String
in turn at guitar speed, ringing together. It is the earliest moment sound is
legal, so it is where the instrument gets to show off its voice. It does not
block: the player can strum straight through it, which is the point.
_Avoid_: fanfare, jingle, chord

**Background Model**:
A running average of the video feed that stands for "the room". Used together
with frame-to-frame motion, never alone: Position is the strongest column of
`motion x foreground`, so it tracks only what is both somewhere new *and* not
the room. Motion alone reported the hand's departure point on fast strokes and
could not see direction; foreground alone locked onto the torso, which is much
larger than a hand (ADR 0002). A hand held perfectly still is gradually
absorbed into the Model and stops being tracked, returning the moment it moves.
_Avoid_: reference frame, previous frame, baseline

**Reach Gain**:
How far Position is pushed away from centre before it reaches the Strings,
because arm reach is smaller than the camera's field of view. Without it a
player sweeping the middle 70% of frame width can never touch the outer
Strings, however good the tracking is — measured, that left 6 of 8 Strings
playable, and 4 of 8 once head motion was included. Camera only: Pointer Input
is already 1:1 with the screen.
_Avoid_: sensitivity, calibration

**Debug Overlay**:
Testing scaffolding, switched by a constant in `main.ts`: it enlarges the
Camera Preview and draws the boundary lines, each line's Deadband, the tracked
Position with a trail of where it has just been, the per-column energy
histogram with the locked column marked, and a live readout. The histogram is
the important one — it is what distinguishes "the tracking needs tuning" from
"the tracker is looking at my torso". Exists because the two things that need
tuning by ear — whether the Mirror is right and whether the Deadband is right
— are invisible otherwise. Off in the shipped instrument.
_Avoid_: dev mode, debug panel

**Camera Preview**:
A small on-screen rectangle showing the raw video feed, for the player's own
reference (confirming they're in frame). Not the page background.

**Arm/Disarm Gesture** _(superseded by Palm Open)_:
The parked idea was a vertical down-up motion to arm the instrument. It existed
because motion-diffing could not see a hand well enough to do anything better.
Palm Open replaces it: an open hand plays, a fist does not, which is more
obvious to a stranger than a directional flick and needs no explanation.
