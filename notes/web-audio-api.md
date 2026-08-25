# Web Audio API — research notes

Primary sources only: [MDN Web Audio API docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) and the [W3C Web Audio API spec](https://www.w3.org/TR/webaudio/). Written for this repo's task (`task.md`): a browser instrument, played live, built on the Web Audio API, shipped as a static site.

## Core model: a graph, not a callback

Audio is a **modular routing graph**: sources → processing nodes → destination, all owned by one [`AudioContext`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext) ([MDN: Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)). Every node has 0+ inputs and 0+ outputs; you build the graph with `node.connect(otherNode)`. `AudioContext.destination` is the terminal node — the speakers ([MDN: Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)). Nothing is audible unless a chain reaches `destination`.

MDN's recommendation: create **one** `AudioContext` for the whole page and reuse it — "it's OK to use a single AudioContext for several different audio sources and pipeline concurrently" ([MDN: AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)). For an instrument, this means one global context, with new source nodes (oscillators, buffer sources) created per note/hit and thrown away after use.

## Autoplay policy — the thing task.md calls out, and the easiest thing to get wrong

A fresh `AudioContext` starts in state `"suspended"` unless created inside a user gesture handler; browsers enforce this because unsolicited autoplaying audio is "annoying and obtrusive" ([MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)). The W3C spec formalizes this as **allowed-to-start**:

> "An AudioContext is said to be allowed to start if the user agent allows the context state to transition from 'suspended' to 'running'. A user agent may disallow this initial transition, and to allow it only when the AudioContext's relevant global object has sticky activation." ([W3C Web Audio API §AudioContext](https://www.w3.org/TR/webaudio/#AudioContext))

Practical pattern ([MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)):

```js
const audioCtx = new AudioContext(); // created eagerly, may be "suspended"

el.addEventListener("pointerdown", () => {
  if (audioCtx.state === "suspended") audioCtx.resume();
  // ... trigger the sound
});
```

`resume()` — "Resumes the progression of time in an audio context that has previously been suspended/paused" — and `suspend()`/`close()` are the matching lifecycle methods ([MDN: AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)). The gotcha for this task: **the very first pointer/key event on the page must both resume the context and produce a sound**, or the "opening screen invites the first sound" requirement silently fails on every browser that enforces the policy (which is all of them). Test this in an actual fresh tab, not a tab that already has other audio playing — that can mask a missing `resume()` call.

## Sound sources

### OscillatorNode — tones

[`OscillatorNode`](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode) generates a periodic waveform. `type` is one of `"sine"` (default), `"square"`, `"sawtooth"`, `"triangle"`, or `"custom"` (via `setPeriodicWave()`). `frequency` (Hz, default 440) and `detune` (cents, 100 = one semitone) are both a-rate `AudioParam`s, so they can be scheduled/automated rather than just set ([MDN: OscillatorNode](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode)).

**An oscillator can only be started once.** After `stop()`, it's dead — create a new node for the next note. To play/pause a note without recreating the oscillator, gate it through a `GainNode` instead ([MDN: OscillatorNode](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode)). This is *the* pattern for a keyboard-style instrument: one persistent oscillator per active voice, gain envelope opens on note-on and closes (then the oscillator is stopped/discarded) on note-off.

### AudioBufferSourceNode — samples and noise

[`AudioBufferSourceNode`](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode) plays an in-memory `AudioBuffer` — a decoded sample, or a buffer you fill yourself (e.g. white noise for percussion). `loop`, `loopStart`, `loopEnd` control repeat playback. Same one-shot limitation as oscillators:

> "An AudioBufferSourceNode can only be played once; after each call to start(), you have to create a new node if you want to play the same sound again." ([MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode))

The underlying `AudioBuffer` itself *is* reusable across many source nodes — decode/generate it once, spin up a cheap new `AudioBufferSourceNode` per trigger. MDN notes these nodes are inexpensive and self-garbage-collect after playback, so "fire and forget" per-hit nodes (drum machine, percussive clicks) are the idiomatic approach ([MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)).

## GainNode — volume and envelopes

[`GainNode`](https://developer.mozilla.org/en-US/docs/Web/API/GainNode) multiplies every sample by its `gain` value (unitless, a-rate `AudioParam`). It has no methods of its own; all control is through `gain`. MDN's explicit warning: **don't set `gain.value` directly** for anything audible mid-stream — a step change causes an audible click. Use the automation methods instead ([MDN: GainNode](https://developer.mozilla.org/en-US/docs/Web/API/GainNode)).

## AudioParam automation — the scheduling primitive behind every envelope

[`AudioParam`](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam) methods schedule changes against `AudioContext.currentTime`, not wall-clock time or `Date.now()`:

- `setValueAtTime(value, time)` — instant jump at `time`.
- `linearRampToValueAtTime(value, endTime)` — straight-line ramp from the previous scheduled value to `value`, ending at `endTime`.
- `exponentialRampToValueAtTime(value, endTime)` — exponential ramp. **Cannot target `0`** — the curve is asymptotic to zero, so `0` is invalid; use a small value like `0.0001` instead ([MDN: AudioParam](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam)).
- `setTargetAtTime(target, startTime, timeConstant)` — exponential approach toward `target`, controlled by `timeConstant` (seconds) — the natural choice for a decay tail that shouldn't hit a hard endpoint.
- `cancelScheduledValues(cancelTime)` — clears everything scheduled from `cancelTime` onward; the value at that instant becomes the new baseline.

Key mechanic: each `AudioParam` holds an internal **event list**; once any automation event is scheduled, direct `.value =` assignment is ignored ([MDN: AudioParam](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam)). A four-stage envelope (attack/decay/sustain/release) is just a chain of these calls on a `GainNode.gain`:

```js
const now = audioCtx.currentTime;
gain.gain.setValueAtTime(0, now);
gain.gain.linearRampToValueAtTime(1, now + 0.02);   // attack
gain.gain.linearRampToValueAtTime(0.6, now + 0.15); // decay to sustain
// ...on release:
gain.gain.setTargetAtTime(0, releaseTime, 0.1);     // release tail
```

Params are also **a-rate** (per-sample) or **k-rate** (per 128-sample block, i.e. per render quantum) depending on the node — e.g. `DynamicsCompressorNode`'s params are k-rate, while `OscillatorNode.frequency`/`GainNode.gain`/`StereoPannerNode.pan` are a-rate ([MDN: AudioParam](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam), [MDN: DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode), [MDN: StereoPannerNode](https://developer.mozilla.org/en-US/docs/Web/API/StereoPannerNode)).

## Other nodes worth having in the toolbox

| Node | What it does | Instrument use |
|---|---|---|
| [`BiquadFilterNode`](https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode) | Low-order filter: `lowpass`/`highpass`/`bandpass`/`notch`/`peaking`/shelf/`allpass`, with `frequency`, `Q`, `gain` params | Sweep a lowpass cutoff with mouse X/Y for a classic filter-wobble; tame harsh square/sawtooth tones |
| [`AnalyserNode`](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode) | Non-destructive FFT/time-domain tap (`getByteFrequencyData`, `getByteTimeDomainData`) | Drive a visual (waveform/spectrum canvas) from what's actually playing — reinforces "the player's choices shape what they hear" visually, not just audibly |
| [`StereoPannerNode`](https://developer.mozilla.org/en-US/docs/Web/API/StereoPannerNode) | `pan` a-rate param, −1 (left) to 1 (right) | Map pointer X to stereo position for spatial feedback |
| [`ConvolverNode`](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode) | Convolves signal with an impulse-response buffer | Cheap reverb/space if you ship a small IR file (adds an asset + fetch/decode step — weigh against "all client-side, ships to Pages" simplicity) |
| [`DynamicsCompressorNode`](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode) | Reduces gain above `threshold` by `ratio`, with `attack`/`release`/`knee` | Sit on the master bus so many simultaneous voices (chords, fast drumming) don't clip when several oscillators/buffers sum at `destination` |

## MDN's worked example: Simple Synth Keyboard

Task.md points directly at this: [MDN: Simple synth keyboard](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Simple_synth). Its shape:

```
OscillatorNode (per key, created on note-on) → shared GainNode (master volume) → destination
```

- One `OscillatorNode` is created per key-press (`notePressed()`), connected to a single shared `mainGainNode`, and `stop()`/discarded on release (`noteReleased()`) — consistent with oscillators being one-shot.
- Both `mousedown`/`mouseup`/`mouseover`/`mouseleave` and `keydown`/`keyup` drive the same note-on/note-off functions, so pointer and keyboard playing are unified at the event-handler level, not duplicated per input type.
- A waveform picker swaps `osc.type`, including a `"custom"` path via `setPeriodicWave()`.
- The volume slider is a live `mainGainNode.gain.value` binding (acceptable here since it's a UI-driven, non-envelope control, not a scheduled event — no click risk from continuous slider input at typical rates).

## Translating this into instrument options for the brief

The brief's bar: player's choices shape the sound, two players sound different, no wrong way to play, playable uninstructed, client-side only, shipped to GitHub Pages. Some shapes the API supports directly:

- **Theremin (mouse/touch position → pitch & volume).** One persistent `OscillatorNode` → `GainNode` → `destination`. On `pointermove`, map X to `frequency.linearRampToValueAtTime(...)` and Y to `gain.linearRampToValueAtTime(...)` over a short window (~20–50ms) so movement sounds continuous rather than clicking. Silence = gain 0 at rest; the *lack* of a fixed scale is itself what makes it unlearnable-wrong.
- **Step sequencer.** A `setInterval`/`requestAnimationFrame`-driven scheduler that, each step, creates a short-lived oscillator or buffer source with a fast attack/decay gain envelope (`setValueAtTime` + `exponentialRampToValueAtTime` to ~0.0001) for whichever steps are toggled on. Scheduling ahead of `currentTime` (look-ahead scheduling) avoids jitter from JS timer imprecision — worth a dedicated small scheduler function rather than triggering exactly on the timer tick.
- **Drum machine.** Short `AudioBufferSourceNode`s (either decoded samples or procedurally generated noise buffers) through per-hit `GainNode` envelopes; a shared `DynamicsCompressorNode` on the bus keeps simultaneous hits from clipping.
- **Wind chimes that never repeat.** Randomize `detune` (and/or `frequency`) per note within a constrained scale/range so hits are always slightly different but stay harmonically related; trigger on a random or physics-ish timer (e.g. tied to pointer velocity/idle drift) rather than a fixed grid, since "never repeats" and "no fail state" both point away from quantized timing.
- **Chorded keyboard.** Multiple simultaneous key events each spin up their own oscillator → individual (or per-voice) `GainNode`s → a shared bus `GainNode`/compressor → `destination`, exactly extending the Simple Synth pattern to multi-key chords instead of monophonic single notes.

Across all of these, the two load-bearing primitives are the same: **AudioParam scheduling** (for anything that should sound smooth rather than clicky) and **one-shot source nodes created per trigger** (since oscillators and buffer sources can't be restarted). Get the autoplay-resume-on-first-gesture right once, globally, and every one of these designs plugs into the same context/destination.
