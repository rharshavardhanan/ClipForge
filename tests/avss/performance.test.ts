import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeReward, fetchVideoStats, fetchAnalytics, appendSnapshot, snapshotPath,
  type PerfSnapshot,
} from '../../src/avss/performance.js';

describe('computeReward', () => {
  const stats = { views: 1000, likes: 50, comments: 5, };

  it('full analytics: spec-weighted formula', () => {
    const r = computeReward(30, stats, { avgViewPct: 80, avgViewDurationSec: 24, shares: 10 });
    // retention .8, completion 24/30=.8, rewatch 0, likes min(1,20*.05)=1, comments min(1,200*.005)=1, shares min(1,100*.01)=1
    expect(r.retention).toBeCloseTo(0.8);
    expect(r.completion).toBeCloseTo(0.8);
    expect(r.rewatch).toBe(0);
    expect(r.likesNorm).toBe(1);
    expect(r.commentsNorm).toBe(1);
    expect(r.sharesNorm).toBe(1);
    expect(r.reward).toBeCloseTo(0.35 * 0.8 + 0.2 * 0.8 + 0 + 0.1 + 0.1 + 0.05);
    expect(r.partial).toBe(false);
  });

  it('Shorts looping past 100% counts as rewatch', () => {
    const r = computeReward(20, stats, { avgViewPct: 130, avgViewDurationSec: 26, shares: 0 });
    expect(r.retention).toBe(1);
    expect(r.rewatch).toBeCloseTo(0.6);
    expect(r.completion).toBe(1);
  });

  it('no analytics → partial, engagement-only components', () => {
    const r = computeReward(30, stats);
    expect(r.partial).toBe(true);
    expect(r.retention).toBe(0);
    expect(r.likesNorm).toBe(1);
  });

  it('zero views is safe', () => {
    const r = computeReward(30, { views: 0, likes: 0, comments: 0 });
    expect(r.reward).toBe(0);
    expect(Number.isNaN(r.likesNorm)).toBe(false);
  });
});

describe('fetchVideoStats', () => {
  it('maps ids to statistics and chunks requests at 50', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        items: [
          { id: 'a', statistics: { viewCount: '100', likeCount: '10', commentCount: '2' } },
          { id: 'b', statistics: { viewCount: '5' } },
        ],
      }));
    }) as unknown as typeof fetch;
    const m = await fetchVideoStats(['a', 'b'], 'tok', fetchFn);
    expect(m.get('a')).toEqual({ views: 100, likes: 10, comments: 2 });
    expect(m.get('b')).toEqual({ views: 5, likes: 0, comments: 0 });
    expect(calls).toHaveLength(1);

    const many = Array.from({ length: 51 }, (_, i) => `v${i}`);
    await fetchVideoStats(many, 'tok', fetchFn);
    expect(calls).toHaveLength(3); // 1 + 2 chunks
  });
});

describe('fetchAnalytics', () => {
  it('parses a report row', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({
      columnHeaders: [{ name: 'averageViewPercentage' }, { name: 'averageViewDuration' }, { name: 'shares' }],
      rows: [[85.5, 24, 3]],
    }))) as unknown as typeof fetch;
    expect(await fetchAnalytics('vid', 'tok', fetchFn)).toEqual({
      avgViewPct: 85.5, avgViewDurationSec: 24, shares: 3,
    });
  });

  it('403 → no-scope (old token without yt-analytics scope)', async () => {
    const fetchFn = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    expect(await fetchAnalytics('vid', 'tok', fetchFn)).toBe('no-scope');
  });

  it('no rows → no-scope-safe zeros treated as missing', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ rows: [] }))) as unknown as typeof fetch;
    expect(await fetchAnalytics('vid', 'tok', fetchFn)).toBeUndefined();
  });
});

describe('appendSnapshot', () => {
  it('creates then appends history per videoId', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'avss-perf-'));
    const snap: PerfSnapshot = {
      videoId: 'vid1', clip_id: 'clip_001', exportsDir: '/x', measured_at: 'now',
      stats: { views: 1, likes: 0, comments: 0 },
    };
    await appendSnapshot(snap, ws);
    await appendSnapshot({ ...snap, measured_at: 'later' }, ws);
    const j = JSON.parse(await readFile(snapshotPath('vid1', ws), 'utf8'));
    expect(j.history).toHaveLength(2);
    expect(j.history[1].measured_at).toBe('later');
  });
});
