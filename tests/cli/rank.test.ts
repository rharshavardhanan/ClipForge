import { describe, it, expect } from 'vitest';
import { manifestToEntries } from '../../src/cli/commands/rank.js';

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
