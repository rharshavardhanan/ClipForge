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
  /** 'blur' = original video centered over a blurred backdrop (default, natural, no face cutting).
   *  'crop' = smart face-crop pan/zoom via cropTrack. */
  framing?: 'blur' | 'crop';
};

export const CaptionedClip: React.FC<ClipProps> = ({
  videoPath, words, accentColor, showHookCard, hookText, cropTrack, srcW, srcH, caption, zooms, framing,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const punchScale = zooms === false ? 1 : punchScaleAt(buildZoomEvents(words), t);
  const src = staticFile(videoPath);

  // Default to blur unless a crop track is explicitly supplied.
  const mode = framing ?? (cropTrack && cropTrack.length > 0 ? 'crop' : 'blur');

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {mode === 'crop' ? (
        (() => {
          const layout = reframeStyle(cropTrack ?? [], t, srcW ?? 1080, srcH ?? 1920);
          return (
            <AbsoluteFill style={{ overflow: 'hidden', transform: `scale(${punchScale})`, transformOrigin: '50% 40%' }}>
              <OffthreadVideo src={src} style={{ position: 'absolute', width: layout.width, height: layout.height, left: layout.left, top: layout.top }} />
            </AbsoluteFill>
          );
        })()
      ) : (
        <>
          {/* Blurred backdrop: same video, cover-filled and heavily blurred; scaled up so the blur bleed doesn't show a hard edge. */}
          <AbsoluteFill style={{ overflow: 'hidden' }}>
            <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.6)', transform: 'scale(1.2)' }} />
          </AbsoluteFill>
          {/* Main video: contained (full width, letterboxed band), punch-zoom applied here. */}
          <AbsoluteFill style={{ transform: `scale(${punchScale})`, transformOrigin: 'center' }}>
            <OffthreadVideo src={src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </AbsoluteFill>
        </>
      )}
      {showHookCard && <HookCard text={hookText} />}
      <CaptionTrack words={words} accentColor={accentColor} caption={caption} />
    </AbsoluteFill>
  );
};
