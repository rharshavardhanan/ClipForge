/**
 * KeyPool: round-robins across multiple API keys, skipping keys that are
 * cooling down after a rate-limit error. Pure-ish (no network calls) and
 * takes an injectable clock for deterministic testing.
 */
export class KeyPool {
  private readonly keys: string[];
  private readonly cooldownUntil: Map<string, number> = new Map();
  private readonly now: () => number;
  private cursor = 0;

  constructor(keys: string[], now: () => number = Date.now) {
    this.keys = keys;
    this.now = now;
  }

  size(): number {
    return this.keys.length;
  }

  /**
   * Round-robins to the next non-cooling key. If every key is cooling down,
   * returns the one with the soonest cooldown expiry so the caller can wait.
   * Returns null if the pool has no keys at all.
   */
  next(): string | null {
    if (this.keys.length === 0) return null;

    const t = this.now();
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.cursor + i) % this.keys.length;
      const key = this.keys[idx];
      const until = this.cooldownUntil.get(key);
      if (until === undefined || until <= t) {
        this.cursor = (idx + 1) % this.keys.length;
        return key;
      }
    }

    // All keys are cooling down — return the one with the soonest expiry.
    let soonestKey = this.keys[0];
    let soonestUntil = this.cooldownUntil.get(soonestKey) ?? 0;
    for (const key of this.keys) {
      const until = this.cooldownUntil.get(key) ?? 0;
      if (until < soonestUntil) {
        soonestUntil = until;
        soonestKey = key;
      }
    }
    return soonestKey;
  }

  /** Marks a key as cooling down until now() + retryAfterMs. */
  reportRateLimited(key: string, retryAfterMs = 60000): void {
    this.cooldownUntil.set(key, this.now() + retryAfterMs);
  }

  /** Clears any cooldown on a key after a successful call. */
  reportSuccess(key: string): void {
    this.cooldownUntil.delete(key);
  }
}

/**
 * Loads Gemini API keys from the environment.
 * Prefers comma-separated GEMINI_API_KEYS; falls back to a single GEMINI_API_KEY.
 * Trims whitespace and drops empty entries.
 */
export function loadGeminiKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const multi = env.GEMINI_API_KEYS;
  if (multi) {
    const keys = multi
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (keys.length > 0) return keys;
  }

  const single = env.GEMINI_API_KEY?.trim();
  return single ? [single] : [];
}
