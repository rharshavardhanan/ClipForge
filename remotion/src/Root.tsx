import { Composition, Still } from 'remotion';
import { CaptionedClip, type ClipProps } from './CaptionedClip';
import { RankingVideo } from './RankingVideo';
import { RankRotVideo } from './RankRotVideo';
import { ThumbCard, type ThumbProps } from './ThumbCard';
import { totalFrames, type RankingProps } from './rankingLogic';
import { totalRankRotFrames, type RankRotProps } from './rankrotLogic';

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
        cropTrack: [], srcW: 1080, srcH: 1920, outWidth: 1080, outHeight: 1920,
      } as ClipProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames ?? 300,
        fps: props.fps ?? 30,
        width: props.outWidth ?? 1080,
        height: props.outHeight ?? 1920,
      })}
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
    <Composition
      id="RankRotVideo"
      component={RankRotVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{ items: [], fps: 30, topTitle: 'RANKING', subtext: '(last one is insane)', accentColor: '#FFE81A' } as RankRotProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: totalRankRotFrames(props.items ?? []),
        fps: props.fps ?? 30,
      })}
    />
    <Still
      id="ThumbCard"
      component={ThumbCard}
      width={1280}
      height={720}
      defaultProps={{ framePath: '', text: 'WAIT FOR IT', accent: '#FFD700' } as ThumbProps}
    />
  </>
);
