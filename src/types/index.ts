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
  /** Base framing: 'blur' (default) or 'crop' (smart face-crop via cropTrack). */
  framing?: 'blur' | 'crop';
  /** Arrow callouts at the speaker's face on peak moments — mirrors remotion/src/Callout.tsx. */
  callouts?: { time: number; x: number; y: number }[];
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
}
