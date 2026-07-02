import { describe, it, expect } from 'vitest';
import { MODE_PROFILES, detectMode, resolveMode, meanSubscores } from '../src/modes.js';
import type { SemanticWindow, VideoMetadata } from '../src/types/index.js';

function meta(over: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    jobId: 'j', title: 'Untitled', duration: 600, width: 1920, height: 1080, fps: 30,
    codec: 'h264', chapters: [], description: '', ...over,
  };
}

function sw(scores: Partial<SemanticWindow['scores']>, over: Partial<SemanticWindow> = {}): SemanticWindow {
  return {
    start: 0, end: 30, semantic_score: 5,
    scores: {
      emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
      wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0, ...scores,
    },
    hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 30,
    sentiment: 'neutral', reason: '', ...over,
  };
}

describe('MODE_PROFILES', () => {
  it('clippies is short + aggressive, mindcuts is long + story-first with B-roll', () => {
    expect(MODE_PROFILES.clippies.lengths.max).toBe(45);
    expect(MODE_PROFILES.clippies.brollDefault).toBe(false);
    expect(MODE_PROFILES.clippies.zoomIntensity).toBe(1);
    expect(MODE_PROFILES.mindcuts.lengths.max).toBe(60);
    expect(MODE_PROFILES.mindcuts.brollDefault).toBe(true);
    expect(MODE_PROFILES.mindcuts.zoomIntensity).toBeLessThan(1);
    expect(MODE_PROFILES.mindcuts.maxBroll).toBeGreaterThan(MODE_PROFILES.clippies.maxBroll);
  });
});

describe('detectMode', () => {
  it('podcast/interview keywords → mindcuts', () => {
    expect(detectMode(meta({ title: 'Joe Rogan Experience #2041 - guest' }), [])).toBe('mindcuts');
    expect(detectMode(meta({ title: 'How I built my company — founder interview' }), [])).toBe('mindcuts');
  });
  it('gaming/reaction keywords → clippies', () => {
    expect(detectMode(meta({ title: 'INSANE stream highlights (rage moments)' }), [])).toBe('clippies');
  });
  it('semantic tally decides when title is neutral', () => {
    const funny = [sw({ humor: 9, surprise: 8 }), sw({ humor: 8, emotional_intensity: 7 })];
    expect(detectMode(meta(), funny)).toBe('clippies');
    const wise = [sw({ wisdom: 9, storytelling_tension: 8 }), sw({ wisdom: 8, relatability: 7 })];
    expect(detectMode(meta(), wise)).toBe('mindcuts');
  });
  it('falls back to duration: long → mindcuts, short → clippies', () => {
    expect(detectMode(meta({ duration: 2 * 3600 }), [])).toBe('mindcuts');
    expect(detectMode(meta({ duration: 8 * 60 }), [])).toBe('clippies');
  });
});

describe('resolveMode', () => {
  it('explicit flag wins over detection', () => {
    expect(resolveMode('clippies', meta({ title: 'podcast episode' }), []).name).toBe('clippies');
    expect(resolveMode('mindcuts', meta({ title: 'gaming fails' }), []).name).toBe('mindcuts');
  });
  it('auto/undefined detects', () => {
    expect(resolveMode('auto', meta({ title: 'stream highlights' }), []).name).toBe('clippies');
    expect(resolveMode(undefined, meta({ title: 'founder interview' }), []).name).toBe('mindcuts');
  });
});

describe('meanSubscores', () => {
  it('averages the requested keys across windows', () => {
    const wins = [sw({ humor: 10, surprise: 0 }), sw({ humor: 0, surprise: 10 })];
    expect(meanSubscores(wins, ['humor', 'surprise'])).toBe(5);
    expect(meanSubscores([], ['humor'])).toBe(0);
  });
});
