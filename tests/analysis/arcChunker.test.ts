import { describe, expect, it } from 'vitest';
import { chunkTranscript } from '../../src/analysis/arcChunker.js';
import type { TranscriptSegment } from '../../src/types/index.js';

const seg = (start: number, end: number): TranscriptSegment =>
  ({ id: Math.round(start), start, end, text: `t${start}`, words: [] });

describe('chunkTranscript', () => {
  it('single chunk when the transcript fits', () => {
    const chunks = chunkTranscript([seg(0, 30), seg(30, 400)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].segments).toHaveLength(2);
  });
  it('steps by chunkSec-overlapSec; segments overlapping a window are included in it', () => {
    const segs = Array.from({ length: 130 }, (_, i) => seg(i * 10, i * 10 + 10)); // 0..1300s
    const chunks = chunkTranscript(segs, 540, 60);
    expect(chunks[0].start).toBe(0);
    expect(chunks[1].start).toBe(480);              // 540 - 60
    expect(chunks[2].start).toBe(960);
    // the segment spanning 500-510 lives in both chunk 0 (ends 540) and chunk 1 (starts 480)
    expect(chunks[0].segments.some((s) => s.start === 500)).toBe(true);
    expect(chunks[1].segments.some((s) => s.start === 500)).toBe(true);
  });
  it('drops empty chunks and returns [] for no segments', () => {
    expect(chunkTranscript([])).toEqual([]);
    // one early segment, long silence, one late segment: middle windows are empty
    const chunks = chunkTranscript([seg(0, 10), seg(2000, 2010)], 540, 60);
    expect(chunks.every((c) => c.segments.length > 0)).toBe(true);
    expect(chunks.length).toBe(2);
  });
});
