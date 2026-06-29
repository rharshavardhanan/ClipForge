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

  it('tolerates a missing info.json (null)', () => {
    const probed = { duration: 10, width: 640, height: 480, fps: 25, codec: 'h264' };
    const m = mergeMetadata('uuid-1', probed, null);
    expect(m.title).toBe('uuid-1');
    expect(m.chapters).toEqual([]);
  });
});
