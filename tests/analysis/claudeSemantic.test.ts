import { describe, it, expect } from 'vitest';
import { buildClaudeRequest, buildBatchSchema, parseClaudeBatch } from '../../src/analysis/claudeSemantic.js';
import type { TranscriptChunk } from '../../src/analysis/semantic.js';

const batch: TranscriptChunk[] = [
  { start: 0, end: 30, text: 'hello world' },
  { start: 15, end: 45, text: 'and then everything changed' },
];

describe('buildBatchSchema', () => {
  it('is an object root wrapping a windows array of strict result objects', () => {
    const schema = buildBatchSchema() as any;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['windows']);
    const item = schema.properties.windows.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(expect.arrayContaining([
      'scores', 'hook_moment', 'clip_titles', 'is_standalone', 'recommended_duration', 'sentiment', 'reason',
    ]));
    expect(item.properties.sentiment.enum).toEqual(['serious', 'funny', 'intense', 'neutral']);
    expect(item.properties.scores.required).toContain('emotional_intensity');
    expect(item.properties.scores.additionalProperties).toBe(false);
  });
});

describe('buildClaudeRequest', () => {
  it('targets the given model with structured output + effort and the shared batch prompt', () => {
    const req = buildClaudeRequest(batch, 'claude-sonnet-5', 'medium') as any;
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.max_tokens).toBe(16000);
    expect(req.system).toContain('viral content analyst');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toContain('WINDOW 1 (0.0s - 30.0s)');
    expect(req.messages[0].content).toContain('WINDOW 2');
    expect(req.output_config.effort).toBe('medium');
    expect(req.output_config.format.type).toBe('json_schema');
    // no sampling params — rejected on claude-sonnet-5
    expect(req).not.toHaveProperty('temperature');
  });
});

describe('parseClaudeBatch', () => {
  const result = {
    scores: {
      emotional_intensity: 8, controversy: 1, humor: 2, surprise: 7,
      wisdom: 3, storytelling_tension: 6, argument_peak: 2, relatability: 5,
    },
    hook_moment: 'everything changed', clip_titles: ['a', 'b', 'c'],
    is_standalone: true, recommended_duration: 45, sentiment: 'intense', reason: 'big turn',
  };

  it('unwraps the windows array from a structured-output payload', () => {
    const parsed = parseClaudeBatch(JSON.stringify({ windows: [result, result] }));
    expect(parsed).toHaveLength(2);
    expect(parsed![0].scores.emotional_intensity).toBe(8);
  });

  it('returns null for malformed payloads', () => {
    expect(parseClaudeBatch('not json')).toBeNull();
    expect(parseClaudeBatch('{"nope": []}')).toBeNull();
    expect(parseClaudeBatch('[1,2]')).toBeNull(); // bare array — wrong shape
  });
});
