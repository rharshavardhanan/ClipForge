import { describe, it, expect } from 'vitest';
import { mergeMetadata } from '../../src/ingest/metadataExtractor.js';

describe('mergeMetadata', () => {
  it('merges ffprobe dims with info.json fields and maps chapters', () => {
    const probed = { duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264' };
    const info = {
      title: 'Goggins', description: 'd', view_count: 100, like_count: 9,
      channel: 'C', upload_date: '20240101', tags: ['a'],
      chapters: [{ title: 'Intro', start_time: 0, end_time: 30 }],
    };
    const m = mergeMetadata('H14bBuluwB8', probed, info);
    expect(m.jobId).toBe('H14bBuluwB8');
    expect(m.width).toBe(1920);
    expect(m.title).toBe('Goggins');
    expect(m.chapters[0]).toEqual({ title: 'Intro', start: 0, end: 30 });
    expect(m.viewCount).toBe(100);
    expect(m.channelName).toBe('C');
  });

  it('maps info.comments to topComments sorted by likes (null like_count → 0)', () => {
    const probed = { duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264' };
    const info = {
      comments: [
        { text: 'meh', like_count: null },
        { text: '3:42 best part', like_count: 900 },
        { text: 'first', like_count: 3 },
      ],
    };
    const m = mergeMetadata('id1', probed, info);
    expect(m.topComments).toEqual([
      { text: '3:42 best part', likes: 900 },
      { text: 'first', likes: 3 },
      { text: 'meh', likes: 0 },
    ]);
  });

  it('caps topComments at 100', () => {
    const probed = { duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264' };
    const comments = Array.from({ length: 150 }, (_, i) => ({ text: `c${i}`, like_count: i }));
    const m = mergeMetadata('id1', probed, { comments });
    expect(m.topComments).toHaveLength(100);
    expect(m.topComments![0]).toEqual({ text: 'c149', likes: 149 }); // most-liked first
  });

  it('leaves topComments undefined when info has no comments', () => {
    const probed = { duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264' };
    expect(mergeMetadata('id1', probed, { title: 't' }).topComments).toBeUndefined();
    expect(mergeMetadata('id1', probed, null).topComments).toBeUndefined();
  });

  it('tolerates a missing info.json (null)', () => {
    const probed = { duration: 10, width: 640, height: 480, fps: 25, codec: 'h264' };
    const m = mergeMetadata('uuid-1', probed, null);
    expect(m.title).toBe('uuid-1');
    expect(m.chapters).toEqual([]);
    expect(m.viewCount).toBeUndefined();
    expect(m.likeCount).toBeUndefined();
    expect(m.commentCount).toBeUndefined();
    expect(m.channelName).toBeUndefined();
  });
});
