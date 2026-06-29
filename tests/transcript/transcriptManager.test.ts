import { describe, it, expect, afterEach } from 'vitest';
import { getTranscript } from '../../src/transcript/transcriptManager.js';
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = join('workspace', 'temp', 'tm-test');
const subPath = join(dir, 'video.en.json3');
const outPath = join(dir, 'transcript.json');

const json3 = JSON.stringify({ events: [
  { tStartMs: 0, segs: [{ utf8: 'Hello', tOffsetMs: 0 }, { utf8: ' world.', tOffsetMs: 300 }] },
]});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('getTranscript', () => {
  it('prefers json3 subtitles and writes transcript.json', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(subPath, json3);
    const segs = await getTranscript({ jobId: 'x', videoPath: 'unused.mp4', subtitlePath: subPath, outPath });
    expect(segs[0].text).toBe('Hello world.');
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written[0].text).toBe('Hello world.');
  });

  it('reuses cached transcript.json when present', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(outPath, JSON.stringify([{ id: 0, start: 0, end: 1, text: 'cached', words: [] }]));
    const segs = await getTranscript({ jobId: 'x', videoPath: 'unused.mp4', subtitlePath: null, outPath });
    expect(segs[0].text).toBe('cached');
  });
});
