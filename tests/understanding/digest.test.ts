import { describe, expect, it } from 'vitest';
import { buildPerceptionDigest } from '../../src/understanding/digest.js';
import type { SemanticTimeline } from '../../src/perception/timeline.js';

const base: SemanticTimeline = {
  schema_version: 1, job_id: 'j', duration: 600, sample_fps: 2, producers_run: ['mock'],
  speakers: [], audio_events: [], scenes: [], tracks: [], objects: [], depth: [], vlm_captions: [],
};

describe('buildPerceptionDigest', () => {
  it('returns empty string for null timeline', () => {
    expect(buildPerceptionDigest(null, { start: 0, end: 60 })).toBe('');
  });

  it('lists CLIP scenes, audience events and multi-speaker turns inside the window', () => {
    const t: SemanticTimeline = {
      ...base,
      scenes: [
        { start: 10, end: 40, label: 'a gym workout' },
        { start: 40, end: 90, label: 'scene 2' },            // generic mock label → excluded
        { start: 200, end: 260, label: 'a beach or pool' },  // outside window → excluded
      ],
      audio_events: [
        { start: 20, end: 22, kind: 'laughter', score: 0.9 },
        { start: 30, end: 31, kind: 'music', score: 0.9 },   // not an audience kind → excluded
        { start: 25, end: 26, kind: 'applause', score: 0.2 },// below 0.35 → excluded
      ],
      speakers: [
        { id: 'S0', turns: [{ start: 12, end: 18 }] },
        { id: 'S1', turns: [{ start: 18, end: 25 }] },
      ],
    };
    const d = buildPerceptionDigest(t, { start: 0, end: 100 });
    expect(d).toContain('[10.0-40.0] a gym workout');
    expect(d).not.toContain('scene 2');
    expect(d).not.toContain('beach');
    expect(d).toContain('[20.0] laughter 0.90');
    expect(d).not.toContain('music');
    expect(d).not.toContain('applause');
    expect(d).toContain('[12.0-18.0] S0');
    expect(d).toContain('[18.0-25.0] S1');
  });

  it('omits speaker turns when only one speaker exists (mock diarization is noise)', () => {
    const t: SemanticTimeline = { ...base, speakers: [{ id: 'S0', turns: [{ start: 1, end: 50 }] }] };
    expect(buildPerceptionDigest(t, { start: 0, end: 60 })).not.toContain('S0');
  });

  it('caps at MAX_DIGEST_LINES', () => {
    const scenes = Array.from({ length: 60 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, label: `a scene about topic ${i}` }));
    const d = buildPerceptionDigest({ ...base, scenes }, { start: 0, end: 300 });
    expect(d.split('\n').length).toBeLessThanOrEqual(40);
  });
});
