import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CaptionTrack } from './Caption';
import { HookCard } from './HookCard';
import type { CaptionWord } from './captionLogic';
import { reframeStyle, type CropKeyframe } from './reframe';

// type alias (not interface) so props satisfy Remotion's Record<string, unknown> constraint
export type ClipProps = {
  videoPath: string; words: CaptionWord[]; fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold'; accentColor: string; showHookCard: boolean; hookText: string;
  cropTrack?: CropKeyframe[]; srcW?: number; srcH?: number;
};

export const CaptionedClip: React.FC<ClipProps> = ({
  videoPath, words, accentColor, showHookCard, hookText, cropTrack, srcW, srcH,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = reframeStyle(cropTrack ?? [], frame / fps, srcW ?? 1080, srcH ?? 1920);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <OffthreadVideo
          src={staticFile(videoPath)}
          style={{
            position: 'absolute',
            width: layout.width,
            height: layout.height,
            left: layout.left,
            top: layout.top,
          }}
        />
      </AbsoluteFill>
      {showHookCard && <HookCard text={hookText} />}
      <CaptionTrack words={words} accentColor={accentColor} />
    </AbsoluteFill>
  );
};
