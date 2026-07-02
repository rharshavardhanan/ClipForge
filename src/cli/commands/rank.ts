import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ora from 'ora';
import { renderRanking, type RankingEntry } from '../../export/rankingRenderer.js';
import { logger } from '../../utils/logger.js';

interface ManifestClip { clip_id: string; rank: number; clip_titles: string[]; }

/** PURE: manifest clips → ranking entries (final clip paths + first Gemini title, if any). */
export function manifestToEntries(manifest: { clips: ManifestClip[] }, dir: string): RankingEntry[] {
  return manifest.clips.map((c) => ({
    clipPath: join(dir, `${c.clip_id}_final.mp4`),
    rank: c.rank,
    ...(c.clip_titles[0] ? { title: c.clip_titles[0] } : {}),
  }));
}

export interface RankRenderOpts { accent: string; cardSec: number; }

/** Render `<exportsDir>/ranking_final.mp4` from that directory's clips_manifest.json. */
export async function runRankingRender(exportsDir: string, opts: RankRenderOpts): Promise<string> {
  const dir = resolve(exportsDir);
  const manifest = JSON.parse(await readFile(join(dir, 'clips_manifest.json'), 'utf8'));
  const entries = manifestToEntries(manifest, dir);
  if (entries.length === 0) throw new Error(`No clips in manifest at ${dir}`);

  const outPath = join(dir, 'ranking_final.mp4');
  const sp = ora(`Rendering ranking video (#${Math.max(...entries.map((e) => e.rank))} → #1)…`).start();
  await renderRanking(entries, outPath, { accent: opts.accent, cardSec: opts.cardSec });
  sp.succeed(`Ranking video → ${outPath}`);
  logger.info(`Ranking render complete: ${entries.length} clips`);
  return outPath;
}
