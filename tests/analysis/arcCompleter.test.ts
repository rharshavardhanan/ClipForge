import { describe, expect, it, vi } from 'vitest';
import { completeArc, completionPrompt, gateArc, parseCompletion, resolveBounds } from '../../src/analysis/arcCompleter.js';
import type { TranscriptSegment } from '../../src/types/index.js';
import { DEFAULT_LENGTHS } from '../../src/clipDetection/merger.js';

const seg = (start: number, end: number, text = ''): TranscriptSegment =>
  ({ id: Math.round(start), start, end, text: text || `t${start}.`, words: [] });
const fullComponents = {
  setup: { start: 20, end: 24 }, trigger: { start: 23, end: 24 }, escalation: { start: 24, end: 28 },
  peak: { start: 28, end: 30 }, payoff: { start: 30, end: 33 }, reaction: { start: 33, end: 38 },
};
const rawCompletion = {
  synopsis: 's', confidence: 0.85, components: fullComponents,
  reactionAfterPeak: true, bounds: { start: 18, end: 40 },
};

describe('completionPrompt', () => {
  it('carries context, evidence, expansion rule, and frame note when images exist', () => {
    const p = completionPrompt({
      window: { start: 22, end: 34 }, contextSegments: [seg(20, 25)], evidence: 'EV',
      mode: 'clippies', hasImages: true,
    });
    expect(p).toContain('EV');
    expect(p).toContain('t20');
    expect(p).toMatch(/3 ?s/);           // ≥3s expansion rule stated
    expect(p).toMatch(/context/i);
    expect(p).toMatch(/frames/i);
    const noImg = completionPrompt({
      window: { start: 22, end: 34 }, contextSegments: [], evidence: 'EV', mode: 'mindcuts', hasImages: false,
    });
    expect(noImg).not.toMatch(/frames from the clip/i);
  });
});

describe('parseCompletion', () => {
  it('valid completion parses; missing computed from components, not trusted', () => {
    const c = parseCompletion(rawCompletion, 100)!;
    expect(c.missing).toEqual([]);
    expect(c.bounds).toEqual({ start: 18, end: 40 });
    const { payoff, ...five } = fullComponents;
    expect(parseCompletion({ ...rawCompletion, components: five, missing: [] }, 100)!.missing).toEqual(['payoff']);
  });
  it('no bounds or garbage → null', () => {
    expect(parseCompletion({ ...rawCompletion, bounds: null }, 100)).toBeNull();
    expect(parseCompletion({ ...rawCompletion, bounds: { start: 40, end: 18 } }, 100)).toBeNull();
    expect(parseCompletion('x', 100)).toBeNull();
  });
});

describe('resolveBounds', () => {
  const segments = Array.from({ length: 30 }, (_, i) => seg(i * 4, i * 4 + 4, `sentence ${i}.`));
  const ctx = { envelope: DEFAULT_LENGTHS, segments, used: [], durationSec: 200 };
  it('covers the outer span and both proposed expansions', () => {
    const r = resolveBounds(parseCompletion(rawCompletion, 200)!, ctx);
    expect('reject' in r).toBe(false);
    const b = r as { start: number; end: number };
    expect(b.start).toBeLessThanOrEqual(18);
    expect(b.end).toBeGreaterThanOrEqual(38);      // sentence clamp may extend past 40
  });
  it('used-range collision pulls the edge back; cutting a component → reject overlap', () => {
    const pulled = resolveBounds(parseCompletion(rawCompletion, 200)!, { ...ctx, used: [{ start: 10, end: 19, clip_id: 'x', exportedAt: '' }] });
    expect('reject' in pulled).toBe(false);
    expect((pulled as { start: number }).start).toBeGreaterThanOrEqual(19);
    const rejected = resolveBounds(parseCompletion(rawCompletion, 200)!, { ...ctx, used: [{ start: 10, end: 26, clip_id: 'x', exportedAt: '' }] });
    expect(rejected).toEqual({ reject: 'overlap' });   // 26 cuts into setup/escalation
  });
});

describe('gateArc', () => {
  it('strict 6/6: pass only with zero missing; null → arc-label-failed', () => {
    expect(gateArc(parseCompletion(rawCompletion, 100)).pass).toBe(true);
    const { trigger, ...five } = fullComponents;
    expect(gateArc(parseCompletion({ ...rawCompletion, components: five }, 100))).toEqual({ pass: false, missing: ['trigger'] });
    expect(gateArc(null)).toEqual({ pass: false, missing: ['arc-label-failed'] });
  });
});

describe('completeArc', () => {
  it('asks once and parses; ask failure → null', async () => {
    const ask = vi.fn().mockResolvedValue(rawCompletion);
    const c = await completeArc({
      window: { start: 22, end: 34 }, segments: [seg(20, 25)], evidence: 'E',
      images: [], mode: 'clippies', durationSec: 100, ask,
    });
    expect(c?.synopsis).toBe('s');
    expect(ask).toHaveBeenCalledOnce();
    const askFail = vi.fn().mockResolvedValue(null);
    expect(await completeArc({
      window: { start: 22, end: 34 }, segments: [], evidence: 'E',
      images: [], mode: 'clippies', durationSec: 100, ask: askFail,
    })).toBeNull();
  });
});
