import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Mechanically-checkable lines from this week's spec (task.md); the rest
// (expressiveness, feel, "no way to play it wrong") are for the crit, not a
// test file. Runs against the built site, per spec/README.md.
const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

describe("entry gate: a stranger can play uninstructed", () => {
  it("offers both a camera and a touch/mouse way in", () => {
    expect(doc.querySelector('[data-testid="entry-gate"]')).toBeTruthy();
    expect(doc.querySelector('[data-testid="use-camera"]')).toBeTruthy();
    expect(doc.querySelector('[data-testid="use-pointer"]')).toBeTruthy();
  });
});

describe("playable with whatever is at hand", () => {
  it("has a play area that accepts pointer/touch input", () => {
    expect(doc.querySelector('[data-testid="play-area"]')).toBeTruthy();
  });

  it("ships a module script that wires up keyboard/camera/pointer input", () => {
    // Presence check: the built page loads the bundled instrument script.
    // Behaviour itself needs a live browser, not jsdom (no getUserMedia, no
    // AudioContext, no canvas pixel data here).
    expect(doc.querySelector("script[type='module'][src]")).toBeTruthy();
  });
});

describe("camera is optional, never a gate", () => {
  it("keeps the camera preview hidden until a camera is actually granted", () => {
    const preview = doc.querySelector('[data-testid="camera-preview"]');
    expect(preview?.hasAttribute("hidden")).toBe(true);
  });
});
