/**
 * Small dual-provider "ask for JSON" helper for the B-roll engine (v6). Claude (structured
 * outputs) is the primary brain; Gemini Flash is the fallback; no key → null so callers
 * degrade gracefully (a clip simply renders without B-roll).
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { loadGeminiKeys } from '../analysis/keyPool.js';
import { pickSemanticProvider } from '../analysis/semanticEngine.js';
import { DEFAULT_CLAUDE_MODEL, isAuthError, type Effort } from '../analysis/claudeSemantic.js';

const MAX_TOKENS = 4000;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** PURE: strip markdown fences from a raw LLM response. */
export function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export interface AskJsonOpts {
  system: string;
  prompt: string;
  /** JSON schema enforced on Claude (Gemini gets prompt-level "return only JSON"). */
  schema: Record<string, unknown>;
  label: string;
}

/** Ask the available LLM for a JSON object. Returns the parsed value or null — never throws. */
export async function askJson(opts: AskJsonOpts, env: NodeJS.ProcessEnv = process.env): Promise<unknown | null> {
  const hasClaude = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  if (hasClaude) {
    const viaClaude = await askClaude(opts, env);
    if (viaClaude !== null) return viaClaude;
  }
  const keys = loadGeminiKeys(env);
  if (keys.length > 0) return askGemini(opts, keys[0], env);
  if (!hasClaude) logger.warn(`[${opts.label}] no ANTHROPIC_API_KEY / GEMINI_API_KEYS — skipping`);
  return null;
}

async function askClaude(opts: AskJsonOpts, env: NodeJS.ProcessEnv): Promise<unknown | null> {
  try {
    const client = new Anthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {});
    const model = env.ANTHROPIC_MODEL ?? DEFAULT_CLAUDE_MODEL;
    const effort: Effort = (env.ANTHROPIC_EFFORT as Effort) ?? 'medium';
    return await withRetry(async () => {
      // output_config (structured outputs) isn't in this SDK's types yet — same cast as claudeSemantic.
      const req = {
        model, max_tokens: MAX_TOKENS, system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
        output_config: { effort, format: { type: 'json_schema', schema: opts.schema } },
      } as unknown as Anthropic.MessageCreateParamsNonStreaming;
      const res = await client.messages.create(req);
      if (res.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      return JSON.parse(stripFences(text));
    }, { attempts: 2, label: opts.label, shouldRetry: (e) => !isAuthError(e) });
  } catch (e) {
    logger.warn(`[${opts.label}] Claude failed (${e instanceof Error ? e.message : String(e)}) — trying Gemini`);
    return null;
  }
}

/** Gemini-only JSON ask — for engines that must not use Claude (RankRot, per spec). */
export async function askGeminiJson(opts: AskJsonOpts, env: NodeJS.ProcessEnv = process.env): Promise<unknown | null> {
  const keys = loadGeminiKeys(env);
  if (keys.length === 0) {
    logger.warn(`[${opts.label}] no GEMINI_API_KEYS — skipping`);
    return null;
  }
  return askGemini(opts, keys[0], env);
}

// ---- Vision (v7 arc engine) ---------------------------------------------------------------

export interface VisionImage { data: Buffer; mimeType: 'image/jpeg'; }
export interface AskVisionOpts extends AskJsonOpts { images?: VisionImage[]; }
export type AskVisionFn = (opts: AskVisionOpts, env?: NodeJS.ProcessEnv) => Promise<unknown | null>;

/** PURE: Gemini generateContent parts — inline base64 images then the prompt. */
export function toGeminiParts(opts: AskVisionOpts): (string | Part)[] {
  const images: Part[] = (opts.images ?? []).map((i) => ({
    inlineData: { data: i.data.toString('base64'), mimeType: i.mimeType },
  }));
  return [...images, `${opts.prompt}\n\nReturn ONLY valid JSON, no markdown.`];
}

/** PURE: Claude message content — image blocks then one text block. */
export function toClaudeContent(opts: AskVisionOpts): Anthropic.ContentBlockParam[] {
  const images: Anthropic.ContentBlockParam[] = (opts.images ?? []).map((i) => ({
    type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data.toString('base64') },
  }));
  return [...images, { type: 'text', text: opts.prompt }];
}

/**
 * Vision-capable JSON ask. Provider = the semantic layer's routing (SEMANTIC_PROVIDER
 * honored): claude → Claude w/ Gemini fallback, gemini → Gemini only, none → null.
 * Gemini-first mandate: everything here must work with only GEMINI_API_KEYS set.
 */
export async function askVisionJson(opts: AskVisionOpts, env: NodeJS.ProcessEnv = process.env): Promise<unknown | null> {
  const provider = pickSemanticProvider(env);
  if (provider === 'none') {
    logger.warn(`[${opts.label}] no LLM provider — skipping`);
    return null;
  }
  if (provider === 'claude') {
    const viaClaude = await askClaudeVision(opts, env);
    if (viaClaude !== null) return viaClaude;
  }
  const keys = loadGeminiKeys(env);
  if (keys.length > 0) return askGeminiVision(opts, keys[0], env);
  logger.warn(`[${opts.label}] provider ${provider} unavailable and no Gemini fallback`);
  return null;
}

async function askClaudeVision(opts: AskVisionOpts, env: NodeJS.ProcessEnv): Promise<unknown | null> {
  try {
    const client = new Anthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {});
    const model = env.ANTHROPIC_MODEL ?? DEFAULT_CLAUDE_MODEL;
    const effort: Effort = (env.ANTHROPIC_EFFORT as Effort) ?? 'medium';
    return await withRetry(async () => {
      // output_config (structured outputs) isn't in this SDK's types yet — same cast as claudeSemantic.
      const req = {
        model, max_tokens: MAX_TOKENS, system: opts.system,
        messages: [{ role: 'user', content: toClaudeContent(opts) }],
        output_config: { effort, format: { type: 'json_schema', schema: opts.schema } },
      } as unknown as Anthropic.MessageCreateParamsNonStreaming;
      const res = await client.messages.create(req);
      if (res.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      return JSON.parse(stripFences(text));
    }, { attempts: 2, label: opts.label, shouldRetry: (e) => !isAuthError(e) });
  } catch (e) {
    logger.warn(`[${opts.label}] Claude vision failed (${e instanceof Error ? e.message : String(e)}) — trying Gemini`);
    return null;
  }
}

async function askGeminiVision(opts: AskVisionOpts, key: string, env: NodeJS.ProcessEnv): Promise<unknown | null> {
  try {
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
      model: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      systemInstruction: opts.system,
    });
    return await withRetry(async () => {
      const res = await model.generateContent(toGeminiParts(opts));
      return JSON.parse(stripFences(res.response.text()));
    }, { attempts: 2, label: opts.label });
  } catch (e) {
    logger.warn(`[${opts.label}] Gemini vision failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function askGemini(opts: AskJsonOpts, key: string, env: NodeJS.ProcessEnv): Promise<unknown | null> {
  try {
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
      model: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      systemInstruction: opts.system,
    });
    return await withRetry(async () => {
      const res = await model.generateContent(`${opts.prompt}\n\nReturn ONLY valid JSON, no markdown.`);
      return JSON.parse(stripFences(res.response.text()));
    }, { attempts: 2, label: opts.label });
  } catch (e) {
    logger.warn(`[${opts.label}] Gemini failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
