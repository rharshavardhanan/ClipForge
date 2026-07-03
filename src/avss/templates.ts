/**
 * Template evolution — "edit DNA" of shorts that PROVED themselves (≥70% real
 * retention, promoted by `clipforge stats`) saved to ./elite_templates/ as
 * elite_template_vN.json and reused as the exploit basis for future edits
 * (90% exploit / 10% explore via the policy's epsilon).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildZoomSfxTimes } from '../sfx/events.js';
import type { CaptionWord, ContentMode } from '../types/index.js';
import type { EditPlan, SourceSignals } from './editPlan.js';
import { zoomOptsFor } from './policy.js';

export interface EditDna {
  mode: ContentMode;
  captionPreset: string;
  hookSource: 'moment' | 'title' | 'none';
  zoomPer10s: number;
  zoomIntensity: number;
  firstZoomAt: number | null;
  sfxOn: boolean;
  brollCoverage: number;      // fraction of the clip under B-roll
  wordsPerSec: number;        // speech pacing
}

export interface EliteTemplate {
  version: number;
  created_at: string;
  source: { videoId: string; clip_id: string };
  retention: number;          // real averageViewPercentage/100 at promotion time
  dna: EditDna;
}

/** PURE: distill a rendered plan into reusable edit DNA. */
export function extractDna(plan: EditPlan, signals: SourceSignals, mode: ContentMode): EditDna {
  const dur = Math.max(signals.durationSec, 0.001);
  return {
    mode,
    captionPreset: plan.captionPreset,
    hookSource: plan.hookSource,
    zoomPer10s: +(plan.zoom.times.length / (dur / 10)).toFixed(3),
    zoomIntensity: plan.zoom.intensity,
    firstZoomAt: plan.zoom.times.length > 0 ? plan.zoom.times[0] : null,
    sfxOn: plan.sfx.enabled,
    brollCoverage: +(plan.brollWindows.reduce((a, b) => a + b.durationSec, 0) / dur).toFixed(3),
    wordsPerSec: +(signals.words.length / dur).toFixed(3),
  };
}

/** PURE: near-identical DNA (dedupe rule for promotion). */
export function dnaSimilar(a: EditDna, b: EditDna): boolean {
  return a.mode === b.mode
    && a.captionPreset === b.captionPreset
    && a.hookSource === b.hookSource
    && Math.abs(a.zoomPer10s - b.zoomPer10s) < 0.5;
}

export function templatesDir(): string {
  return process.env.ELITE_TEMPLATES_DIR ?? './elite_templates';
}

/** Missing/empty dir → []; malformed files skipped. Sorted by version. */
export async function loadTemplates(dir: string = templatesDir()): Promise<EliteTemplate[]> {
  let files: string[];
  try { files = await readdir(dir); } catch { return []; }
  const out: EliteTemplate[] = [];
  for (const f of files) {
    if (!/^elite_template_v\d+\.json$/.test(f)) continue;
    try {
      const t = JSON.parse(await readFile(join(dir, f), 'utf8'));
      if (typeof t?.version === 'number' && t?.dna?.mode) out.push(t as EliteTemplate);
    } catch { /* skip malformed */ }
  }
  return out.sort((a, b) => a.version - b.version);
}

/** Persist DNA as the next elite_template_vN.json; null when a similar template exists. */
export async function saveEliteTemplate(
  dna: EditDna,
  meta: { videoId: string; clip_id: string; retention: number },
  dir: string = templatesDir(),
): Promise<EliteTemplate | null> {
  const existing = await loadTemplates(dir);
  if (existing.some((t) => dnaSimilar(t.dna, dna))) return null;
  const version = existing.reduce((m, t) => Math.max(m, t.version), 0) + 1;
  const template: EliteTemplate = {
    version,
    created_at: new Date().toISOString(),
    source: { videoId: meta.videoId, clip_id: meta.clip_id },
    retention: meta.retention,
    dna,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `elite_template_v${version}.json`), JSON.stringify(template, null, 2));
  return template;
}

/**
 * PURE: map elite DNA back onto a base plan — caption preset, zoom shape/intensity and
 * sfx toggle only. Never touches B-roll, music, framing, or a user-pinned zooms-off base.
 */
export function applyTemplate(dna: EditDna, base: EditPlan, words: CaptionWord[]): EditPlan {
  const zoomEnabled = base.zoom.enabled;
  const bucket = dna.zoomPer10s >= 1.5 ? 'tight' : 'sparse';
  return {
    ...base,
    captionPreset: dna.captionPreset,
    zoom: {
      enabled: zoomEnabled,
      times: zoomEnabled ? buildZoomSfxTimes(words, zoomOptsFor(bucket)) : [],
      intensity: dna.zoomIntensity,
    },
    sfx: { ...base.sfx, enabled: base.sfx.enabled && dna.sfxOn },
  };
}
