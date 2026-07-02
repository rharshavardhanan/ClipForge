import { describe, it, expect } from 'vitest';
import {
  buildValidatePrompt, buildValidateSchema, applyValidation,
  heuristicScore, heuristicValidation, LLM_THRESHOLD, HEURISTIC_THRESHOLD,
} from '../../src/broll/validate.js';
import type { BrollCandidate, BrollCue } from '../../src/types/index.js';

const cue = (query: string): BrollCue => ({ start: 5, end: 9, entity: query, kind: 'person', query });
const cand = (id: string, title: string): BrollCandidate => ({ id, url: `u/${id}`, title, durationSec: 120 });

describe('buildValidatePrompt', () => {
  it('numbers cues and candidates and demands strict scoring', () => {
    const p = buildValidatePrompt([cue('Toto Wolff Mercedes')], [[cand('a', 'Toto Wolff on 2024'), cand('b', 'cats')]]);
    expect(p).toContain('CUE 0');
    expect(p).toContain('0: "Toto Wolff on 2024"');
    expect(p).toContain('1: "cats"');
    expect(p).toContain('-1 if none fit');
  });
});

describe('applyValidation', () => {
  const cues = [cue('q1'), cue('q2')];
  const cands = [[cand('a', 'A')], [cand('b', 'B')]];
  it(`keeps only matches scoring > ${LLM_THRESHOLD} with a valid candidate index`, () => {
    const raw = { results: [
      { cue: 0, best: 0, score: 9 },
      { cue: 1, best: 0, score: 8 },        // exactly 8 = rejected (spec: >8)
      { cue: 1, best: -1, score: 10 },      // none fit
      { cue: 5, best: 0, score: 10 },       // out of range
    ] };
    const kept = applyValidation(raw, cues, cands);
    expect(kept).toHaveLength(1);
    expect(kept[0].candidate.id).toBe('a');
  });
  it('tolerates junk payloads', () => {
    expect(applyValidation(null, cues, cands)).toEqual([]);
    expect(applyValidation({ results: 'x' }, cues, cands)).toEqual([]);
  });
});

describe('heuristic fallback', () => {
  it('scores token overlap out of 10', () => {
    expect(heuristicScore('boxing training session', 'INTENSE boxing training session 2024')).toBe(10);
    expect(heuristicScore('boxing training session', 'cat videos compilation')).toBe(0);
  });
  it(`keeps the best candidate per cue at bar ${HEURISTIC_THRESHOLD}`, () => {
    const kept = heuristicValidation(
      [cue('boxing training session'), cue('dopamine brain animation')],
      [[cand('a', 'boxing training session hard'), cand('b', 'boxing gloves review')], [cand('c', 'minecraft')]],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].candidate.id).toBe('a');
  });
});
