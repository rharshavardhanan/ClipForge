import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CaptionTrack } from './Caption';
import { HookCard } from './HookCard';
import type { CaptionWord } from './captionLogic';
import { reframeStyle, type CropKeyframe } from './reframe';
import type { CaptionStyle } from './captionStyle';
import { buildZoomEvents, punchScaleAt } from './punchZoom';

// type alias (not interface) so props satisfy Remotion's Record<string, unknown> constraint
export type ClipProps = {
  videoPath: string; words: CaptionWord[]; fps: number; durationInFrames: number;
  style: 'minimal' | 'card' | 'bold'; accentColor: string; showHookCard: boolean; hookText: string;
  cropTrack?: CropKeyframe[]; srcW?: number; srcH?: number;
  caption?: CaptionStyle;
  zooms?: boolean;
};

export const CaptionedClip: React.FC<ClipProps> = ({
  videoPath, words, accentColor, showHookCard, hookText, cropTrack, srcW, srcH, caption, zooms,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const layout = reframeStyle(cropTrack ?? [], t, srcW ?? 1080, srcH ?? 1920);
  const punchScale = zooms === false ? 1 : punchScaleAt(buildZoomEvents(words), t);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <AbsoluteFill style={{ overflow: 'hidden', transform: `scale(${punchScale})`, transformOrigin: '50% 40%' }}>
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
      <CaptionTrack words={words} accentColor={accentColor} caption={caption} />
    </AbsoluteFill>
  );
};
