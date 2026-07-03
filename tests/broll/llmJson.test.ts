import { describe, expect, it } from 'vitest';
import { askVisionJson, stripFences, toClaudeContent, toGeminiParts } from '../../src/broll/llmJson.js';

const img = { data: Buffer.from('jpegbytes'), mimeType: 'image/jpeg' as const };
const opts = { system: 'sys', prompt: 'find arcs', schema: {}, label: 'test', images: [img] };

describe('stripFences', () => {
  it('removes markdown fences', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('toGeminiParts', () => {
  it('images as inlineData base64 first, prompt text last', () => {
    const parts = toGeminiParts(opts) as any[];
    expect(parts[0].inlineData.data).toBe(img.data.toString('base64'));
    expect(parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[parts.length - 1]).toContain('find arcs');
  });
  it('no images → just the prompt', () => {
    expect(toGeminiParts({ ...opts, images: [] })).toHaveLength(1);
  });
});

describe('toClaudeContent', () => {
  it('image blocks then one text block', () => {
    const blocks = toClaudeContent(opts) as any[];
    expect(blocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(blocks[1]).toMatchObject({ type: 'text' });
    expect(blocks[1].text).toContain('find arcs');
  });
});

describe('askVisionJson', () => {
  it('returns null with a warning when no provider is configured', async () => {
    expect(await askVisionJson(opts, { SEMANTIC_PROVIDER: 'none' } as NodeJS.ProcessEnv)).toBeNull();
    expect(await askVisionJson(opts, {} as NodeJS.ProcessEnv)).toBeNull(); // no keys at all
  });
});
