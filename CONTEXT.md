# Browser Strum Instrument

A crit-4 prototype: a horizontal strum instrument played by hand movement (webcam)
or pointer/touch, built on the Web Audio API and shipped as a static site.

## Language

**String**:
A fixed pitch band occupying a horizontal zone of the frame, tuned to one note
of the Scale. Strings are laid out left to right in Scale order.
_Avoid_: key, note zone, band, column

**Scale**:
The fixed pentatonic set of pitches assigned to the Strings, chosen so any
order or combination of Strings sounds consonant.
_Avoid_: notes, keys

**Position**:
The current horizontal coordinate (plus recent velocity) describing where the
player is pointing, produced by whichever Input Source is active.
_Avoid_: hand position, cursor

**Crossing**:
The event of Position moving from outside a String's zone to inside it. A
Crossing is what triggers a Pluck; lingering or trembling inside a zone
without leaving it is not a Crossing. A fast movement that passes through
several Strings' zones between two samples produces a Crossing for each zone
passed through, in order.
_Avoid_: strum, wave, sweep, gesture

**Pluck**:
The audible (percussive note with attack/decay envelope) and visual (VFX on
that String) response to a Crossing. Louder/brighter the faster the Crossing
happened.
_Avoid_: note, trigger, hit

**Input Source**:
Whatever produces Position for the instrument to read. There are two: the
Camera Tracker and Pointer Input. Both feed the same Crossing/Pluck logic, so
the instrument behaves identically regardless of source.
_Avoid_: input method, controller

**Camera Tracker**:
An Input Source that derives Position by motion-diffing the live video feed —
tracking one moving region (whole hand), not individual fingers or a pose
skeleton.
_Avoid_: hand tracking, gesture recognition

**Pointer Input**:
An Input Source that derives Position directly from mouse or touch
coordinates on the page.

**Input Mode**:
Which Input Source is currently active (Camera or Pointer). Chosen at the
Entry Gate; switchable afterward without leaving the page.

**Entry Gate**:
The opening screen where the player picks an Input Mode. Selecting one both
starts audio (satisfies the browser's autoplay-gesture requirement) and puts
the player directly into playing — sound is available immediately, never
gated behind a separate "enable" step.

**Camera Preview**:
A small on-screen rectangle showing the raw video feed, for the player's own
reference (confirming they're in frame). Not the page background.

**Arm/Disarm Gesture** _(future, not yet implemented)_:
A parked idea: a vertical down-up motion arms the instrument, up-down disarms
it. Not part of the current build — noted here so the term isn't reused for
something else later.
