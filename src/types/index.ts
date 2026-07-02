export interface TranscriptWord { start: number; end: number; word: string; probability: number; }
export interface TranscriptSegment {
  id: number; start: number; end: number; text: string;
  words: TranscriptWord[]; speaker?: string;
}
export interface Chapter { title: string; start: number; end: number; }
export interface Comment { text: string; likes: number; }
export interface VideoMetadata {
  jobId: string; title: string; duration: number;
  width: number; height: number; fps: number; codec: string;
  chapters: Chapter[]; description: string;
  viewCount?: number; likeCount?: number; commentCount?: number;
  tags?: string[]; uploadDate?: string; channelName?: string;
  topComments?: Comment[];
}
export type TriggerTier = 1 | 2 | 3 | 'structural';
export interface TriggerHit { time: number; weight: number; phrase: string; tier: TriggerTier; }
export interface RmsPoint { time: number; rms: number; }       // rms normalized 0–10
export interface SilenceRegion { start: number; end: number; }
export interface AudioEnergyLayer { rms_curve: RmsPoint[]; silence_regions: SilenceRegion[]; }
export interface WindowScore { start: number; end: number; triggerScore: number; audioScore: number; semanticScore: number; commentScore?: number; composite: number; }
export interface ClipCandidate { start: number; end: number; composite: number; triggerScore: number; audioScore: number; commentScore?: number; }
export interface RankedClip {
  rank: number; clip_id: string; start: number; end: number; duration: number;
  composite_score: number;
  semantic_score: number; audio_score: number; visual_score: number;
  trigger_score: number; pacing_score: number; metadata_score: number;
  hook_moment: string; clip_titles: string[]; is_standalone: boolean;
  recommended_duration: number; reason: string; transcript_excerpt: string;
  sentiment?: string;
  /** Set by global cross-video ranking (MV1) to attribute this clip to its source video.
   * Absent for single-video runs — exporter falls back to the jobId/source args passed in. */
  source_video?: string;
  source_url?: string;
}
export interface SemanticScores {
  emotional_intensity: number; controversy: number; humor: number; surprise: number;
  wisdom: number; storytelling_tension: number; argument_peak: number; relatability: number;
}
export interface SemanticWindow {
  start: number; end: number; semantic_score: number; scores: SemanticScores;
  hook_moment: string; clip_titles: string[]; is_standalone: boolean; recommended_duration: number;
  sentiment: 'serious' | 'funny' | 'intense' | 'neutral'; reason: string;
}
export interface CaptionWord { text: string; start: number; end: number; emphasized: boolean; }
export interface FaceBox { x: number; y: number; w: number; h: number; }   // pixels in source frame
export interface FaceSample { time: number; box: FaceBox | null; }          // null = no face that sample
export interface CropKeyframe { time: number; cx: number; cy: number; cropW: number; cropH: number; } // crop window center + size, in source px

// Multi-face / active-speaker (MS1)
export interface FaceObs { box: FaceBox; mouthOpenness: number; }          // one face in one frame
export interface FrameObs { time: number; faces: FaceObs[]; }              // all faces in a sampled frame
export interface ActiveSample { time: number; box: FaceBox | null; }       // chosen active-speaker box per sample
export interface TrackSample { time: number; box: FaceBox; mouthOpenness: number; }
export interface Track { id: number; samples: TrackSample[]; }
export interface ClipCompositionProps {
  videoPath: string;          // path relative to remotion/public (staticFile)
  words: CaptionWord[];
  fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold';
  accentColor: string; showHookCard: boolean; hookText: string;
  cropTrack?: CropKeyframe[]; srcW?: number; srcH?: number;
  /** Full caption style config (SP2). Absent → renderer's legacy bold look. */
  caption?: import('../captions/presets.js').CaptionStyle;
  /** Punch zooms on emphasized moments (EG2). Default true. */
  zooms?: boolean;
  /** Punch-zoom amplitude multiplier (v6 modes: clippies 1, mindcuts ~0.55). */
  zoomIntensity?: number;
  /** Base framing: 'blur' (default) or 'crop' (smart face-crop via cropTrack). */
  framing?: 'blur' | 'crop';
  /** Arrow callouts at the speaker's face on peak moments — mirrors remotion/src/Callout.tsx. */
  callouts?: { time: number; x: number; y: number }[];
  /** Narrative-overlay B-roll windows (v6) — muted visuals over the continuing A-roll audio. */
  broll?: { videoPath: string; from: number; durationInFrames: number }[];
}

// Content modes (v6): clippies = high-energy creator clips, mindcuts = podcast/storytelling.
export type ContentMode = 'clippies' | 'mindcuts';

// Contextual B-roll engine (v6) — narrative overlay
export type BrollKind = 'person' | 'place' | 'company' | 'object' | 'action' | 'emotion' | 'concept' | 'event';
/** One LLM-extracted B-roll opportunity; times are clip-relative seconds. */
export interface BrollCue { start: number; end: number; entity: string; kind: BrollKind; query: string; }
/** One YouTube search result considered as B-roll source material. */
export interface BrollCandidate { id: string; url: string; title: string; channel?: string; durationSec: number; }
/** A downloaded B-roll asset placed on the clip timeline (narrative overlay window). */
export interface BrollSegment {
  file: string;               // absolute path of the cached segment
  atSec: number;              // overlay start, clip-relative
  durationSec: number;
  entity: string; kind: BrollKind; query: string; sourceUrl: string;
}

// Ranking video render mode (RV1/RV2) — mirrors remotion/src/rankingLogic.ts
export interface RankingItem { videoPath: string; rank: number; durationInFrames: number; title?: string; }
export interface RankingProps { items: RankingItem[]; fps: number; cardFrames: number; accentColor: string; }

// Multi-video cross-ranking (MV1)
/** Result of analyzing a single video, up to (but not including) ranking/export. */
export interface VideoAnalysis {
  jobId: string;
  url: string;
  videoPath: string;
  meta: VideoMetadata;
  segments: TranscriptSegment[];
  triggers: TriggerHit[];
  audio: AudioEnergyLayer;
  semantic: SemanticWindow[];
  candidates: ClipCandidate[];
  /** Content mode resolved for this video (v6): explicit --mode or auto-detected. */
  mode: ContentMode;
}
