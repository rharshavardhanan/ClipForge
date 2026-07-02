import { describe, it, expect } from 'vitest';
import { pickThumbnailTime, buildThumbnailArgs, escapeDrawtext } from '../../src/export/thumbnail.js';

describe('pickThumbnailTime', () => {
  it('picks the loudest RMS point inside the clip (0.5s margins)', () => {
    const rms = [
      { time: 10.2, rms: 3 }, { time: 15, rms: 9 }, { time: 29.8, rms: 8 }, { time: 40, rms: 10 },
    ];
    expect(pickThumbnailTime({ start: 10, end: 30 }, rms)).toBe(15);
  });
  it('ignores points hugging the clip boundaries', () => {
    const rms = [{ time: 10.1, rms: 10 }, { time: 20, rms: 5 }];
    expect(pickThumbnailTime({ start: 10, end: 30 }, rms)).toBe(20);
  });
  it('falls back to the clip midpoint with no usable RMS', () => {
    expect(pickThumbnailTime({ start: 10, end: 30 }, [])).toBe(20);
  });
});

describe('buildThumbnailArgs', () => {
  it('grabs one frame at t with contrast pop', () => {
    const args = buildThumbnailArgs('in.mp4', 5, 'out.png');
    expect(args).toContain('-ss');
    expect(args).toContain('5');
    expect(args.join(' ')).toContain('-frames:v 1');
    expect(args.join(' ')).toContain('eq=contrast');
    expect(args.join(' ')).not.toContain('drawtext'); // no font → plain frame
  });
  it('adds bold bordered drawtext when font+text given', () => {
    const s = buildThumbnailArgs('in.mp4', 5, 'out.png', 'HE DID IT', '/f/Impact.ttf').join(' ');
    expect(s).toContain('drawtext');
    expect(s).toContain('bordercolor=black');
    expect(s).toContain('HE DID IT');
  });
});

it('escapeDrawtext escapes ffmpeg specials', () => {
  expect(escapeDrawtext("IT'S 100%: WOW")).toBe("IT\\'S 100\\%\\: WOW");
});
