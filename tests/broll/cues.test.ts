import { describe, it, expect } from 'vitest';
import { clipSentences, buildCuePrompt, buildCueSchema, parseCues, MAX_CUES } from '../../src/broll/cues.js';
import type { TranscriptSegment } from '../../src/types/index.js';

const segs: TranscriptSegment[] = [
  { id: 0, start: 100, end: 104, text: 'At 16 I emailed Toto Wolff.', words: [] },
  { id: 1, start: 104, end: 109, text: 'Discipline got me through training.', words: [] },
  { id: 2, start: 130, end: 135, text: 'outside the clip', words: [] },
];

describe('clipSentences', () => {
  it('returns clip-relative sentences overlapping the clip only', () => {
    const s = clipSentences(segs, 100, 120);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ start: 0, end: 4 });
    expect(s[1].text).toContain('Discipline');
  });
  it('clamps partial overlaps to the clip bounds', () => {
    const s = clipSentences(segs, 102, 106);
    expect(s[0].start).toBe(0);
    expect(s[0].end).toBe(2);
  });
});

describe('buildCuePrompt', () => {
  it('embeds timed sentences, kinds, and metaphor guidance', () => {
    const p = buildCuePrompt(clipSentences(segs, 100, 120), 'serious');
    expect(p).toContain('[0.0-4.0] At 16 I emailed Toto Wolff.');
    expect(p).toContain('person | place | company');
    expect(p).toContain('athlete training alone'); // discipline metaphor
    expect(p).toContain('tone: serious');
  });
});

describe('buildCueSchema', () => {
  it('requires the cue fields with the kind enum', () => {
    const schema = buildCueSchema() as any;
    const item = schema.properties.cues.items;
    expect(item.required).toEqual(['start', 'end', 'entity', 'kind', 'query']);
    expect(item.properties.kind.enum).toContain('concept');
  });
});

describe('parseCues', () => {
  const good = { start: 4, end: 8, entity: 'Toto Wolff', kind: 'person', query: 'Toto Wolff Mercedes F1' };
  it('keeps valid cues, clamps to clip duration, strips quotes/hashtags', () => {
    const cues = parseCues({ cues: [good, { ...good, start: 20, end: 99, query: '"boxing" #training' }] }, 30);
    expect(cues).toHaveLength(2);
    expect(cues[1].end).toBe(30);
    expect(cues[1].query).toBe('boxing training');
  });
  it('drops malformed / too-short / unknown-kind cues', () => {
    const cues = parseCues({ cues: [
      { ...good, kind: 'meme' },
      { ...good, start: 8, end: 8.5 },
      { ...good, entity: '  ' },
      { ...good, start: 'x' },
      null,
    ] }, 30);
    expect(cues).toHaveLength(0);
  });
  it('caps at MAX_CUES sorted by start; tolerates non-object payloads', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...good, start: 30 - i * 3, end: 33 - i * 3 }));
    const cues = parseCues({ cues: many }, 60);
    expect(cues).toHaveLength(MAX_CUES);
    expect(cues[0].start).toBeLessThan(cues[1].start);
    expect(parseCues(null, 30)).toEqual([]);
    expect(parseCues('nope', 30)).toEqual([]);
  });
});
