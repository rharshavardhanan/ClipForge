import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTimeline, TIMELINE_SCHEMA_VERSION } from '../../src/perception/timeline.js';

const GOLDEN = join(__dirname, '../../perception/fixtures/golden_timeline.json');
function golden(): Record<string, unknown> {
  return JSON.parse(readFileSync(GOLDEN, 'utf8'));
}

describe('validateTimeline', () => {
  it('accepts the golden fixture and returns a typed timeline', () => {
    const res = validateTimeline(golden());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.timeline.schema_version).toBe(TIMELINE_SCHEMA_VERSION);
      expect(res.timeline.speakers.length).toBe(2);
      expect(res.timeline.audio_events[1].kind).toBe('laughter');
      expect(res.timeline.tracks).toEqual([]);
    }
  });

  it('rejects a wrong schema_version', () => {
    const res = validateTimeline({ ...golden(), schema_version: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/schema_version/);
  });

  it('rejects an out-of-enum audio_event kind', () => {
    const bad = golden();
    (bad.audio_events as { kind: string }[])[0].kind = 'giggle';
    const res = validateTimeline(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/kind/);
  });

  it('rejects a negative time', () => {
    const bad = golden();
    (bad.scenes as { start: number }[])[0].start = -1;
    expect(validateTimeline(bad).ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validateTimeline(null).ok).toBe(false);
    expect(validateTimeline('x').ok).toBe(false);
  });
});
