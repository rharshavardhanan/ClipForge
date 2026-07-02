import { describe, it, expect } from 'vitest';
import { buildSfxMixArgs } from '../../src/sfx/mixer.js';

describe('buildSfxMixArgs', () => {
  it('one adelay chain per event, video stream-copied', () => {
    const args = buildSfxMixArgs('v.mp4', [{ time: 1.5, path: 'w.mp3' }, { time: 4, path: 'i.mp3' }], 'o.mp4', { sfxVolume: 0.6 });
    const s = args.join(' ');
    expect(s).toContain('-i v.mp4');
    expect(s).toContain('-i w.mp3');
    expect(s).toContain('-i i.mp3');
    expect(s).toContain('adelay=1500|1500');
    expect(s).toContain('adelay=4000|4000');
    expect(s).toContain('volume=0.6');
    expect(s).toContain('amix=inputs=3');
    expect(s).toContain('-c:v copy');
    expect(args[args.length - 1]).toBe('o.mp4');
  });
});
