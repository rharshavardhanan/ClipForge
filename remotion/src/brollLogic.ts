/**
 * Narrative-overlay presentation math (v6) — PURE, unit-tested. B-roll fades in/out fast
 * (6 frames) so cuts feel intentional, and drifts with a slow Ken Burns push (1.0 → 1.06)
 * so the overlay never reads as a freeze-frame.
 */
export const FADE_FRAMES = 6;
export const KEN_BURNS_SCALE = 0.06;

export type BrollWindow = { videoPath: string; from: number; durationInFrames: number };

/** Opacity of an overlay at a frame LOCAL to its sequence (0..durationInFrames). */
export function brollOpacityAt(localFrame: number, durationInFrames: number): number {
  const fade = Math.min(FADE_FRAMES, Math.max(1, Math.floor(durationInFrames / 2)));
  if (localFrame < fade) return localFrame / fade;
  const untilEnd = durationInFrames - localFrame;
  if (untilEnd < fade) return Math.max(0, untilEnd / fade);
  return 1;
}

/** Ken Burns scale at a local frame: linear 1.0 → 1.0 + KEN_BURNS_SCALE over the window. */
export function brollScaleAt(localFrame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 1;
  const progress = Math.min(1, Math.max(0, localFrame / durationInFrames));
  return 1 + KEN_BURNS_SCALE * progress;
}

/** True when any overlay window covers the given frame (used to pause A-roll-only chrome). */
export function brollActiveAt(windows: BrollWindow[], frame: number): boolean {
  return windows.some((w) => frame >= w.from && frame < w.from + w.durationInFrames);
}
