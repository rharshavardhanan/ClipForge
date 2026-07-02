/**
 * Local music library (./music). Tracks are tagged with a mood either by subfolder
 * (music/intense/track.mp3) or by filename prefix at the root (music/intense_track.mp3).
 * Selection is deterministic per clip so re-runs produce identical exports.
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export type Mood = 'intense' | 'funny' | 'motivational' | 'suspense' | 'emotional' | 'chill';

const MOODS: Mood[] = ['intense', 'funny', 'motivational', 'suspense', 'emotional', 'chill'];
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg']);

/** Map a clip's semantic sentiment onto a music mood. */
export function sentimentToMood(sentiment?: string): Mood {
  switch (sentiment) {
    case 'funny': return 'funny';
    case 'intense': return 'intense';
    case 'serious': return 'motivational';
    default: return 'chill';
  }
}

/** Scan `<root>/<mood>/*.mp3` subfolders and `<root>/<mood>_*.mp3` prefixed files. */
export async function scanLibrary(root: string): Promise<Partial<Record<Mood, string[]>>> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return {};
  }

  const lib: Partial<Record<Mood, string[]>> = {};
  const add = (mood: Mood, path: string) => { (lib[mood] ??= []).push(path); };

  for (const e of entries) {
    if (e.isDirectory() && MOODS.includes(e.name as Mood)) {
      const files = await readdir(join(root, e.name));
      for (const f of files.sort()) {
        if (AUDIO_EXTS.has(extname(f).toLowerCase())) add(e.name as Mood, join(root, e.name, f));
      }
    } else if (e.isFile() && AUDIO_EXTS.has(extname(e.name).toLowerCase())) {
      const mood = MOODS.find((m) => e.name.toLowerCase().startsWith(`${m}_`));
      if (mood) add(mood, join(root, e.name));
    }
  }
  return lib;
}

/** Deterministic track pick for a mood (sha1(seed) mod n); falls back to chill, then null. */
export function pickTrack(lib: Partial<Record<Mood, string[]>>, mood: Mood, seed: string): string | null {
  const tracks = lib[mood]?.length ? lib[mood] : lib.chill;
  if (!tracks || tracks.length === 0) return null;
  const n = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return tracks[n % tracks.length];
}
