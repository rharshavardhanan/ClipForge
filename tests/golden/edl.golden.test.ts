import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClipEdl } from '../../src/report/edl.js';
import type { RankedClip } from '../../src/types/index.js';

/**
 * Golden EDL round-trip (v4 AT-12, decision-identity scope): the render-decision record must
 * not drift silently. If this fails and the change is intentional, regenerate the fixture and
 * commit it with a note — that's the "signed-off golden update".
 */
describe('golden: EDL decision stability', () => {
  it('buildClipEdl reproduces the committed fixture exactly', () => {
    const clip: RankedClip = {
      rank: 1, clip_id: 'clip_001', start: 12.5, end: 40.5, duration: 28, composite_score: 8.2,
      semantic_score: 7, audio_score: 6, visual_score: 0.7, trigger_score: 5, pacing_score: 0, metadata_score: 0,
      hook_moment: 'wait for it', clip_titles: ['He Actually Did It'], is_standalone: true,
      recommended_duration: 30, reason: 'complete Q&A arc, laughter on payoff', transcript_excerpt: 'e',
    };
    const edl = buildClipEdl({
      clip, framing: 'crop',
      cropTrack: [{ time: 0, cx: 960, cy: 500, cropW: 607, cropH: 1080 }, { time: 2, cx: 900, cy: 520, cropW: 607, cropH: 1080 }],
      cues: [{ start: 0, end: 1.8, lines: ['wait for it'] }, { start: 1.8, end: 3.6, lines: ['he actually', 'did it'] }],
      zoomTimes: [3.2, 8.1], sfxTimes: [3.2],
      captionPreset: 'mrbeast', music: true, hookText: 'WAIT FOR IT',
      audioOps: [{ type: 'loudnorm', targetLufs: -14 }],
      rationale: { director: 'complete Q&A arc, laughter on payoff', framing: 'full-screen face/speaker crop' },
    });
    const expected = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'clip_edl.expected.json'), 'utf8'));
    expect(edl).toEqual(expected);
  });
});
