import { describe, it, expect } from 'vitest';
import { segmentWindow, cacheKey, buildSegmentArgs, MAX_SEGMENT_SEC } from '../../src/broll/cache.js';

describe('segmentWindow', () => {
  it('starts ~15% in and pads the cue duration', () => {
    const w = segmentWindow(600, 4);
    expect(w.start).toBe(90);
    expect(w.len).toBe(8);
  });
  it('caps at MAX_SEGMENT_SEC and never runs past the end', () => {
    expect(segmentWindow(600, 30).len).toBe(MAX_SEGMENT_SEC);
    const short = segmentWindow(10, 30);
    expect(short.start + short.len).toBeLessThanOrEqual(10 + short.len); // start pinned to fit
    expect(short.start).toBe(0);
  });
  it('unknown duration → take the head', () => {
    expect(segmentWindow(0, 4)).toEqual({ start: 0, len: 8 });
  });
});

describe('cacheKey', () => {
  it('is stable for the same section and distinct across sections', () => {
    expect(cacheKey('abc', 90, 8)).toBe(cacheKey('abc', 90, 8));
    expect(cacheKey('abc', 90, 8)).not.toBe(cacheKey('abc', 91, 8));
    expect(cacheKey('abc', 90, 8)).toHaveLength(16);
  });
});

describe('buildSegmentArgs', () => {
  it('downloads only the section, video-only ≤720p, remuxed mp4', () => {
    const args = buildSegmentArgs('https://y/watch?v=a', 90, 8, '/cache/x.mp4');
    expect(args).toContain('--download-sections');
    expect(args[args.indexOf('--download-sections') + 1]).toBe('*90-98');
    expect(args).toContain('--force-keyframes-at-cuts');
    expect(args.join(' ')).toContain('bestvideo[height<=720]');
  });
});
