import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ora from 'ora';
import { renderRanking, type RankingEntry } from '../../export/rankingRenderer.js';
import { logger } from '../../utils/logger.js';

interface ManifestClip { clip_id: string; rank: number; clip_titles: string[]; transcript_excerpt?: string; }

/** PURE: manifest clips → ranking entries (final clip paths + first Gemini title, if any). */
export function manifestToEntries(manifest: { clips: ManifestClip[] }, dir: string): RankingEntry[] {
  return manifest.clips.map((c) => ({
    clipPath: join(dir, `${c.clip_id}_final.mp4`),
    rank: c.rank,
    ...(c.clip_titles[0] ? { title: c.clip_titles[0] } : {}),
  }));
}

/** PURE: countdown title options + per-rank lines + SEO description for the ranking video. */
export function buildRankingTexts(manifest: { title: string; clips: ManifestClip[] }): { titles: string; description: string } {
  const n = manifest.clips.length;
  const line = (c: ManifestClip) =>
    `#${c.rank}: ${c.clip_titles[0] ?? (c.transcript_excerpt ?? '').split(/\s+/).slice(0, 6).join(' ')}`;
  const lines = [...manifest.clips].sort((a, b) => a.rank - b.rank).map(line);
  const titles = [
    `Top ${n} Wildest Moments 🔥 #shorts`,
    `Ranking the ${n} Craziest Moments`,
    `#1 Will Shock You — Top ${n} Moments`,
    '',
    ...lines,
  ].join('\n');
  const description = [
    `The definitive top ${n} countdown. Which one is YOUR #1?`, '',
    ...lines, '',
    `From: ${manifest.title}`, '',
    ['#shorts', '#viral', '#ranking', `#top${n}`, '#fyp', '#trending'].join(' '),
  ].join('\n');
  return { titles, description };
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

  const texts = buildRankingTexts(manifest);
  await writeFile(join(dir, 'ranking_titles.txt'), texts.titles + '\n');
  await writeFile(join(dir, 'ranking_description.txt'), texts.description + '\n');
  logger.info(`Ranking render complete: ${entries.length} clips (+ ranking_titles.txt, ranking_description.txt)`);
  return outPath;
}
