/**
 * Semantic-provider router. Claude is the primary high-accuracy scoring brain; Gemini Flash
 * is the redundant fallback (cheaper/free-tier, used when no Anthropic credential is present
 * or Claude yields nothing). Keeps the rest of the pipeline provider-agnostic.
 */
import { analyzeSemantic } from './semantic.js';
import { analyzeSemanticClaude } from './claudeSemantic.js';
import { logger } from '../utils/logger.js';
import type { TranscriptSegment, SemanticWindow } from '../types/index.js';

export type SemanticProvider = 'claude' | 'gemini' | 'none';

const has = (v?: string) => Boolean(v && v.trim());

/** PURE: choose the semantic provider from available credentials. Claude wins when present. */
export function pickSemanticProvider(env: Record<string, string | undefined>): SemanticProvider {
  if (has(env.ANTHROPIC_API_KEY) || has(env.ANTHROPIC_AUTH_TOKEN)) return 'claude';
  if (has(env.GEMINI_API_KEY) || has(env.GEMINI_API_KEYS)) return 'gemini';
  return 'none';
}

export interface SemanticEngineOpts {
  outPath?: string;
  geminiModel?: string;
  claudeModel?: string;
}

/**
 * Run the best available semantic provider. Claude first (accuracy); if Claude is unavailable
 * or returns nothing AND Gemini keys exist, fall back to Gemini (redundancy). Never throws —
 * an empty array degrades the pipeline to trigger+audio scoring.
 */
export async function analyzeSemanticAuto(
  segments: TranscriptSegment[],
  opts: SemanticEngineOpts = {},
): Promise<{ windows: SemanticWindow[]; provider: SemanticProvider }> {
  const provider = pickSemanticProvider(process.env);

  if (provider === 'claude') {
    logger.info('Semantic provider: Claude (primary)');
    const windows = await analyzeSemanticClaude(segments, { model: opts.claudeModel, outPath: opts.outPath });
    if (windows.length > 0) return { windows, provider: 'claude' };
    // Claude produced nothing — fall back to Gemini if its keys are present.
    if (has(process.env.GEMINI_API_KEY) || has(process.env.GEMINI_API_KEYS)) {
      logger.warn('Claude semantic empty — falling back to Gemini');
      const g = await analyzeSemantic(segments, { model: opts.geminiModel, outPath: opts.outPath });
      return { windows: g, provider: g.length > 0 ? 'gemini' : 'none' };
    }
    return { windows: [], provider: 'none' };
  }

  if (provider === 'gemini') {
    logger.info('Semantic provider: Gemini (fallback — no Anthropic key)');
    const windows = await analyzeSemantic(segments, { model: opts.geminiModel, outPath: opts.outPath });
    return { windows, provider: windows.length > 0 ? 'gemini' : 'none' };
  }

  logger.warn('No semantic provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY) — using trigger+audio scoring');
  return { windows: [], provider: 'none' };
}
