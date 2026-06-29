import { logger } from './logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; label: string; baseMs?: number },
): Promise<T> {
  const base = opts.baseMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === opts.attempts - 1) break;
      const delay = base * Math.pow(4, i); // 1s, 4s, 16s with base=1000
      logger.warn(`[${opts.label}] attempt ${i + 1} failed: ${e instanceof Error ? e.message : String(e)}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
