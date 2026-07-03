import { describe, it, expect } from 'vitest';
import { mergeCandidates, buildHarvestArgs } from '../../src/rankrot/harvest.js';
import { templateQueries, parseQueries, buildQueryPrompt } from '../../src/rankrot/queries.js';
import { topicSlug } from '../../src/rankrot/pipeline.js';
import type { BrollCandidate } from '../../src/types/index.js';

const c = (id: string): BrollCandidate => ({ id, url: `u/${id}`, title: id, durationSec: 60 });

describe('mergeCandidates', () => {
  it('interleaves queries round-robin, dedupes by id, caps the pool', () => {
    const merged = mergeCandidates([[c('a1'), c('a2')], [c('b1'), c('a1')], [c('c1')]], 4);
    expect(merged.map((x) => x.id)).toEqual(['a1', 'b1', 'c1', 'a2']);
  });
});

describe('buildHarvestArgs', () => {
  it('downloads capped-size mp4 WITH audio', () => {
    const args = buildHarvestArgs('https://y/w?v=x', '/cache/x.mp4');
    expect(args.join(' ')).toContain('bestvideo[height<=1080]');
    expect(args.join(' ')).toContain('bestaudio');
    expect(args).toContain('--max-filesize');
  });
});

describe('queries', () => {
  it('templateQueries varies wording and dedupes', () => {
    const qs = templateQueries('Best basketball dunks');
    expect(qs[0]).toBe('best basketball dunks');
    expect(qs.some((q) => q.startsWith('crazy '))).toBe(true);
    expect(new Set(qs).size).toBe(qs.length);
  });
  it('parseQueries sanitizes and caps; prompt embeds the topic', () => {
    expect(parseQueries({ queries: ['A "B"', 'a b', 3, '  '] })).toEqual(['a b']);
    expect(parseQueries(null)).toEqual([]);
    expect(buildQueryPrompt('x dunks')).toContain('"x dunks"');
  });
});

describe('topicSlug', () => {
  it('is filesystem/route safe', () => {
    expect(topicSlug('Best Basketball Dunks!!')).toBe('rankrot_best_basketball_dunks');
    expect(topicSlug('   ')).toBe('rankrot_topic');
  });
});
