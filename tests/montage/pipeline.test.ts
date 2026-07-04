import { describe, expect, it } from 'vitest';
import { montageSlug, pickMontageTrack, buildMontageTexts } from '../../src/montage/pipeline.js';

describe('montageSlug', () => {
  it('is deterministic and filesystem-safe', () => {
    const a = montageSlug(['https://youtu.be/x', './b.mp4']);
    expect(a).toBe(montageSlug(['https://youtu.be/x', './b.mp4']));
    expect(a).toMatch(/^montage_[0-9a-f]{10}$/);
    expect(a).not.toBe(montageSlug(['https://youtu.be/y']));
  });
});

describe('pickMontageTrack', () => {
  const t = (path: string, duration: number) => ({ path, duration });
  it('prefers tracks long enough for the montage (+10s headroom)', () => {
    const pick = pickMontageTrack([t('short.mp3', 20), t('long.mp3', 120)], 25, 's');
    expect(pick).toBe('long.mp3');
  });
  it('none long enough → the longest', () => {
    expect(pickMontageTrack([t('a.mp3', 18), t('b.mp3', 22)], 30, 's')).toBe('b.mp3');
  });
  it('seeded pick is deterministic', () => {
    const tracks = [t('a.mp3', 100), t('b.mp3', 100), t('c.mp3', 100)];
    expect(pickMontageTrack(tracks, 25, 'seed1')).toBe(pickMontageTrack(tracks, 25, 'seed1'));
  });
  it('empty → null', () => {
    expect(pickMontageTrack([], 25, 's')).toBeNull();
  });
});

describe('buildMontageTexts', () => {
  it('builds deterministic title/description/hashtags with no LLM', () => {
    const texts = buildMontageTexts(['Insane Calisthenics Session'], 'PULLUP COUNTER');
    expect(texts.title).toContain('Insane Calisthenics Session');
    expect(texts.description).toContain('Insane Calisthenics Session');
    expect(texts.hashtags).toContain('#shorts');
    expect(texts.hashtags).toContain('#challenge'); // counter present
    expect(buildMontageTexts(['X'], null).hashtags).not.toContain('#challenge');
  });
});
