import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { CaptionTrack } from './Caption';
import { HookCard } from './HookCard';
import type { CaptionWord } from './captionLogic';

export interface ClipProps {
  videoPath: string; words: CaptionWord[]; fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold'; accentColor: string; showHookCard: boolean; hookText: string;
}

export const CaptionedClip: React.FC<ClipProps> = ({ videoPath, words, accentColor, showHookCard, hookText }) => (
  <AbsoluteFill style={{ backgroundColor: 'black' }}>
    <OffthreadVideo src={staticFile(videoPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    {showHookCard && <HookCard text={hookText} />}
    <CaptionTrack words={words} accentColor={accentColor} />
  </AbsoluteFill>
);
