import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSeoPack, writeSeoFiles, slugTag } from '../../src/export/seo.js';
import type { RankedClip, VideoMetadata } from '../../src/types/index.js';

const clip: RankedClip = {
  rank: 1, clip_id: 'clip_001', start: 10, end: 40, duration: 30,
  composite_score: 9, semantic_score: 8, audio_score: 7, visual_score: 0,
  trigger_score: 6, pacing_score: 0, metadata_score: 0,
  hook_moment: 'he actually jumped off the roof into the pool',
  clip_titles: ['He Actually Did It'], is_standalone: true,
  recommended_duration: 30, reason: 'big payoff', transcript_excerpt: 'watch this he actually jumped',
  sentiment: 'intense',
};
const meta: VideoMetadata = {
  jobId: 'j1', title: 'CRAZY 24 Hour Challenge', duration: 1200, width: 1920, height: 1080,
  fps: 30, codec: 'h264', chapters: [], description: '',
  channelName: 'IShowSpeed', tags: ['speed', 'challenge', 'funny moments'],
};

describe('slugTag', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(slugTag('Kai Cenat')).toBe('#kaicenat');
    expect(slugTag('!!!')).toBeNull();
  });
});

describe('buildSeoPack', () => {
  it('title = clip title + creator/shorts tags', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.title).toContain('He Actually Did It');
    expect(p.title).toContain('#ishowspeed');
    expect(p.title).toContain('#shorts');
  });

  it('hashtags are lowercase, deduped, #-prefixed, capped at 15', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.hashtags.length).toBeLessThanOrEqual(15);
    expect(new Set(p.hashtags).size).toBe(p.hashtags.length);
    for (const h of p.hashtags) expect(h).toMatch(/^#[a-z0-9]+$/);
    expect(p.hashtags).toContain('#ishowspeed');   // creator
    expect(p.hashtags).toContain('#shorts');       // viral
    expect(p.hashtags).toContain('#challenge');    // niche (from meta.tags)
  });

  it('description credits the source video and embeds hashtags', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.description).toContain('CRAZY 24 Hour Challenge');
    expect(p.description).toContain('#shorts');
  });

  it('description links the source URL when the clip has one', () => {
    const p = buildSeoPack({ ...clip, source_url: 'https://youtu.be/x' }, meta);
    expect(p.description).toContain('https://youtu.be/x');
  });

  it('hookText is uppercase, <= 8 words', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.hookText).toBe(p.hookText.toUpperCase());
    expect(p.hookText.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it('thumbnailText is uppercase, <= 4 words', () => {
    const p = buildSeoPack(clip, meta);
    expect(p.thumbnailText).toBe(p.thumbnailText.toUpperCase());
    expect(p.thumbnailText.split(/\s+/).length).toBeLessThanOrEqual(4);
  });

  it('falls back gracefully with no semantic titles / channel', () => {
    const bare = { ...clip, clip_titles: [], hook_moment: '' };
    const bareMeta = { ...meta, channelName: undefined, tags: undefined };
    const p = buildSeoPack(bare, bareMeta);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.hookText.length).toBeGreaterThan(0);
    expect(p.thumbnailText.length).toBeGreaterThan(0);
    expect(p.hashtags).toContain('#shorts');
  });
});

describe('writeSeoFiles', () => {
  it('writes the four per-clip SEO text files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seo-'));
    const pack = buildSeoPack(clip, meta);
    await writeSeoFiles(dir, 'clip_001', pack);
    expect(await readFile(join(dir, 'clip_001_title.txt'), 'utf8')).toContain('He Actually Did It');
    expect(await readFile(join(dir, 'clip_001_description.txt'), 'utf8')).toContain('#shorts');
    expect(await readFile(join(dir, 'clip_001_hashtags.txt'), 'utf8')).toContain('#ishowspeed');
    expect((await readFile(join(dir, 'clip_001_hook.txt'), 'utf8')).trim()).toBe(pack.hookText);
  });
});
