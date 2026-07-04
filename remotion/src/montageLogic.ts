// Montage timeline logic — PURE, unit-tested. type aliases (not interfaces) so props
// satisfy Remotion's Record<string, unknown> constraint.

export type MontageSegmentProp = {
  videoPath: string; from: number; durationInFrames: number;
  startFromFrames: number; playbackRate: number; freeze: boolean; zoom: boolean; shake: boolean;
};

export type MontageFlashProp = { at: number; frames: number; kind: 'white' | 'red' | 'black' | 'glitch' | 'blur' };

export type MontageCounterProp = { at: number; value: number };

export type MontageProps = {
  segments: MontageSegmentProp[]; flashes: MontageFlashProp[];
  counter: MontageCounterProp[]; counterLabel: string;
  musicPath: string; musicVolume: number; musicStartFromFrames: number;
  payoffImagePath: string;   // '' = none
  payoffAtFrame: number;
  fps: number;
};

/** PURE: total composition length = end of the last segment (min 1, never zero-duration). */
export function totalMontageFrames(segments: MontageSegmentProp[]): number {
  return Math.max(1, ...segments.map((s) => s.from + s.durationInFrames));
}
