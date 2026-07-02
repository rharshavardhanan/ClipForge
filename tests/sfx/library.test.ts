import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSfxLibrary, pickSfx } from '../../src/sfx/library.js';

async function makeLib(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sfx-'));
  await mkdir(join(root, 'whoosh'), { recursive: true });
  await writeFile(join(root, 'whoosh', 'a.mp3'), 'x');
  await writeFile(join(root, 'whoosh', 'b.mp3'), 'x');
  await writeFile(join(root, 'impact_hit.wav'), 'x');   // filename-prefix form
  await writeFile(join(root, 'notes.txt'), 'x');        // ignored
  return root;
}

describe('scanSfxLibrary', () => {
  it('finds kind subfolders and kind_ prefixed files', async () => {
    const lib = await scanSfxLibrary(await makeLib());
    expect(lib.whoosh).toHaveLength(2);
    expect(lib.impact).toHaveLength(1);
    expect(lib.pop).toBeUndefined();
  });
  it('missing root → empty library', async () => {
    expect(await scanSfxLibrary('/nonexistent/sfx')).toEqual({});
  });
});

describe('pickSfx', () => {
  it('is deterministic for the same seed and null for an empty kind', async () => {
    const lib = await scanSfxLibrary(await makeLib());
    const a = pickSfx(lib, 'whoosh', 'clip_001_zoom_0');
    expect(a).toBe(pickSfx(lib, 'whoosh', 'clip_001_zoom_0'));
    expect(lib.whoosh).toContain(a);
    expect(pickSfx(lib, 'riser', 'seed')).toBeNull();
    expect(pickSfx({}, 'whoosh', 'seed')).toBeNull();
  });
});
