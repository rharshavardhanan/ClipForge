import { describe, expect, it } from 'vitest';
import { understandingPrompt } from '../../src/understanding/prompt.js';

const CHUNK = { start: 0, end: 540, segments: [{ start: 1, end: 4, text: 'hello world', words: [] }] };

describe('understandingPrompt', () => {
  it('keeps the arc-mining rules, adds scenes+edges instructions and the digest', () => {
    const p = understandingPrompt(CHUNK as never, 'rms 1:2', 'VISUAL SCENES:\n[0.0-10.0] a gym', 'clippies', 45);
    expect(p).toContain('ALL SIX components: setup, trigger, escalation, peak, payoff, reaction');
    expect(p).toContain('HARD LIMIT: each micro-story must span at most 45 seconds');
    expect(p).toContain('2-8 coherent SCENES');
    expect(p).toContain('"sc<i>"');
    expect(p).toContain('setup_for|escalates|pays_off|reacts_to|callback');
    expect(p).toContain('PERCEPTION FACTS:');
    expect(p).toContain('[0.0-10.0] a gym');
    expect(p).toContain('SIGNAL EVIDENCE:');
    expect(p).toContain('[1.0-4.0] hello world');
  });
  it('omits the PERCEPTION FACTS section when the digest is empty', () => {
    const p = understandingPrompt(CHUNK as never, 'rms 1:2', '', 'mindcuts');
    expect(p).not.toContain('PERCEPTION FACTS:');
  });
});
