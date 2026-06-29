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
export interface WindowScore { start: number; end: number; triggerScore: number; audioScore: number; composite: number; }
export interface ClipCandidate { start: number; end: number; composite: number; triggerScore: number; audioScore: number; }
export interface RankedClip {
  rank: number; clip_id: string; start: number; end: number; duration: number;
  composite_score: number;
  semantic_score: number; audio_score: number; visual_score: number;
  trigger_score: number; pacing_score: number; metadata_score: number;
  hook_moment: string; clip_titles: string[]; is_standalone: boolean;
  recommended_duration: number; reason: string; transcript_excerpt: string;
}
export interface CaptionWord { text: string; start: number; end: number; emphasized: boolean; }
export interface ClipCompositionProps {
  videoPath: string;          // path relative to remotion/public (staticFile)
  words: CaptionWord[];
  fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold';
  accentColor: string; showHookCard: boolean; hookText: string;
}
