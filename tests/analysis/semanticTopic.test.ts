import { describe, it, expect } from 'vitest';
import { topicOf, toWindow, type TranscriptChunk, type SemanticChunkResult } from '../../src/analysis/semantic.js';
import type { SemanticScores, SemanticWindow } from '../../src/types/index.js';

const zero: SemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};
const win = (start: number, end: number, topic: string): SemanticWindow => ({
  start, end, semantic_score: 5, scores: zero, hook_moment: '', clip_titles: [],
  is_standalone: true, recommended_duration: 30, sentiment: 'neutral', reason: '', topic,
});

describe('topicOf', () => {
  const semantic = [win(0, 30, 'gym motivation'), win(30, 60, 'childhood story')];
  it('returns the best-overlapping window topic', () => {
    expect(topicOf(5, 25, semantic)).toBe('gym motivation');
    expect(topicOf(35, 55, semantic)).toBe('childhood story');
  });
  it('empty when no overlap', () => {
    expect(topicOf(100, 130, semantic)).toBe('');
  });
});

describe('toWindow topic passthrough', () => {
  const chunk: TranscriptChunk = { start: 0, end: 30, text: 'x' };
  it('carries the topic from the chunk result', () => {
    const result = { scores: zero, hook_moment: '', clip_titles: [], is_standalone: true,
      recommended_duration: 30, sentiment: 'neutral', reason: '', topic: 'gym motivation' } as SemanticChunkResult;
    expect(toWindow(chunk, result).topic).toBe('gym motivation');
  });
  it('defaults topic to empty when the model omitted it (old cache)', () => {
    const result = { scores: zero, hook_moment: '', clip_titles: [], is_standalone: true,
      recommended_duration: 30, sentiment: 'neutral', reason: '' } as SemanticChunkResult;
    expect(toWindow(chunk, result).topic).toBe('');
  });
});
