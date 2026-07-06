/**
 * Per-clip EDL — the render-decision record (v4 Part 1 §6.4). Everything the renderer needs
 * to reproduce a clip: source span, segments, framing + crop track, caption cues, zoom/sfx
 * timing, audio ops, and the rationale. Persisted as clip_NNN_edl.json; the golden test
 * asserts it doesn't drift silently. PURE assembly — no I/O.
 *
 * Slice A: `segments` is always one full-span 1.0x cut (internal tightening arrives in
 * Slice C, which will populate real multi-segment cuts here).
 */
import type { CropKeyframe, RankedClip } from '../types/index.js';
import type { CaptionCue } from '../captions/captionCues.js';

export interface EdlSegment { srcStart: number; srcEnd: number; speed: number; }

export interface ClipEdl {
  clip_id: string;
  source_span: { start: number; end: number };
  segments: EdlSegment[];
  framing: 'blur' | 'crop';
  crop_track: CropKeyframe[] | null;
  caption_cues: CaptionCue[];
  zoom_times: number[];
  sfx_event_times: number[];
  audio_ops: { type: string; [k: string]: unknown }[];
  caption_preset: string;
  music: boolean;
  hook_text?: string;
  rationale: { director?: string; editor?: string; framing?: string };
}

export function buildClipEdl(args: {
  clip: RankedClip;
  framing: 'blur' | 'crop';
  cropTrack: CropKeyframe[];
  cues: CaptionCue[];
  zoomTimes: number[];
  sfxTimes: number[];
  captionPreset: string;
  music: boolean;
  hookText?: string;
  audioOps: { type: string; [k: string]: unknown }[];
  rationale: { director?: string; editor?: string; framing?: string };
}): ClipEdl {
  const { clip } = args;
  return {
    clip_id: clip.clip_id,
    source_span: { start: clip.start, end: clip.end },
    segments: [{ srcStart: clip.start, srcEnd: clip.end, speed: 1 }],
    framing: args.framing,
    crop_track: args.framing === 'crop' ? args.cropTrack : null,
    caption_cues: args.cues,
    zoom_times: args.zoomTimes,
    sfx_event_times: args.sfxTimes,
    audio_ops: args.audioOps,
    caption_preset: args.captionPreset,
    music: args.music,
    ...(args.hookText ? { hook_text: args.hookText } : {}),
    rationale: args.rationale,
  };
}
