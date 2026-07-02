import { describe, it, expect } from 'vitest';
import { cleanupTargets } from '../../src/cli/commands/all.js';

describe('cleanupTargets', () => {
  it('returns the source video + clips-intermediates dir per source, deduped by jobId', () => {
    const analyses = [
      { jobId: 'a', videoPath: '/ws/downloads/a/video.mp4' },
      { jobId: 'a', videoPath: '/ws/downloads/a/video.mp4' }, // same source, appears once
      { jobId: 'b', videoPath: '/ws/downloads/b/video.mp4' },
    ];
    expect(cleanupTargets(analyses, '/ws')).toEqual([
      '/ws/downloads/a/video.mp4', '/ws/clips/a',
      '/ws/downloads/b/video.mp4', '/ws/clips/b',
    ]);
  });

  it('returns [] for no analyses', () => {
    expect(cleanupTargets([], '/ws')).toEqual([]);
  });
});
