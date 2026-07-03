import type { CurvePoint } from '../rankrot/signals.js';

export interface Drop {
  time: number;
  strength: number;
}

export type SectionKind = 'build' | 'drop' | 'cool';

export interface Section {
  kind: SectionKind;
  start: number;
  end: number;
}

export interface MusicMap {
  bpm: number;
  beats: number[];
  drops: Drop[];
  energy: CurvePoint[];
  sections: Section[];
  duration: number;
}

export interface MontageMoment {
  src: string;          // moment FILE path (extracted), not the source video
  start: number;        // always 0 for extracted files; kept for pure-fn testability
  dur: number;
  motionScore: number;  // 0-1 pool-normalized
  audioScore: number;   // 0-1
  cycleEvents: number[]; // times WITHIN the moment file (periodic reps), [] if none
}

export type FlashKind = 'white' | 'red' | 'black' | 'glitch' | 'blur';

export interface MontageSegment {
  src: string;
  srcStart: number;
  srcDur: number;
  playbackRate: number;
  freeze: boolean;
  zoom: boolean;
  shake: boolean;
}

export interface FlashEvent {
  time: number;
  kind: FlashKind;
  frames: number;
}

export interface CounterEvent {
  time: number;
  value: number;
}

export interface MontagePlan {
  segments: MontageSegment[];
  flashes: FlashEvent[];
  musicOffset: number;   // seconds into the track where the montage starts
  payoffAt: number;
  payoffDur: number;
  totalDur: number;
}
