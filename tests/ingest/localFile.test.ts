import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalInput, localJobId, ingestLocal } from '../../src/ingest/localFile.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cf-local-'));
  await writeFile(join(dir, 'video.mp4'), 'fake-video-bytes');
  await writeFile(join(dir, 'notes.txt'), 'not a video');
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('isLocalInput', () => {
  it('true only for existing files with a video extension', async () => {
    expect(isLocalInput(join(dir, 'video.mp4'))).toBe(true);
    expect(isLocalInput(join(dir, 'notes.txt'))).toBe(false);       // wrong extension
    expect(isLocalInput(join(dir, 'missing.mp4'))).toBe(false);     // doesn't exist
    expect(isLocalInput('https://www.youtube.com/watch?v=abc12345678')).toBe(false);
  });
});

describe('localJobId', () => {
  it('is stable for a path and prefixed local_', () => {
    const id = localJobId('/a/b/c.mp4');
    expect(id).toBe(localJobId('/a/b/c.mp4'));
    expect(id).toMatch(/^local_[0-9a-f]{10}$/);
    expect(localJobId('/other.mp4')).not.toBe(id);
  });
});

describe('ingestLocal', () => {
  it('copies the source into the job dir and reuses it on re-run', async () => {
    const src = join(dir, 'video.mp4');
    const out = join(dir, 'job');
    const first = await ingestLocal(src, out);
    expect(first.videoPath).toBe(join(out, 'video.mp4'));
    expect(first.subtitlePath).toBeNull();
    expect(await readFile(first.videoPath, 'utf8')).toBe('fake-video-bytes');

    await writeFile(first.videoPath, 'already-ingested'); // simulate cached copy
    const second = await ingestLocal(src, out);
    expect(await readFile(second.videoPath, 'utf8')).toBe('already-ingested'); // not re-copied
  });
});
