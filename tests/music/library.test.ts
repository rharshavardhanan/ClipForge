import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sentimentToMood, scanLibrary, pickTrack, type Mood } from '../../src/music/library.js';

describe('sentimentToMood', () => {
  it('maps clip sentiments onto music moods', () => {
    expect(sentimentToMood('funny')).toBe('funny');
    expect(sentimentToMood('intense')).toBe('intense');
    expect(sentimentToMood('serious')).toBe('motivational');
    expect(sentimentToMood('neutral')).toBe('chill');
    expect(sentimentToMood(undefined)).toBe('chill');
  });
});

describe('scanLibrary', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'cf-music-'));
    await mkdir(join(root, 'intense'), { recursive: true });
    await writeFile(join(root, 'intense', 'war-drums.mp3'), '');
    await writeFile(join(root, 'intense', 'notes.txt'), ''); // ignored: not audio
    await writeFile(join(root, 'funny_kazoo.mp3'), '');      // prefix convention at root
    await writeFile(join(root, 'random.mp3'), '');           // no mood → ignored
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('collects mood subfolder audio and mood-prefixed root files', async () => {
    const lib = await scanLibrary(root);
    expect(lib.intense).toEqual([join(root, 'intense', 'war-drums.mp3')]);
    expect(lib.funny).toEqual([join(root, 'funny_kazoo.mp3')]);
    expect(lib.motivational).toBeUndefined();
  });

  it('returns {} for a missing root', async () => {
    expect(await scanLibrary(join(root, 'nope'))).toEqual({});
  });
});

describe('pickTrack', () => {
  const lib: Partial<Record<Mood, string[]>> = {
    intense: ['/m/a.mp3', '/m/b.mp3', '/m/c.mp3'],
    chill: ['/m/z.mp3'],
  };

  it('is deterministic for the same seed and varies across seeds', () => {
    const first = pickTrack(lib, 'intense', 'clip_001');
    expect(pickTrack(lib, 'intense', 'clip_001')).toBe(first);
    const picks = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => pickTrack(lib, 'intense', s)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('falls back to chill when the mood has no tracks, null when nothing fits', () => {
    expect(pickTrack(lib, 'funny', 'x')).toBe('/m/z.mp3');
    expect(pickTrack({}, 'funny', 'x')).toBeNull();
  });
});
