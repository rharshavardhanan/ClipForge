import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClipJson, buildManifest, writeExports, buildBrollEntries, buildBrollManifest, buildAvssFiles, buildAvssBlock, type AvssExport, type UnderstandingExport } from '../../src/export/exporter.js';
import { buildSeoPack } from '../../src/export/seo.js';
import type { RankedClip, VideoMetadata } from '../../src/types/index.js';
import type { ScoredVariant } from '../../src/avss/variants.js';

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

describe('AVSS exports (v7)', () => {
  const sim = {
    attention: [{ t: 0, v: 0.5 }, { t: 0.5, v: 0.6 }],
    dopamine: [{ t: 1, kind: 'impact' as const, strength: 0.8 }],
    hazard: [{ t: 0, v: 0.02 }, { t: 0.5, v: 0.01 }],
    retention: [{ t: 0, v: 0.98 }, { t: 0.5, v: 0.97 }],
    avgRetention: 0.975, completion: 0.97, rewatch: 0.4,
    rewatchFactors: { surpriseHumor: 0.2, loopPull: 0.1, tightness: 0.1, endSpike: 0 },
    dropoffs: [0], overall: 0.71,
  };
  const winner: ScoredVariant = {
    variant: {
      id: 'B', changed: ['captionPreset'], violations: [],
      plan: {
        hookText: 'wait', hookSource: 'moment', captionPreset: 'gaming',
        zoom: { enabled: true, times: [3], intensity: 1 },
        sfx: { enabled: true, volume: 0.6 }, brollWindows: [], musicOn: false,
      },
    },
    sim,
  };
  const loser: ScoredVariant = {
    ...winner,
    variant: { ...winner.variant, id: 'A', changed: [] },
    sim: { ...sim, overall: 0.6 },
  };
  const avss: AvssExport = {
    winner, all: [loser, winner],
    dna: {
      mode: 'clippies', captionPreset: 'gaming', hookSource: 'moment',
      zoomPer10s: 1, zoomIntensity: 1, firstZoomAt: 3, sfxOn: true,
      brollCoverage: 0, wordsPerSec: 2,
    },
    policyVersion: 1,
  };

  it('buildAvssFiles emits the five spec output files with expected keys', () => {
    const files = buildAvssFiles('clip_001', avss);
    expect(Object.keys(files).sort()).toEqual([
      'clip_001_attention_graph.json',
      'clip_001_edit_variant_scores.json',
      'clip_001_retention_prediction.json',
      'clip_001_rewatch_score.json',
      'clip_001_swipe_risk.json',
    ]);
    expect(files['clip_001_attention_graph.json']).toMatchObject({ tick: 0.5, attention: sim.attention, dopamine: sim.dopamine });
    expect(files['clip_001_retention_prediction.json']).toMatchObject({ avg_retention: 0.975, completion: 0.97, dropoffs: [0] });
    expect(files['clip_001_swipe_risk.json']).toMatchObject({ hazard: sim.hazard, top_risks: [0] });
    expect(files['clip_001_rewatch_score.json']).toMatchObject({ score: 0.4, factors: sim.rewatchFactors });
    const variants = files['clip_001_edit_variant_scores.json'] as { id: string; winner: boolean }[];
    expect(variants.map((v) => [v.id, v.winner])).toEqual([['A', false], ['B', true]]);
  });

  it('buildAvssBlock summarizes winner + predictions for clip.json', () => {
    const block = buildAvssBlock(avss);
    expect(block).toMatchObject({
      variant: 'B', changed: ['captionPreset'], policy_version: 1,
      predicted: { retention: 0.975, completion: 0.97, rewatch: 0.4, overall: 0.71 },
    });
    expect(block.dna.captionPreset).toBe('gaming');
  });

  it('writeExports writes AVSS files + block only for clips with an entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exports-avss-'));
    const clip2: RankedClip = { ...clip, clip_id: 'clip_002', rank: 2 };
    await writeExports(dir, 'H14bBuluwB8', 'src', meta, [clip, clip2], undefined, undefined,
      new Map([['clip_001', avss]]));
    const j1 = JSON.parse(await readFile(join(dir, 'clip_001.json'), 'utf8'));
    expect(j1.avss.variant).toBe('B');
    expect(JSON.parse(await readFile(join(dir, 'clip_001_attention_graph.json'), 'utf8')).tick).toBe(0.5);
    const j2 = JSON.parse(await readFile(join(dir, 'clip_002.json'), 'utf8'));
    expect('avss' in j2).toBe(false);
    await expect(readFile(join(dir, 'clip_002_attention_graph.json'), 'utf8')).rejects.toThrow();

    // the GUI reads predicted retention from the manifest
    const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
    expect(manifest.clips[0].predicted_retention).toBeCloseTo(0.975);
    expect('predicted_retention' in manifest.clips[1]).toBe(false);
  });
});

// ---- v7 arc engine blocks -----------------------------------------------------------------
describe('exporter arc blocks', () => {
  const arc = {
    complete: true, missing: [] as string[], arcScore: 0.87, synopsis: 'setup to payoff',
    reactionAfterPeak: true, provider: 'gemini',
    components: { setup: { start: 10, end: 14 }, trigger: { start: 13, end: 14 }, escalation: { start: 14, end: 18 }, peak: { start: 18, end: 20 }, payoff: { start: 20, end: 23 }, reaction: { start: 23, end: 26 } },
  };

  it('clip json carries the arc block verbatim when provided', () => {
    const j: any = buildClipJson(clip, 'H14bBuluwB8', { final: 'f.mp4', raw: 'r.mp4', srt: 's.srt' }, undefined, undefined, undefined, arc);
    expect(j.arc).toEqual(arc);
  });
  it('no arc data → clip json has NO arc key and manifest arc_rejections is []', () => {
    const j: any = buildClipJson(clip, 'H14bBuluwB8', { final: 'f.mp4', raw: 'r.mp4', srt: 's.srt' });
    expect('arc' in j).toBe(false);
    const m: any = buildManifest('job', 'src', meta, [clip]);
    expect(m.arc_rejections).toEqual([]);
    expect('arc_complete' in m.clips[0]).toBe(false);
  });
  it('manifest marks arc_complete per clip and carries arc_rejections', () => {
    const rejections = [{ clip_id: 'clip_009', start: 100, end: 120, missing: ['payoff'], reason: 'incomplete-arc' }];
    const m: any = buildManifest('job', 'src', meta, [clip], undefined, new Map([['clip_001', { ...arc, complete: false }]]), rejections);
    expect(m.clips[0].arc_complete).toBe(false);
    expect(m.arc_rejections).toEqual(rejections);
  });
  it('writeExports writes the arc block into the clip json on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arc-exp-'));
    await writeExports(dir, 'job', 'src', meta, [clip], undefined, undefined, undefined, new Map([['clip_001', arc]]), []);
    const j: any = JSON.parse(await readFile(join(dir, 'clip_001.json'), 'utf8'));
    expect(j.arc.synopsis).toBe('setup to payoff');
    const m: any = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
    expect(m.clips[0].arc_complete).toBe(true);
  });
});

describe('quality + EDL exports (v4 Slice A)', () => {
  const quality = {
    gates: [{ gate: 'narrative', outcome: { status: 'pass' as const } }],
    passed: true, degraded: true,
    degradations: ['FRAMING_FALLBACK_CENTER_CROP'] as never,
    reasonCodes: ['FRAMING_FALLBACK_CENTER_CROP'] as never,
  };
  const edl = {
    clip_id: 'clip_001', source_span: { start: 10, end: 40 },
    segments: [{ srcStart: 10, srcEnd: 40, speed: 1 }], framing: 'blur' as const,
    crop_track: null, caption_cues: [], zoom_times: [], sfx_event_times: [],
    audio_ops: [], caption_preset: 'mrbeast', music: true, rationale: {},
  };

  it('buildQualityBlock summarizes gates + degradation', async () => {
    const { buildQualityBlock } = await import('../../src/export/exporter.js');
    const b = buildQualityBlock(quality);
    expect(b.passed).toBe(true);
    expect(b.degraded).toBe(true);
    expect(b.degradations).toContain('FRAMING_FALLBACK_CENTER_CROP');
    expect(b.gates[0]).toMatchObject({ gate: 'narrative', status: 'pass' });
  });

  it('writeExports writes clip_NNN_edl.json + quality block only for clips in the maps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exports-qa-'));
    const clip2: RankedClip = { ...clip, clip_id: 'clip_002', rank: 2 };
    await writeExports(dir, 'H14bBuluwB8', 'src', meta, [clip, clip2], undefined, undefined,
      undefined, undefined, undefined,
      new Map([['clip_001', quality as never]]), new Map([['clip_001', edl as never]]));
    const j1 = JSON.parse(await readFile(join(dir, 'clip_001.json'), 'utf8'));
    expect(j1.quality.degraded).toBe(true);
    expect(JSON.parse(await readFile(join(dir, 'clip_001_edl.json'), 'utf8')).clip_id).toBe('clip_001');
    const j2 = JSON.parse(await readFile(join(dir, 'clip_002.json'), 'utf8'));
    expect('quality' in j2).toBe(false);
    await expect(readFile(join(dir, 'clip_002_edl.json'), 'utf8')).rejects.toThrow();
  });
});

describe('selection rationale (v4 Slice B)', () => {
  it('buildSelectionWhy names the top contributors', async () => {
    const { buildSelectionWhy } = await import('../../src/export/exporter.js');
    expect(buildSelectionWhy({ visual: 0.9, composite: 8, semantic: 8, fillerPenalty: 0 }, 'dunks', true))
      .toMatch(/clear on-screen subject/);
    expect(buildSelectionWhy({ visual: 0.3, composite: 8, semantic: 3, fillerPenalty: 0.3 }, 'x', false))
      .toMatch(/framing-hostile|filler/);
    expect(buildSelectionWhy({ visual: 0.6, composite: 5, semantic: 5, fillerPenalty: 0 }, 'newtopic', true))
      .toMatch(/fresh topic/);
  });

  it('buildClipJson embeds a selection block only when provided', async () => {
    const { buildClipJson } = await import('../../src/export/exporter.js');
    const sel = { features: { composite: 8, visual: 0.8, semantic: 7, filler_penalty: 0, topic: 't' }, why: 'strong composite score' };
    const withSel = buildClipJson(clip, 'j', { final: 'f', raw: 'r', srt: 's' }, undefined, undefined, undefined, undefined, undefined, sel) as { selection?: unknown };
    expect(withSel.selection).toEqual(sel);
    expect('selection' in buildClipJson(clip, 'j', { final: 'f', raw: 'r', srt: 's' })).toBe(false);
  });
});

// ---- SP2 understanding exports -------------------------------------------------------------
describe('understanding exports (SP2)', () => {
  const understanding: UnderstandingExport = { scene_labels: ['gym bet'], edge_types: ['pays_off'] };

  it('buildClipJson embeds the understanding block only when provided', () => {
    const withU = buildClipJson(
      clip, 'H14bBuluwB8', { final: 'f.mp4', raw: 'r.mp4', srt: 's.srt' },
      undefined, undefined, undefined, undefined, undefined, undefined, understanding,
    ) as { understanding?: unknown };
    expect(withU.understanding).toEqual(understanding);
    expect('understanding' in buildClipJson(clip, 'H14bBuluwB8', { final: 'f.mp4', raw: 'r.mp4', srt: 's.srt' })).toBe(false);
  });

  it('buildManifest carries the manifest-level understanding summary only when provided', () => {
    const m: any = buildManifest('job', 'src', meta, [clip], undefined, undefined, undefined, undefined,
      { scenes: 3, edges: 2, provider: 'gemini' });
    expect(m.understanding).toEqual({ scenes: 3, edges: 2, provider: 'gemini' });
    const m2: any = buildManifest('job', 'src', meta, [clip]);
    expect('understanding' in m2).toBe(false);
  });

  it('clip.json carries the understanding block and manifest carries counts when provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exports-understanding-'));
    const uMap = new Map([[clip.clip_id, understanding]]);
    await writeExports(dir, 'job', 'url', meta, [clip], undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, uMap, { scenes: 3, edges: 2, provider: 'gemini' });
    const clipJson = JSON.parse(await readFile(join(dir, `${clip.clip_id}.json`), 'utf8'));
    expect(clipJson.understanding).toEqual({ scene_labels: ['gym bet'], edge_types: ['pays_off'] });
    const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
    expect(manifest.understanding).toEqual({ scenes: 3, edges: 2, provider: 'gemini' });
  });
});
