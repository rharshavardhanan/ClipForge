import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStats, collectTargets, dnaToChoice } from '../../src/cli/commands/stats.js';
import { loadPolicy } from '../../src/avss/policy.js';
import { snapshotPath } from '../../src/avss/performance.js';
import type { EditDna } from '../../src/avss/templates.js';

const dna: EditDna = {
  mode: 'clippies', captionPreset: 'gaming', hookSource: 'moment',
  zoomPer10s: 2, zoomIntensity: 1, firstZoomAt: 3, sfxOn: true,
  brollCoverage: 0, wordsPerSec: 2,
};

async function makeWorkspace(clipJson: Record<string, unknown>): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), 'avss-stats-ws-'));
  const dir = join(ws, 'exports', 'run1');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'clips_manifest.json'), JSON.stringify({ clips: [{ clip_id: 'clip_001' }] }));
  await writeFile(join(dir, 'clip_001.json'), JSON.stringify(clipJson));
  return ws;
}

const uploadedClip = {
  clip_id: 'clip_001', duration: 30,
  youtube: { videoId: 'vid1', url: 'https://youtu.be/vid1' },
  avss: { variant: 'B', dna, predicted: {}, policy_version: 1 },
};

function mockFetch(opts: { analyticsStatus?: number; avgViewPct?: number }): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('youtube/v3/videos')) {
      return new Response(JSON.stringify({
        items: [{ id: 'vid1', statistics: { viewCount: '1000', likeCount: '50', commentCount: '5' } }],
      }));
    }
    if (u.includes('youtubeanalytics')) {
      if (opts.analyticsStatus) return new Response('{}', { status: opts.analyticsStatus });
      return new Response(JSON.stringify({
        columnHeaders: [{ name: 'averageViewPercentage' }, { name: 'averageViewDuration' }, { name: 'shares' }],
        rows: [[opts.avgViewPct ?? 75, 24, 10]],
      }));
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
}

describe('dnaToChoice', () => {
  it('maps DNA to the policy arms it pulled', () => {
    expect(dnaToChoice(dna)).toEqual({ captionPreset: 'gaming', hookSource: 'moment', zoomBucket: 'tight', sfxOn: true });
    expect('hookSource' in dnaToChoice({ ...dna, hookSource: 'none' })).toBe(false);
    expect(dnaToChoice({ ...dna, zoomPer10s: 1 }).zoomBucket).toBe('sparse');
  });
});

describe('collectTargets', () => {
  it('finds uploaded clips, skips ones without youtube block', async () => {
    const ws = await makeWorkspace(uploadedClip);
    const targets = await collectTargets([], ws);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ clip_id: 'clip_001', videoId: 'vid1', durationSec: 30 });

    const ws2 = await makeWorkspace({ clip_id: 'clip_001', duration: 30 });
    expect(await collectTargets([], ws2)).toHaveLength(0);
  });
});

describe('runStats', () => {
  it('full path: snapshot written, policy updated, 75% retention promotes an elite template', async () => {
    const ws = await makeWorkspace(uploadedClip);
    const templates = await mkdtemp(join(tmpdir(), 'avss-stats-tpl-'));
    await runStats([], {
      wsDir: ws, templatesDir: templates,
      fetchFn: mockFetch({ avgViewPct: 75 }),
      getToken: async () => 'tok',
    });

    const snap = JSON.parse(await readFile(snapshotPath('vid1', ws), 'utf8'));
    expect(snap.history).toHaveLength(1);
    expect(snap.history[0].rewardBreakdown.partial).toBe(false);

    const policy = await loadPolicy(ws);
    expect(policy.modes.clippies.captionPreset.gaming.n).toBe(1);
    expect(policy.modes.clippies.zoomBucket.tight.n).toBe(1);

    expect(await readdir(templates)).toEqual(['elite_template_v1.json']);
  });

  it('no-scope path: snapshot partial, policy untouched, nothing promoted', async () => {
    const ws = await makeWorkspace(uploadedClip);
    const templates = await mkdtemp(join(tmpdir(), 'avss-stats-tpl2-'));
    await runStats([], {
      wsDir: ws, templatesDir: templates,
      fetchFn: mockFetch({ analyticsStatus: 403 }),
      getToken: async () => 'tok',
    });

    const snap = JSON.parse(await readFile(snapshotPath('vid1', ws), 'utf8'));
    expect(snap.history[0].rewardBreakdown.partial).toBe(true);
    const policy = await loadPolicy(ws);
    expect(policy.modes.clippies.captionPreset).toEqual({});
    expect(await readdir(templates)).toEqual([]);
  });

  it('sub-70% retention updates the policy but does not promote', async () => {
    const ws = await makeWorkspace(uploadedClip);
    const templates = await mkdtemp(join(tmpdir(), 'avss-stats-tpl3-'));
    await runStats([], {
      wsDir: ws, templatesDir: templates,
      fetchFn: mockFetch({ avgViewPct: 40 }),
      getToken: async () => 'tok',
    });
    expect((await loadPolicy(ws)).modes.clippies.captionPreset.gaming.n).toBe(1);
    expect(await readdir(templates)).toEqual([]);
  });

  it('upload-only token (videos.list 403) → actionable re-auth message, no throw', async () => {
    const ws = await makeWorkspace(uploadedClip);
    const fetchFn = (async () => new Response(JSON.stringify({
      error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] },
    }), { status: 403 })) as typeof fetch;
    await expect(runStats([], { wsDir: ws, fetchFn, getToken: async () => 'tok' })).resolves.toBeUndefined();
    expect((await loadPolicy(ws)).version).toBe(1); // untouched
  });

  it('no uploaded clips → clean exit, no policy file', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'avss-stats-empty-'));
    await runStats([], { wsDir: ws, getToken: async () => { throw new Error('should not be called'); } });
    expect((await loadPolicy(ws)).version).toBe(1);
  });
});
