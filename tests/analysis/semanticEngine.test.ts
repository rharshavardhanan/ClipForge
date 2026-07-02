import { describe, it, expect } from 'vitest';
import { pickSemanticProvider } from '../../src/analysis/semanticEngine.js';

describe('pickSemanticProvider', () => {
  it('prefers claude (main accuracy path) when an Anthropic credential is present', () => {
    expect(pickSemanticProvider({ ANTHROPIC_API_KEY: 'sk-ant-x', GEMINI_API_KEY: 'g' })).toBe('claude');
    expect(pickSemanticProvider({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('claude');
    expect(pickSemanticProvider({ ANTHROPIC_AUTH_TOKEN: 'tok' })).toBe('claude');
  });

  it('falls back to gemini (redundant path) when only Gemini keys exist', () => {
    expect(pickSemanticProvider({ GEMINI_API_KEY: 'g' })).toBe('gemini');
    expect(pickSemanticProvider({ GEMINI_API_KEYS: 'g1,g2' })).toBe('gemini');
  });

  it('returns none when no credentials exist (empty strings do not count)', () => {
    expect(pickSemanticProvider({})).toBe('none');
    expect(pickSemanticProvider({ ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '  ' })).toBe('none');
  });

  it('SEMANTIC_PROVIDER forces the choice (free Gemini even when Claude key present)', () => {
    expect(pickSemanticProvider({ SEMANTIC_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'sk', GEMINI_API_KEY: 'g' })).toBe('gemini');
    expect(pickSemanticProvider({ SEMANTIC_PROVIDER: 'claude', GEMINI_API_KEY: 'g' })).toBe('none'); // forced claude but no key
    expect(pickSemanticProvider({ SEMANTIC_PROVIDER: 'none', ANTHROPIC_API_KEY: 'sk' })).toBe('none');
  });
});
