import { describe, it, expect } from 'vitest';
import { buildClipEdl } from '../../src/report/edl.js';
import type { RankedClip } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 10, end: 40, duration: 30, composite_score: 8,
  semantic_score: 0, audio_score: 0, visual_score: 0, trigger_score: 0, pacing_score: 0, metadata_score: 0,
  hook_moment: 'wait for it', clip_titles: ['A'], is_standalone: true, recommended_duration: 30,
  reason: 'r', transcript_excerpt: 'e',
};
const base = {
  clip, cues: [{ start: 0, end: 2, lines: ['wait for it'] }], zoomTimes: [3, 8], sfxTimes: [3],
  captionPreset: 'mrbeast', music: true, hookText: 'WAIT FOR IT',
  audioOps: [{ type: 'loudnorm', targetLufs: -14 }],
  rationale: { director: 'complete arc', framing: 'blur backdrop' },
};

describe('buildClipEdl', () => {
  it('blur clip → null crop track, single full-span 1.0x segment', () => {
    const edl = buildClipEdl({ ...base, framing: 'blur', cropTrack: [] });
    expect(edl.crop_track).toBeNull();
    expect(edl.framing).toBe('blur');
    expect(edl.source_span).toEqual({ start: 10, end: 40 });
    expect(edl.segments).toEqual([{ srcStart: 10, srcEnd: 40, speed: 1 }]);
    expect(edl.caption_cues).toHaveLength(1);
    expect(edl.zoom_times).toEqual([3, 8]);
    expect(edl.hook_text).toBe('WAIT FOR IT');
  });

  it('crop clip → carries the crop track verbatim', () => {
    const track = [{ time: 0, cx: 500, cy: 400, cropW: 607, cropH: 1080 }];
    const edl = buildClipEdl({ ...base, framing: 'crop', cropTrack: track });
    expect(edl.crop_track).toEqual(track);
    expect(edl.framing).toBe('crop');
  });

  it('echoes rationale + audio ops', () => {
    const edl = buildClipEdl({ ...base, framing: 'blur', cropTrack: [] });
    expect(edl.rationale.director).toBe('complete arc');
    expect(edl.audio_ops[0]).toMatchObject({ type: 'loudnorm' });
  });
});
