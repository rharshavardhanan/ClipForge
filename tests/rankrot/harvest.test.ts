import { describe, it, expect } from 'vitest';
import { mergeCandidates, buildHarvestArgs, isLikelyAiSlop, popularityFilter } from '../../src/rankrot/harvest.js';
import { templateQueries, parseQueries, buildQueryPrompt } from '../../src/rankrot/queries.js';
import { topicSlug } from '../../src/rankrot/pipeline.js';
import type { BrollCandidate } from '../../src/types/index.js';

const c = (id: string, over: Partial<BrollCandidate> = {}): BrollCandidate =>
  ({ id, url: `u/${id}`, title: id, durationSec: 60, ...over });

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

describe('AI-slop filter + popularity (real footage only, most-viewed first)', () => {
  it('isLikelyAiSlop catches generator/animation tells in title or channel', () => {
    expect(isLikelyAiSlop(c('a', { title: 'Cute dog AI generated compilation' }))).toBe(true);
    expect(isLikelyAiSlop(c('b', { title: 'puppy adventure', channel: 'Veo 3 Creations' }))).toBe(true);
    expect(isLikelyAiSlop(c('c', { title: '3D animated cat cartoon' }))).toBe(true);
    expect(isLikelyAiSlop(c('d', { title: 'Dog saves owner caught on camera', channel: 'DailyPets' }))).toBe(false);
    expect(isLikelyAiSlop(c('e', { title: 'air horn prank on cat' }))).toBe(false); // 'ai' must be a word
  });
  it('popularityFilter drops slop and sorts by views desc, unknown views last', () => {
    const out = popularityFilter([
      c('small', { viewCount: 1000 }),
      c('slop', { title: 'sora ai dog', viewCount: 99_000_000 }),
      c('big', { viewCount: 5_000_000 }),
      c('unknown'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['big', 'small', 'unknown']);
  });
});

describe('queries', () => {
  it('templateQueries targets popular real footage (tiktok/caught-on-camera) and dedupes', () => {
    const qs = templateQueries('Best basketball dunks');
    expect(qs[0]).toBe('best basketball dunks');
    expect(qs.some((q) => q.includes('tiktok'))).toBe(true);
    expect(qs.some((q) => q.includes('caught on camera'))).toBe(true);
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

describe('long-compilation head fetch', () => {
  it('buildHarvestArgs adds a head section only when asked', () => {
    const whole = buildHarvestArgs('u', '/c/x.mp4');
    expect(whole).not.toContain('--download-sections');
    const head = buildHarvestArgs('u', '/c/x.mp4', 240);
    expect(head[head.indexOf('--download-sections') + 1]).toBe('*0-240');
    expect(head).toContain('--force-keyframes-at-cuts');
  });
});
