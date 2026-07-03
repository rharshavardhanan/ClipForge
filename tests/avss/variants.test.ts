import { describe, it, expect } from 'vitest';
import { generateVariants, scoreVariants, pickWinner } from '../../src/avss/variants.js';
import { defaultPolicy, updatePolicy } from '../../src/avss/policy.js';
import type { EliteTemplate } from '../../src/avss/templates.js';
import type { EditPlan, SourceSignals } from '../../src/avss/editPlan.js';
import type { CaptionWord, SemanticScores } from '../../src/types/index.js';

const zeroScores: SemanticScores = {
  emotional_intensity: 0, controversy: 0, humor: 0, surprise: 0,
  wisdom: 0, storytelling_tension: 0, argument_peak: 0, relatability: 0,
};

const w = (start: number, emphasized = false): CaptionWord =>
  ({ text: 'word', start, end: start + 0.3, emphasized });

const words: CaptionWord[] = Array.from({ length: 40 }, (_, i) => w(0.5 + i * 0.5, i % 4 === 0));

function base(over: Partial<EditPlan> = {}): EditPlan {
  return {
    hookText: 'wait for it', hookSource: 'moment', captionPreset: 'mrbeast',
    zoom: { enabled: true, times: [2.5, 6, 9.5, 13], intensity: 1 },
    sfx: { enabled: true, volume: 0.6 },
    brollWindows: [{ atSec: 5, durationSec: 3 }], musicOn: false,
    ...over,
  };
}

function ctx(over: Partial<Parameters<typeof generateVariants>[1]> = {}) {
  return {
    mode: 'clippies' as const,
    policy: defaultPolicy(),
    templates: [] as EliteTemplate[],
    pins: {},
    seed: 'job_clip_001',
    words,
    durationSec: 20,
    hookAlternatives: { moment: 'wait for it here it comes now', title: 'The craziest moment ever' },
    ...over,
  };
}

const signals: SourceSignals = {
  durationSec: 20, words,
  rms: Array.from({ length: 21 }, (_, i) => ({ time: i, rms: 6 })),
  silences: [], semantic: { ...zeroScores, humor: 0.6, emotional_intensity: 0.5 },
};

describe('generateVariants', () => {
  it('produces exactly A, B, C', () => {
    expect(generateVariants(base(), ctx()).map((v) => v.id)).toEqual(['A', 'B', 'C']);
  });

  it('is deterministic for the same seed', () => {
    expect(generateVariants(base(), ctx())).toEqual(generateVariants(base(), ctx()));
  });

  it('B and C each declare 1-2 changed dims that match reality', () => {
    const [a, b, c] = generateVariants(base(), ctx());
    for (const v of [b, c]) {
      expect(v.changed.length).toBeGreaterThanOrEqual(1);
      expect(v.changed.length).toBeLessThanOrEqual(2);
    }
    if (b.changed.includes('captionPreset')) expect(b.plan.captionPreset).not.toBe(a.plan.captionPreset);
    if (c.changed.includes('hookSource')) expect(c.plan.hookSource).not.toBe(a.plan.hookSource);
  });

  it('never varies framing inputs: broll and music identical across variants', () => {
    const [a, b, c] = generateVariants(base(), ctx());
    expect(b.plan.brollWindows).toEqual(a.plan.brollWindows);
    expect(c.plan.brollWindows).toEqual(a.plan.brollWindows);
    expect(b.plan.musicOn).toBe(a.plan.musicOn);
    expect(c.plan.musicOn).toBe(a.plan.musicOn);
  });

  it('respects pins: pinned preset identical everywhere, pinned zooms stay off', () => {
    const vs = generateVariants(
      base({ zoom: { enabled: false, times: [], intensity: 1 } }),
      ctx({ pins: { captionPreset: true, zooms: true } }),
    );
    for (const v of vs) {
      expect(v.plan.captionPreset).toBe('mrbeast');
      expect(v.plan.zoom.enabled).toBe(false);
      expect(v.plan.zoom.times).toEqual([]);
      expect(v.changed).not.toContain('captionPreset');
      expect(v.changed).not.toContain('zoomBucket');
    }
  });

  it('caption presets stay within the mode family', () => {
    for (const v of generateVariants(base(), ctx())) {
      expect(['mrbeast', 'gaming', 'hormozi']).toContain(v.plan.captionPreset);
    }
  });

  it('exploit A uses learned best arms', () => {
    let policy = defaultPolicy();
    policy = updatePolicy(policy, 'clippies', { captionPreset: 'hormozi' }, 0.9);
    policy = updatePolicy(policy, 'clippies', { captionPreset: 'mrbeast' }, 0.1);
    const [a] = generateVariants(base(), ctx({ policy }));
    expect(a.plan.captionPreset).toBe('hormozi');
    expect(a.changed).toContain('captionPreset');
  });

  it('applies an elite template to A when epsilon says exploit', () => {
    const template: EliteTemplate = {
      version: 1, created_at: 'now', source: { videoId: 'v', clip_id: 'c' }, retention: 0.8,
      dna: {
        mode: 'clippies', captionPreset: 'gaming', hookSource: 'moment',
        zoomPer10s: 0.5, zoomIntensity: 0.9, firstZoomAt: 3, sfxOn: true,
        brollCoverage: 0, wordsPerSec: 2,
      },
    };
    const policy = { ...defaultPolicy(), epsilon: 0 }; // always exploit
    const [a] = generateVariants(base(), ctx({ policy, templates: [template] }));
    expect(a.plan.captionPreset).toBe('gaming');
    expect(a.plan.zoom.intensity).toBe(0.9);
  });

  it('every variant is already regulated (min zoom gap holds)', () => {
    for (const v of generateVariants(base(), ctx())) {
      const t = v.plan.zoom.times;
      for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(2.5);
    }
  });
});

describe('scoreVariants + pickWinner', () => {
  it('scores all variants and picks the highest overall (tie → A)', () => {
    const scored = scoreVariants(generateVariants(base(), ctx()), signals);
    expect(scored).toHaveLength(3);
    const winner = pickWinner(scored);
    for (const s of scored) expect(winner.sim.overall).toBeGreaterThanOrEqual(s.sim.overall);
  });

  it('tie goes to A', () => {
    const scored = scoreVariants(generateVariants(base(), ctx()), signals);
    const flat = scored.map((s) => ({ ...s, sim: { ...s.sim, overall: 0.5 } }));
    expect(pickWinner(flat).variant.id).toBe('A');
  });
});
