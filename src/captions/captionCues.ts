/**
 * Readability-constrained caption cues (v4 Part 3 §7.2): pack word tokens into cues that
 * respect line width, line count, reading speed, and an anti-flash minimum duration.
 * Text comes only from the ASR/json3 word tokens — never invented (Part 1 §2.2). PURE.
 */
import type { CaptionWord } from '../types/index.js';

export interface CaptionCue { start: number; end: number; lines: string[]; }

export interface CueConstraints {
  maxCharsPerLine: number;
  maxLines: number;
  maxReadingCps: number;   // chars/sec a viewer comfortably reads
  minCueSec: number;       // anti-flash floor
}

// maxReadingCps 27: short-form captions run faster than prose-reading limits because the
// viewer also HEARS the words — timing is locked to speech, so this is an advisory ceiling
// (flagged, not a hard reject) rather than something the builder can slow down.
export const DEFAULT_CUE_CONSTRAINTS: CueConstraints = {
  maxCharsPerLine: 24, maxLines: 2, maxReadingCps: 27, minCueSec: 0.7,
};

/** PURE: greedily pack words into width/line-limited cues (never splitting a word), then
 *  extend any sub-minCueSec cue up to the next cue's start. */
export function buildCaptionCues(words: CaptionWord[], c: CueConstraints = DEFAULT_CUE_CONSTRAINTS): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let lines: string[] = [];
  let line = '';
  let cueStart = 0;
  let cueEnd = 0;

  for (const word of words) {
    const t = word.text.trim();
    if (!t) continue;
    if (lines.length === 0 && line === '') { cueStart = word.start; }
    const candidate = line ? `${line} ${t}` : t;
    if (candidate.length <= c.maxCharsPerLine) {
      line = candidate;
    } else {
      // current line is full — commit it, then start a fresh line (or a fresh cue if full)
      if (line) { lines.push(line); line = ''; }
      if (lines.length >= c.maxLines) {
        cues.push({ start: cueStart, end: cueEnd, lines });
        lines = [];
        cueStart = word.start;
      }
      line = t;
    }
    cueEnd = word.end;
  }
  if (line) lines.push(line);
  if (lines.length > 0) cues.push({ start: cueStart, end: cueEnd, lines });

  // Anti-flash: stretch short cues toward the next cue's start.
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].end - cues[i].start < c.minCueSec) {
      const cap = cues[i + 1]?.start ?? cues[i].start + c.minCueSec;
      cues[i].end = Math.min(cues[i].start + c.minCueSec, cap);
    }
  }
  return cues;
}

/** PURE: a cue exceeds the reading-speed budget when chars/duration > maxReadingCps. */
export function cueViolatesReadingSpeed(cue: CaptionCue, maxReadingCps: number): boolean {
  const chars = cue.lines.join(' ').length;
  const dur = Math.max(cue.end - cue.start, 1e-6);
  return chars / dur > maxReadingCps;
}
