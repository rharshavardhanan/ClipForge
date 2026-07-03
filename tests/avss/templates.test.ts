import { describe, it, expect } from 'vitest';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractDna, dnaSimilar, loadTemplates, saveEliteTemplate, applyTemplate, type EditDna,
} from '../../src/avss/templates.js';
import type { EditPlan, SourceSignals } from '../../src/avss/editPlan.js';
import type { CaptionWord, SemanticScores } from '../../src/types/index.js';

const zeroScores: SemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

const w = (start: number, emphasized = false): CaptionWord =>
  ({ text: 'word', start, end: start + 0.3, emphasized });

function plan(over: Partial<EditPlan> = {}): EditPlan {
  return {
    hookText: 'wait for it', hookSource: 'moment', captionPreset: 'mrbeast',
    zoom: { enabled: true, times: [3, 8, 13], intensity: 1 },
    sfx: { enabled: true, volume: 0.6 },
    brollWindows: [{ atSec: 5, durationSec: 4 }], musicOn: false,
    ...over,
  };
}

function signals(durationSec = 20, wordCount = 40): SourceSignals {
  return {
    durationSec,
    words: Array.from({ length: wordCount }, (_, i) => w((i + 1) * (durationSec / (wordCount + 1)), i % 5 === 0)),
    rms: [], silences: [], semantic: zeroScores,
  };
}

describe('extractDna', () => {
  it('captures densities, intensity, first zoom, coverage and pacing', () => {
    const dna = extractDna(plan(), signals(20, 40), 'clippies');
    expect(dna.mode).toBe('clippies');
    expect(dna.captionPreset).toBe('mrbeast');
    expect(dna.hookSource).toBe('moment');
    expect(dna.zoomPer10s).toBeCloseTo(1.5);
    expect(dna.zoomIntensity).toBe(1);
    expect(dna.firstZoomAt).toBe(3);
    expect(dna.sfxOn).toBe(true);
    expect(dna.brollCoverage).toBeCloseTo(0.2);
    expect(dna.wordsPerSec).toBeCloseTo(2);
  });
  it('handles no zooms', () => {
    const dna = extractDna(plan({ zoom: { enabled: false, times: [], intensity: 1 } }), signals(), 'clippies');
    expect(dna.zoomPer10s).toBe(0);
    expect(dna.firstZoomAt).toBeNull();
  });
});

describe('dnaSimilar', () => {
  const base = extractDna(plan(), signals(), 'clippies');
  it('same mode+preset+hookSource and close zoom density → similar', () => {
    expect(dnaSimilar(base, { ...base, zoomPer10s: base.zoomPer10s + 0.4 })).toBe(true);
  });
  it('different preset or far zoom density → not similar', () => {
    expect(dnaSimilar(base, { ...base, captionPreset: 'gaming' })).toBe(false);
    expect(dnaSimilar(base, { ...base, zoomPer10s: base.zoomPer10s + 1 })).toBe(false);
  });
});

describe('save/load elite templates', () => {
  it('versions incrementally, dedupes similar DNA, loads from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avss-templates-'));
    const dna = extractDna(plan(), signals(), 'clippies');
    const meta = { videoId: 'vid1', clip_id: 'clip_001', retention: 0.78 };

    const t1 = await saveEliteTemplate(dna, meta, dir);
    expect(t1?.version).toBe(1);
    // similar DNA → dedupe: nothing new written
    expect(await saveEliteTemplate({ ...dna, zoomPer10s: dna.zoomPer10s + 0.2 }, meta, dir)).toBeNull();
    const t2 = await saveEliteTemplate({ ...dna, captionPreset: 'gaming' }, { ...meta, retention: 0.81 }, dir);
    expect(t2?.version).toBe(2);

    const files = await readdir(dir);
    expect(files.sort()).toEqual(['elite_template_v1.json', 'elite_template_v2.json']);
    const loaded = await loadTemplates(dir);
    expect(loaded.map((t) => t.version)).toEqual([1, 2]);
    expect(loaded[0].retention).toBe(0.78);
  });
  it('missing dir → empty list', async () => {
    expect(await loadTemplates('/nonexistent/elite_templates')).toEqual([]);
  });
});

describe('applyTemplate', () => {
  const words = signals(20, 40).words;
  it('overrides preset + zoom shape, leaves broll/music/framing inputs untouched', () => {
    const dna: EditDna = {
      mode: 'clippies', captionPreset: 'gaming', hookSource: 'moment',
      zoomPer10s: 2, zoomIntensity: 0.8, firstZoomAt: 2, sfxOn: true,
      brollCoverage: 0, wordsPerSec: 2,
    };
    const base = plan({ captionPreset: 'mrbeast' });
    const out = applyTemplate(dna, base, words);
    expect(out.captionPreset).toBe('gaming');
    expect(out.zoom.intensity).toBe(0.8);
    expect(out.zoom.times.length).toBeGreaterThan(0);
    expect(out.brollWindows).toEqual(base.brollWindows);
    expect(out.musicOn).toBe(base.musicOn);
  });
  it('sparse zoom density → sparse bucket (fewer, wider-spaced zooms)', () => {
    const dna: EditDna = {
      mode: 'clippies', captionPreset: 'mrbeast', hookSource: 'moment',
      zoomPer10s: 0.5, zoomIntensity: 1, firstZoomAt: 4, sfxOn: true,
      brollCoverage: 0, wordsPerSec: 2,
    };
    const out = applyTemplate(dna, plan(), words);
    expect(out.zoom.times.length).toBeLessThanOrEqual(2);
  });
  it('does not disable zooms on a zooms-off base', () => {
    const dna: EditDna = {
      mode: 'clippies', captionPreset: 'mrbeast', hookSource: 'moment',
      zoomPer10s: 2, zoomIntensity: 1, firstZoomAt: 2, sfxOn: true,
      brollCoverage: 0, wordsPerSec: 2,
    };
    const base = plan({ zoom: { enabled: false, times: [], intensity: 1 } });
    expect(applyTemplate(dna, base, words).zoom.enabled).toBe(false);
  });
});
