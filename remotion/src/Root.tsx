import { Composition } from 'remotion';
import { CaptionedClip, type ClipProps } from './CaptionedClip';
import { RankingVideo } from './RankingVideo';
import { totalFrames, type RankingProps } from './rankingLogic';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="CaptionedClip"
      component={CaptionedClip}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{
        videoPath: '', words: [], fps: 30, durationInFrames: 300,
        style: 'bold', accentColor: '#FFD700', showHookCard: false, hookText: '',
        cropTrack: [], srcW: 1080, srcH: 1920,
      } as ClipProps}
      calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames ?? 300, fps: props.fps ?? 30 })}
    />
    <Composition
      id="RankingVideo"
      component={RankingVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{ items: [], fps: 30, cardFrames: 45, accentColor: '#FFD700' } as RankingProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: totalFrames(props.items ?? [], props.cardFrames ?? 45),
        fps: props.fps ?? 30,
      })}
    />
  </>
);
