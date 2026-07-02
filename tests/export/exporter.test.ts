import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClipJson, buildManifest, writeExports, buildBrollEntries, buildBrollManifest } from '../../src/export/exporter.js';
import { buildSeoPack } from '../../src/export/seo.js';
import type { RankedClip, VideoMetadata } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 10, end: 70, duration: 60, composite_score: 8,
  semantic_score: 0, audio_score: 7, visual_score: 0, trigger_score: 9, pacing_score: 0, metadata_score: 0,
  hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 60, reason: 'r', transcript_excerpt: 'e',
};
const meta: VideoMetadata = {
  jobId: 'H14bBuluwB8', title: 'Goggins', duration: 900, width: 1920, height: 1080, fps: 30, codec: 'h264',
  chapters: [], description: '',
};

describe('exporter', () => {
  it('clip json includes files block and layer scores', () => {
    const j: any = buildClipJson(clip, 'H14bBuluwB8', { final: 'clip_001_final.mp4', raw: 'clip_001_raw.mp4', srt: 'clip_001.srt' });
    expect(j.clip_id).toBe('clip_001');
    expect(j.source_video).toBe('H14bBuluwB8');
    expect(j.files.final).toBe('clip_001_final.mp4');
    expect(j.layer_scores.semantic).toBe(0);
    expect(j.layer_scores.audio).toBe(7);
    expect(j.layer_scores.visual).toBe(0);
    expect(j.layer_scores.trigger).toBe(9);
    expect(j.layer_scores.pacing).toBe(0);
    expect(j.layer_scores.metadata).toBe(0);
  });
  it('manifest aggregates clip count and scores', () => {
    const m: any = buildManifest('H14bBuluwB8', 'https://y/watch?v=H14bBuluwB8', meta, [clip]);
    expect(m.clips_generated).toBe(1);
    expect(m.top_score).toBe(8);
    expect(m.avg_score).toBe(8);
    expect(m.title).toBe('Goggins');
    expect(m.clips).toHaveLength(1);
  });
  it('buildManifest handles an empty clips array without NaN/-Infinity', () => {
    const m: any = buildManifest('job', 'src', meta, []);
    expect(m.clips_generated).toBe(0);
    expect(m.top_score).toBe(0);
    expect(m.avg_score).toBe(0);
  });

  it('clip json carries the seo pack and optional thumbnail file', () => {
    const pack = buildSeoPack(clip, meta);
    const j: any = buildClipJson(clip, 'H14bBuluwB8',
      { final: 'f.mp4', raw: 'r.mp4', srt: 's.srt', thumbnail: 'clip_001_thumbnail.png' }, pack);
    expect(j.seo.title.length).toBeGreaterThan(0);
    expect(j.files.thumbnail).toBe('clip_001_thumbnail.png');
  });

  it('writeExports writes per-clip SEO text files + clip.json with seo block', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exports-'));
    await writeExports(dir, 'H14bBuluwB8', 'https://y/watch?v=H14bBuluwB8', meta, [clip]);
    for (const f of ['clip_001_title.txt', 'clip_001_description.txt', 'clip_001_hashtags.txt', 'clip_001_hook.txt']) {
      expect((await readFile(join(dir, f), 'utf8')).length).toBeGreaterThan(0);
    }
    const j = JSON.parse(await readFile(join(dir, 'clip_001.json'), 'utf8'));
    expect(j.seo.hashtags).toContain('#shorts');
  });
});

describe('B-roll exports (v6)', () => {
  const seg = { file: '/cache/ab12.mp4', atSec: 5, durationSec: 4, entity: 'Toto Wolff', kind: 'person' as const, query: 'Toto Wolff Mercedes F1', sourceUrl: 'https://y/w' };
  it('buildBrollEntries maps segments to manifest rows (basename only)', () => {
    expect(buildBrollEntries([seg])).toEqual([{
      entity: 'Toto Wolff', kind: 'person', query: 'Toto Wolff Mercedes F1',
      source_url: 'https://y/w', cache_file: 'ab12.mp4', at_sec: 5, duration_sec: 4,
    }]);
  });
  it('buildBrollManifest keys by clip_id and skips clips without B-roll', () => {
    const clips = [{ clip_id: 'clip_001' }, { clip_id: 'clip_002' }] as never[];
    const map = new Map([['clip_001', [seg]], ['clip_002', []]]);
    const m = buildBrollManifest(clips, map);
    expect(Object.keys(m)).toEqual(['clip_001']);
    expect(buildBrollManifest(clips, undefined)).toEqual({});
  });
  it('buildClipJson includes the broll block only when segments exist', () => {
    const clip = { clip_id: 'c', rank: 1, start: 0, end: 30, duration: 30, composite_score: 5, semantic_score: 0, audio_score: 0, visual_score: 0, trigger_score: 0, pacing_score: 0, metadata_score: 0, hook_moment: '', clip_titles: [], is_standalone: true, recommended_duration: 30, reason: '', transcript_excerpt: '' } as never;
    const files = { final: 'f', raw: 'r', srt: 's' };
    expect((buildClipJson(clip, 'j', files, undefined, [seg]) as { broll?: unknown[] }).broll).toHaveLength(1);
    expect('broll' in buildClipJson(clip, 'j', files)).toBe(false);
  });
});
