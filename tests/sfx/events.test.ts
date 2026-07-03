import { describe, it, expect } from 'vitest';
import { planSfx, buildZoomSfxTimes } from '../../src/sfx/events.js';
import type { CaptionWord } from '../../src/types/index.js';

const w = (start: number, emphasized: boolean): CaptionWord => ({ text: 'x', start, end: start + 0.3, emphasized });

describe('buildZoomSfxTimes (mirrors remotion punchZoom)', () => {
  it('skips first second, enforces 2.5s min gap, caps at 4', () => {
    const words = [w(0.5, true), w(1.2, true), w(2.0, true), w(4.0, true), w(7.0, true), w(10, true), w(13, true)];
    expect(buildZoomSfxTimes(words)).toEqual([1.2, 4.0, 7.0, 10]);
  });
  it('ignores non-emphasized words', () => {
    expect(buildZoomSfxTimes([w(2, false), w(5, false)])).toEqual([]);
  });
});

describe('planSfx', () => {
  const lib = { whoosh: ['/s/w.mp3'], impact: ['/s/i.mp3'] };
  it('impact at hook + whoosh per given zoom time', () => {
    const events = planSfx([2, 6], lib, { hasHook: true, seed: 'a' });
    expect(events[0]).toEqual({ time: 0.05, path: '/s/i.mp3' });
    expect(events.filter((e) => e.path === '/s/w.mp3').map((e) => e.time)).toEqual([2, 6]);
  });
  it('empty zoom times → no whooshes; empty lib → no events', () => {
    expect(planSfx([], lib, { hasHook: false, seed: 'a' })).toEqual([]);
    expect(planSfx([2], {}, { hasHook: true, seed: 'a' })).toEqual([]);
  });
});
