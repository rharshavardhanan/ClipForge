/**
 * Content mode system (v6) — two editing grammars:
 *  - clippies: high-energy creator clips (gaming, reactions, rage, fails) — short, aggressive,
 *    punchy zooms, meme-style captions, humor/shock ranking priority.
 *  - mindcuts: podcasts/interviews/storytelling — story-first, longer clips, subtle zooms,
 *    premium captions, heavy contextual B-roll (narrative overlay), wisdom/story priority.
 * Auto-detection picks a mode per video from metadata + the semantic layer.
 */
import type { ContentMode, SemanticScores, SemanticWindow, VideoMetadata } from './types/index.js';

export type { ContentMode } from './types/index.js';

export interface ClipLengths { min: number; soft: number; max: number; }

export interface ModeProfile {
  name: ContentMode;
  lengths: ClipLengths;
  /** Caption preset used when the user didn't pass --style. */
  captionPreset: string;
  /** Contextual B-roll (narrative overlay) on by default? */
  brollDefault: boolean;
  /** Max B-roll overlays per clip. */
  maxBroll: number;
  /** Punch-zoom amplitude multiplier (1 = full punch, <1 = subtle). */
  zoomIntensity: number;
  /** Semantic sub-scores this mode ranks up. */
  priorities: (keyof SemanticScores)[];
  /** Framing default when --framing is auto/absent; undefined = auto decision engine. */
  framing?: 'crop' | 'blur';
}

export const MODE_PROFILES: Record<ContentMode, ModeProfile> = {
  clippies: {
    name: 'clippies',
    lengths: { min: 15, soft: 25, max: 45 },
    captionPreset: 'mrbeast',
    brollDefault: false,
    maxBroll: 1,
    zoomIntensity: 1,
    framing: 'crop',
    priorities: ['humor', 'surprise', 'emotional_intensity', 'argument_peak'],
  },
  mindcuts: {
    name: 'mindcuts',
    lengths: { min: 20, soft: 45, max: 60 },
    captionPreset: 'podcast',
    brollDefault: true,
    maxBroll: 4,
    zoomIntensity: 0.55,
    priorities: ['wisdom', 'storytelling_tension', 'controversy', 'relatability'],
  },
};

// `#2041`-style episode numbers can't sit behind a \b (space→# is no word boundary) — own alternative.
const MINDCUTS_WORDS = /\b(podcast|interview|episode|ep\.?\s*\d|lecture|keynote|founder|motivat\w*|lessons?|advice|deep dive|conversation)\b|#\d{1,4}\b/i;
const CLIPPIES_WORDS = /\b(stream|gaming|gameplay|reaction|reacts?|rage|fails?|funny|highlights?|moments|irl|clutch|1v\d|speedrun)\b/i;

/** PURE: mean of the given semantic sub-scores across all windows (0 when none). */
export function meanSubscores(semantic: SemanticWindow[], keys: (keyof SemanticScores)[]): number {
  if (semantic.length === 0 || keys.length === 0) return 0;
  let total = 0;
  for (const w of semantic) for (const k of keys) total += w.scores[k] ?? 0;
  return total / (semantic.length * keys.length);
}

/**
 * PURE: pick a content mode for one video.
 * Order: explicit title/channel keywords → semantic sub-score tally → duration heuristic.
 */
export function detectMode(meta: VideoMetadata, semantic: SemanticWindow[]): ContentMode {
  const label = `${meta.title} ${meta.channelName ?? ''}`;
  if (MINDCUTS_WORDS.test(label) && !CLIPPIES_WORDS.test(label)) return 'mindcuts';
  if (CLIPPIES_WORDS.test(label) && !MINDCUTS_WORDS.test(label)) return 'clippies';

  if (semantic.length > 0) {
    const clippy = meanSubscores(semantic, MODE_PROFILES.clippies.priorities);
    const mindful = meanSubscores(semantic, MODE_PROFILES.mindcuts.priorities);
    if (Math.abs(clippy - mindful) > 0.25) return clippy > mindful ? 'clippies' : 'mindcuts';
  }

  // No decisive signal: long videos are podcast-shaped, short ones creator-clip-shaped.
  return meta.duration >= 30 * 60 ? 'mindcuts' : 'clippies';
}

/** PURE: resolve a CLI mode flag ('auto'|'clippies'|'mindcuts'|undefined) to a profile. */
export function resolveMode(flag: string | undefined, meta: VideoMetadata, semantic: SemanticWindow[]): ModeProfile {
  if (flag === 'clippies' || flag === 'mindcuts') return MODE_PROFILES[flag];
  return MODE_PROFILES[detectMode(meta, semantic)];
}

/** PURE: --framing flag + mode profile → forced framing ('crop'|'blur') or undefined (auto). */
export function resolveFraming(flag: string | undefined, profile: ModeProfile): 'crop' | 'blur' | undefined {
  if (flag === 'crop' || flag === 'blur') return flag;
  return profile.framing;
}
