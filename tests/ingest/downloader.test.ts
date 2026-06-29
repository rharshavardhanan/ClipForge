import { describe, it, expect } from 'vitest';
import { buildYtdlpArgs, parseVideoId } from '../../src/ingest/downloader.js';

describe('downloader pure helpers', () => {
  it('parses video id from watch and short URLs', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=H14bBuluwB8')).toBe('H14bBuluwB8');
    expect(parseVideoId('https://youtu.be/H14bBuluwB8?t=30')).toBe('H14bBuluwB8');
    expect(parseVideoId('https://vimeo.com/123')).toBeNull();
  });

  it('builds yt-dlp args with json3 subs, info json, 1080p cap, no playlist', () => {
    const args = buildYtdlpArgs('URL', '/out');
    const j = args.join(' ');
    expect(j).toContain('height<=1080');
    expect(j).toContain('--sub-format json3');
    expect(j).toContain('--write-info-json');
    expect(j).toContain('--no-playlist');
    expect(j).toContain('--merge-output-format mp4');
    expect(args[0]).toBe('URL');
  });
});
