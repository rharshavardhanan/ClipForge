/**
 * Local SFX library (./sfx). Same convention as ./music: one-shots are tagged with a kind
 * either by subfolder (sfx/whoosh/swish.mp3) or by filename prefix at the root
 * (sfx/whoosh_swish.mp3). Selection is deterministic per clip so re-runs are identical.
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export type SfxKind = 'whoosh' | 'impact' | 'pop' | 'riser' | 'bass';

const KINDS: SfxKind[] = ['whoosh', 'impact', 'pop', 'riser', 'bass'];
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg']);

/** Scan `<root>/<kind>/*.mp3` subfolders and `<root>/<kind>_*.mp3` prefixed files. */
export async function scanSfxLibrary(root: string): Promise<Partial<Record<SfxKind, string[]>>> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return {};
  }

  const lib: Partial<Record<SfxKind, string[]>> = {};
  const add = (k: SfxKind, p: string) => { (lib[k] ??= []).push(p); };

  for (const e of entries) {
    if (e.isDirectory() && KINDS.includes(e.name as SfxKind)) {
      for (const f of (await readdir(join(root, e.name))).sort()) {
        if (AUDIO_EXTS.has(extname(f).toLowerCase())) add(e.name as SfxKind, join(root, e.name, f));
      }
    } else if (e.isFile() && AUDIO_EXTS.has(extname(e.name).toLowerCase())) {
      const k = KINDS.find((m) => e.name.toLowerCase().startsWith(`${m}_`));
      if (k) add(k, join(root, e.name));
    }
  }
  return lib;
}

/** Deterministic one-shot pick for a kind (sha1(seed) mod n); null when the kind is empty. */
export function pickSfx(lib: Partial<Record<SfxKind, string[]>>, kind: SfxKind, seed: string): string | null {
  const xs = lib[kind];
  if (!xs?.length) return null;
  const n = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return xs[n % xs.length];
}
