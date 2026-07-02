import { describe, it, expect } from 'vitest';
import { buildSearchArgs, parseSearchOutput, filterCandidates, MIN_SOURCE_SEC, MAX_SOURCE_SEC } from '../../src/broll/search.js';

describe('buildSearchArgs', () => {
  it('uses ytsearchN with flat JSON output and no download', () => {
    const args = buildSearchArgs('Toto Wolff Mercedes F1', 5);
    expect(args[0]).toBe('ytsearch5:Toto Wolff Mercedes F1');
    expect(args).toContain('--dump-json');
    expect(args).toContain('--flat-playlist');
    expect(args).toContain('--no-download');
  });
});

describe('parseSearchOutput', () => {
  it('parses JSON lines and fills url/channel fallbacks', () => {
    const lines = [
      JSON.stringify({ id: 'abc123', title: 'Toto Wolff interview', duration: 300, channel: 'F1' }),
      'not json',
      JSON.stringify({ id: 'def456', title: 'Pit lane', url: 'https://youtu.be/def456', uploader: 'Sky', duration: 90 }),
      JSON.stringify({ title: 'missing id' }),
    ].join('\n');
    const c = parseSearchOutput(lines);
    expect(c).toHaveLength(2);
    expect(c[0].url).toContain('watch?v=abc123');
    expect(c[0].channel).toBe('F1');
    expect(c[1].channel).toBe('Sky');
  });
});

describe('filterCandidates', () => {
  const mk = (id: string, durationSec: number) => ({ id, url: '', title: id, durationSec });
  it('drops the source video and out-of-range durations, keeps unknown durations', () => {
    const kept = filterCandidates([
      mk('self', 300), mk('short', MIN_SOURCE_SEC - 5), mk('vod', MAX_SOURCE_SEC + 1),
      mk('good', 300), mk('unknown', 0),
    ], { excludeIds: ['self'] });
    expect(kept.map((c) => c.id)).toEqual(['good', 'unknown']);
  });
});
