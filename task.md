Judgement week: an agent can build a synth but can't hear the result, so your ear is the harness.

turn the browser into a musical instrument — something a stranger can pick up and play

Interpret instrument as broadly as you like: a theremin driven by the mouse, a drum machine, a step sequencer, wind chimes that never repeat, a keyboard that plays chords — if a person acts and the page sounds, it counts. The Web Audio API does the synthesis, it’s all client-side, and the whole thing ships straight to GitHub Pages. The bar is playability: the player’s choices shape what they hear, two people at the same page sound different, and there’s no way to get it wrong — no score, no fail state. (Hold that thought for C5.)

The building blocks are few: an OscillatorNode or an AudioBufferSourceNode through a GainNode, all hung off one AudioContext and driven by pointer or keyboard events. The context starts suspended until a user gesture resumes it (the autoplay policy), so nothing sounds before the player’s first tap. MDN’s simple synth is a worked example.

This week’s crit opens cold: your pod plays the instrument before you say a word. The pod then discusses the sound, the interaction, and whether it’s any good. After that you can talk and explain your instrument. Latency, feel, whether a gesture is expressive or just exhausting: none of that shows up in a test suite or a Lighthouse score.

The spec
The brief on this page poses the problem and leaves room for your response. The spec is the fixed contract: what your tutor considers when judging whether that response meets the requirements. Some lines can be checked mechanically; the rest call for human judgement.

deployed and live at its public GitHub Pages URL by the cutoff
the browser is the instrument — sound is made live in the page by the player, not played back
it is expressive: the player's choices shape what they hear, and two players sound different
a stranger can play it uninstructed — the opening screen invites the first sound
playable with whatever is at hand — mouse, keyboard or touch
there is no way to play it wrong — no score, no fail state
the starter's invariant checks pass
the repo shows the process — commits that grew with the work, a process overview in PROCESS.md, and the week's reflection in reflections/crit-4.md
you can account for how you directed, grounded and corrected the work
