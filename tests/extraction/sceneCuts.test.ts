import { describe, it, expect } from 'vitest';
import { parseShowinfoTimes, segmentByCuts } from '../../src/extraction/sceneCuts.js';

describe('parseShowinfoTimes', () => {
  it('extracts pts_time values from ffmpeg showinfo stderr', () => {
    const err = [
      '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  12345 pts_time:4.171 duration:...',
      'frame=  100 fps= 25 q=-0.0 size=N/A',
      '[Parsed_showinfo_1 @ 0x1] n:   1 pts:  99999 pts_time:17.92 duration:...',
    ].join('\n');
    expect(parseShowinfoTimes(err)).toEqual([4.171, 17.92]);
  });
  it('empty/no matches → []', () => {
    expect(parseShowinfoTimes('')).toEqual([]);
    expect(parseShowinfoTimes('frame= 1 fps=0')).toEqual([]);
  });
});

describe('segmentByCuts', () => {
  const items = [0, 1, 2, 3, 4, 5, 6].map((t) => ({ time: t }));
  it('splits items at cut times (cut belongs to the following segment)', () => {
    const segs = segmentByCuts(items, [2.5, 5.0]);
    expect(segs.map((s) => s.map((i) => i.time))).toEqual([[0, 1, 2], [3, 4], [5, 6]]);
  });
  it('no cuts → one segment; cuts outside range ignored', () => {
    expect(segmentByCuts(items, [])).toHaveLength(1);
    expect(segmentByCuts(items, [99])).toHaveLength(1);
  });
  it('never returns empty segments (adjacent cuts collapse)', () => {
    const segs = segmentByCuts(items, [2.2, 2.4, 2.6]);
    for (const s of segs) expect(s.length).toBeGreaterThan(0);
  });
});
