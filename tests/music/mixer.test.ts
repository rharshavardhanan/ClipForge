import { describe, it, expect } from 'vitest';
import { buildMusicMixArgs } from '../../src/music/mixer.js';

describe('buildMusicMixArgs', () => {
  const args = buildMusicMixArgs('/v/clip.mp4', '/m/track.mp3', '/v/out.mp4', {
    durationSec: 60, musicVolume: 0.25, fadeSec: 1.5,
  });
  const j = args.join(' ');

  it('loops/trims the music to the clip duration with fades and volume', () => {
    expect(j).toContain('aloop=loop=-1');
    expect(j).toContain('atrim=0:60');
    expect(j).toContain('afade=t=in:st=0:d=1.5');
    expect(j).toContain('afade=t=out:st=58.5:d=1.5');
    expect(j).toContain('volume=0.25');
  });

  it('ducks the music under speech via sidechain compression keyed by the voice track', () => {
    expect(j).toContain('sidechaincompress');
    expect(j).toContain('asplit=2[voice][sc]');
    expect(j).toContain('[mus][sc]sidechaincompress');
    expect(j).toContain('[voice][duck]amix=inputs=2:duration=first');
  });

  it('stream-copies video and encodes mixed audio as aac', () => {
    expect(j).toContain('-map 0:v');
    expect(j).toContain('-map [aout]');
    expect(j).toContain('-c:v copy');
    expect(j).toContain('-c:a aac');
    expect(args[args.length - 1]).toBe('/v/out.mp4');
  });
});
