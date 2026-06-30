import { describe, it, expect } from 'vitest';
import { runAll } from '../../src/cli/commands/all.js';
import { probe } from '../../src/utils/ffmpeg.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const RUN = process.env.RUN_E2E === '1';
const URL = 'https://www.youtube.com/watch?v=H14bBuluwB8';

describe.skipIf(!RUN)('E2E: Goggins URL → finished clip', () => {
  it('produces a 1080x1920 captioned clip + manifest', async () => {
    const dir = await runAll(URL, { top: 3, style: 'bold', accent: '#FFD700' });
    const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
    expect(manifest.clips_generated).toBeGreaterThanOrEqual(1);

    const c1 = manifest.clips[0];
    expect(c1.duration).toBeGreaterThanOrEqual(30);
    expect(c1.duration).toBeLessThanOrEqual(90);

    const finalPath = join(dir, `${c1.clip_id}_final.mp4`);
    expect(existsSync(finalPath)).toBe(true);
    const p = await probe(finalPath);
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
  }, 600_000);
});
