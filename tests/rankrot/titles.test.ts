import { describe, it, expect } from 'vitest';
import { seededMicro, buildTopTitle, buildRankrotSeo, parseTitles, MICRO_FALLBACKS } from '../../src/rankrot/titles.js';

describe('seededMicro', () => {
  it('is deterministic and honors exclusions', () => {
    expect(seededMicro('seed_a')).toBe(seededMicro('seed_a'));
    const first = seededMicro('x_0');
    expect(seededMicro('x_0', [first])).not.toBe(first);
    expect(MICRO_FALLBACKS).toContain(first);
  });
});

describe('buildTopTitle', () => {
  it('uppercases and strips redundant prefixes', () => {
    expect(buildTopTitle('top 5 best dunks')).toEqual({ title: 'RANKING BEST DUNKS', subtext: '(last one is insane)' });
    expect(buildTopTitle('Ranking craziest fails').title).toBe('RANKING CRAZIEST FAILS');
  });
});

describe('buildRankrotSeo', () => {
  it('templates a shorts-ready pack', () => {
    const seo = buildRankrotSeo('best basketball dunks', 5);
    expect(seo.title).toContain('Top 5');
    expect(seo.title).toContain('#shorts');
    expect(seo.hashtags).toContain('#shorts');
    expect(seo.description).toContain('#1');
  });
});

describe('parseTitles', () => {
  it('LLM entries override seeded fallbacks; junk keeps fallbacks', () => {
    const withLlm = parseTitles({ micros: [{ i: 1, text: 'bro got cooked' }], title: 'Top 5 Dunks That Broke Physics 😱 #shorts' }, 3, 'topic', 'fb');
    expect(withLlm.micros[1]).toBe('BRO GOT COOKED');
    expect(withLlm.micros[0]).toBe(seededMicro('topic_0'));
    expect(withLlm.title).toContain('Broke Physics');

    const junk = parseTitles(null, 2, 'topic', 'fallback title here');
    expect(junk.micros).toHaveLength(2);
    expect(junk.micros[0]).not.toBe(junk.micros[1]); // exclusion avoids repeats
    expect(junk.title).toBe('fallback title here');
  });
});
