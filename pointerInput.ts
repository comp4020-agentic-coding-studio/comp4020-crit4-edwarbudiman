// Pointer Input (CONTEXT.md): the other Input Source. Derives Position
// straight from pointer coordinates over the play area. The Pointer Events
// API unifies mouse and touch, so this one path covers both without
// special-casing touch.

import type { PositionListener } from "./cameraTracker.ts";

export class PointerInput {
  private lastX: number | null = null;
  private lastT: number | null = null;

  constructor(
    private area: HTMLElement,
    private onPosition: PositionListener,
  ) {}

  start(): void {
    this.area.addEventListener("pointermove", this.handleMove);
    this.area.addEventListener("pointerleave", this.handleLeave);
  }

  stop(): void {
    this.area.removeEventListener("pointermove", this.handleMove);
    this.area.removeEventListener("pointerleave", this.handleLeave);
    this.lastX = null;
    this.lastT = null;
  }

  private handleMove = (e: PointerEvent): void => {
    const rect = this.area.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const now = performance.now();

    if (this.lastX !== null && this.lastT !== null) {
      const dt = Math.max(1, now - this.lastT);
      const speed = Math.abs(x - this.lastX) / dt; // normalized units per ms
      const magnitude = Math.min(1, speed * 40);
      if (magnitude > 0) this.onPosition({ x, magnitude });
    }

    this.lastX = x;
    this.lastT = now;
  };

  private handleLeave = (): void => {
    this.lastX = null;
    this.lastT = null;
  };
}
