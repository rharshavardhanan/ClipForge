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

  it('keeps the 15 strongest events, re-sorted by time', () => {
    // 20 laughter events with distinct scores: i=0..19, score=0.40+(i*0.03), start=100-i
    const events = Array.from({ length: 20 }, (_, i) => ({
      start: 100 - i,
      end: 101 - i,
      kind: 'laughter' as const,
      score: 0.4 + i * 0.03,
    }));
    const t: SemanticTimeline = { ...base, audio_events: events };
    const d = buildPerceptionDigest(t, { start: 0, end: 150 });

    // Locate the AUDIENCE AUDIO EVENTS section and count event lines
    const lines = d.split('\n');
    const headerIdx = lines.findIndex((line) => line === 'AUDIENCE AUDIO EVENTS:');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    const eventLines = lines.slice(headerIdx + 1).filter((line) => /^\[[\d.]+\]/.test(line));
    expect(eventLines).toHaveLength(15);

    // Verify the 5 weakest events (i=0..4, scores 0.40–0.52) are absent
    expect(d).not.toContain('0.40');
    expect(d).not.toContain('0.43');
    expect(d).not.toContain('0.46');
    expect(d).not.toContain('0.49');
    expect(d).not.toContain('0.52');

    // Verify the 15 strongest events are present
    expect(d).toContain('0.55');
    expect(d).toContain('0.97');

    // Verify event lines appear in ascending time order
    const times = eventLines.map((line) => parseFloat(line.match(/^\[([\d.]+)\]/)![1]));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it('includes events exactly at the 0.35 score floor', () => {
    const t: SemanticTimeline = {
      ...base,
      audio_events: [
        { start: 10, end: 11, kind: 'laughter', score: 0.35 },
        { start: 20, end: 21, kind: 'applause', score: 0.34 },
      ],
    };
    const d = buildPerceptionDigest(t, { start: 0, end: 100 });
    expect(d).toContain('[10.0] laughter 0.35');
    expect(d).not.toContain('0.34');
  });
});
