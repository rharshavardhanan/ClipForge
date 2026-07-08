/**
 * Understanding engine (SP2) — supersedes mineArcs: one unified LLM call per
 * transcript chunk (arcs + scenes + edges), per-chunk incremental cache, and
 * per-chunk fail-soft (failed chunks are NOT cached so re-runs retry them).
 * provider 'none' → zero LLM calls, heuristic curve only (spec §6 rows 3-4).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { askVisionJson, type AskVisionFn } from '../broll/llmJson.js';
import { normalizeArcRaw, validateArc } from '../analysis/arcTypes.js';
import type { TranscriptChunk } from '../analysis/arcChunker.js';
import type { ContentMode } from '../modes.js';
import type { ArcLabel } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { UNDERSTAND_SCHEMA, type SceneNode, type StoryEdge, type UnderstandingResult } from './types.js';
import { understandingPrompt } from './prompt.js';
import { normalizeUnderstandingRaw } from './normalize.js';
import { validateEdges, validateScenes } from './validate.js';
import { assembleUnderstanding, type AssembleSignals, type ChunkUnderstanding } from './assemble.js';

interface CacheEntry { arcs: ArcLabel[]; scenes: Omit<SceneNode, 'id'>[]; edges: StoryEdge[]; }
interface UnderstandingCache { chunks: Record<string, CacheEntry>; }

async function loadCache(path: string): Promise<UnderstandingCache> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    if (j && typeof j.chunks === 'object') return j as UnderstandingCache;
  } catch { /* cold */ }
  return { chunks: {} };
}

export interface UnderstandOpts {
  cachePath: string;
  durationSec: number;
  mode: ContentMode;
  maxSpanSec?: number;
  provider: string;                // 'claude' | 'gemini' | 'none'
  /** Test seam; default askVisionJson (text-only here). */
  ask?: AskVisionFn;
}

export async function runUnderstanding(
  chunks: TranscriptChunk[],
  evidenceFor: (c: TranscriptChunk) => string,
  digestFor: (c: TranscriptChunk) => string,
  signals: AssembleSignals,
  opts: UnderstandOpts,
): Promise<UnderstandingResult> {
  if (opts.provider === 'none') {
    return assembleUnderstanding([], { ...signals, useSceneTerm: false }, 'none');
  }

  const ask = opts.ask ?? askVisionJson;
  const cache = await loadCache(opts.cachePath);
  const done: ChunkUnderstanding[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.start}-${chunk.end}`;
    let entry = cache.chunks[key];
    if (!entry) {
      let raw: unknown;
      try {
        raw = await ask({
          system: 'You are a top YouTube Shorts story editor. You find complete micro-stories, coherent scenes, and the narrative threads between them.',
          prompt: understandingPrompt(chunk, evidenceFor(chunk), digestFor(chunk), opts.mode, opts.maxSpanSec),
          schema: UNDERSTAND_SCHEMA as unknown as Record<string, unknown>,
          label: `understand ${key}`,
        });
      } catch (e) {
        logger.warn(`[understand ${key}] chunk failed (${e instanceof Error ? e.message : String(e)}) — will retry next run`);
        continue;                                        // NOT cached → retryable
      }
      const norm = normalizeUnderstandingRaw(raw);
      const arcs = norm.arcs.map((a) => validateArc(normalizeArcRaw(a), opts.durationSec)).filter((a): a is ArcLabel => a !== null);
      const scenes = validateScenes(norm.scenes, { start: chunk.start, end: Math.min(chunk.end, opts.durationSec) });
      const edges = validateEdges(norm.edges, scenes.length, arcs.length);
      entry = { arcs, scenes, edges };
      cache.chunks[key] = entry;
      await mkdir(dirname(opts.cachePath), { recursive: true });
      await writeFile(opts.cachePath, JSON.stringify(cache, null, 2));   // incremental
    }
    done.push({ chunkKey: key, chunkSpan: { start: chunk.start, end: chunk.end }, ...entry });
  }
  return assembleUnderstanding(done, signals, opts.provider);
}
