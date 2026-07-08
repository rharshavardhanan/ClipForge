import type { SemanticTimeline } from './timeline.js';

/** A perception backend: video → semantic timeline, or null when unavailable. */
export interface PerceptionClient {
  analyze(videoPath: string, jobId: string): Promise<SemanticTimeline | null>;
}

/**
 * Wiring helper (kept pure/testable so analyzeVideo stays thin): when perception is disabled,
 * return null without touching the client; otherwise delegate.
 */
export async function resolvePerception(
  enabled: boolean,
  videoPath: string,
  jobId: string,
  client: PerceptionClient,
): Promise<SemanticTimeline | null> {
  if (!enabled) return null;
  return client.analyze(videoPath, jobId);
}

/** SP2: perception is ON by default (understanding consumes it). PERCEPTION=0/1
 *  overrides in either direction; otherwise only an explicit --no-perception disables. */
export function perceptionEnabled(flag: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  if (env.PERCEPTION === '0') return false;
  if (env.PERCEPTION === '1') return true;
  return flag !== false;
}
