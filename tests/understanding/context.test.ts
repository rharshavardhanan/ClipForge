import { describe, expect, it } from 'vitest';
import { renderUnderstandingContext } from '../../src/understanding/context.js';

const U = {
  provider: 'gemini', arcs: [], importance: [],
  scenes: [
    { id: 'sc0', span: { start: 0, end: 30 }, label: 'gym bet', participants: [], goal: 'win bet', emotion: 'hype', events: [], importance: 0.8 },
    { id: 'sc1', span: { start: 30, end: 60 }, label: 'reaction', participants: [], goal: 'celebrate', emotion: 'joy', events: [], importance: 0.9 },
    { id: 'sc2', span: { start: 200, end: 260 }, label: 'far away', participants: [], goal: '', emotion: '', events: [], importance: 0.1 },
  ],
  edges: [
    { from: 'sc0', to: 'sc1', type: 'pays_off' as const, confidence: 0.8 },
    { from: 'sc2', to: 'sc0', type: 'callback' as const, confidence: 0.9 },
  ],
};

describe('renderUnderstandingContext', () => {
  it('renders overlapping scenes and their edges, skipping far scenes', () => {
    const s = renderUnderstandingContext(U as never, { start: 10, end: 50 });
    expect(s).toContain('[0.0-30.0] gym bet — win bet (hype)');
    expect(s).toContain('sc0 -pays_off-> sc1 (0.80)');
    expect(s).not.toContain('far away');
    expect(s).toContain('sc2 -callback-> sc0 (0.90)');   // edge touches an overlapping scene
    expect(s.split('\n').length).toBeLessThanOrEqual(12);
  });
  it('returns empty string for null or non-overlapping understanding', () => {
    expect(renderUnderstandingContext(null, { start: 0, end: 10 })).toBe('');
    expect(renderUnderstandingContext(U as never, { start: 500, end: 520 })).toBe('');
  });
});
