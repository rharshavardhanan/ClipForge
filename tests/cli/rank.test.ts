import { describe, it, expect } from 'vitest';
import { manifestToEntries, buildRankingTexts } from '../../src/cli/commands/rank.js';

describe('manifestToEntries', () => {
  it('maps manifest clips to ranking entries with final paths and first title', () => {
    const manifest = {
      clips: [
        { clip_id: 'clip_001', rank: 1, clip_titles: ['Best moment', 'alt'] },
        { clip_id: 'clip_002', rank: 2, clip_titles: [] },
      ],
    };
    const entries = manifestToEntries(manifest, '/ws/exports/batch_x');
    expect(entries).toEqual([
      { clipPath: '/ws/exports/batch_x/clip_001_final.mp4', rank: 1, title: 'Best moment' },
      { clipPath: '/ws/exports/batch_x/clip_002_final.mp4', rank: 2 },
    ]);
  });

  it('returns [] for a manifest with no clips', () => {
    expect(manifestToEntries({ clips: [] }, '/d')).toEqual([]);
  });
});

describe('buildRankingTexts', () => {
  it('countdown titles + SEO description from the manifest', () => {
    const manifest = {
      title: 'Speed Marathon',
      clips: [
        { clip_id: 'clip_001', rank: 1, clip_titles: ['The Backflip'], transcript_excerpt: 'x' },
        { clip_id: 'clip_002', rank: 2, clip_titles: [], transcript_excerpt: 'he screamed so loud today wow really' },
      ],
    };
    const t = buildRankingTexts(manifest);
    expect(t.titles).toContain('Top 2');
    expect(t.titles).toContain('#1: The Backflip');
    expect(t.titles).toContain('#2: he screamed so loud today wow');
    expect(t.description).toContain('#shorts');
    expect(t.description).toContain('#top2');
    expect(t.description).toContain('Speed Marathon');
    expect(t.description).toContain('#1: The Backflip');
  });
});
