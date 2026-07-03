/**
 * Editing policy — the spec's "editing policy network" in an honest small-data form:
 * a per-mode epsilon-greedy bandit over discrete edit dimensions (caption preset,
 * hook source, zoom bucket, sfx on/off), persisted as workspace/policy/policy.json
 * and updated by incremental mean reward from real YouTube performance
 * (`clipforge stats`). Deliberately not a neural net: with a handful of uploads the
 * bandit genuinely learns, a net would pretend to. The interface (choose arms in →
 * plan dimensions out) is the slot a learned model can fill later.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContentMode } from '../types/index.js';

export type ZoomBucket = 'tight' | 'sparse';   // tight: minGap 2.5/max 4 — sparse: minGap 4/max 2

/** PURE: the zoom-time builder options a bucket stands for (fed to buildZoomSfxTimes). */
export function zoomOptsFor(bucket: ZoomBucket): { minGapSec: number; maxEvents: number } {
  return bucket === 'tight' ? { minGapSec: 2.5, maxEvents: 4 } : { minGapSec: 4, maxEvents: 2 };
}

export interface PolicyChoice {
  captionPreset?: string;
  hookSource?: 'moment' | 'title';
  zoomBucket?: ZoomBucket;
  sfxOn?: boolean;
}

export interface ArmStat { n: number; mean: number; }
export interface ModeArms {
  captionPreset: Record<string, ArmStat>;
  hookSource: Record<string, ArmStat>;
  zoomBucket: Record<string, ArmStat>;
  sfxOn: Record<string, ArmStat>;
}
export interface Policy {
  version: number;
  epsilon: number;                    // explore probability (spec: 90% exploit / 10% explore)
  modes: Record<ContentMode, ModeArms>;
  updated_at?: string;
}

export const CAPTION_FAMILIES: Record<ContentMode, string[]> = {
  clippies: ['mrbeast', 'gaming', 'hormozi'],
  mindcuts: ['podcast', 'cinematic', 'gadzhi'],
};

const emptyArms = (): ModeArms => ({ captionPreset: {}, hookSource: {}, zoomBucket: {}, sfxOn: {} });

export function defaultPolicy(): Policy {
  return { version: 1, epsilon: 0.1, modes: { clippies: emptyArms(), mindcuts: emptyArms() } };
}

/** PURE: deterministic uniform [0,1) stream from a string seed (sha1 rehash chain). */
export function rngFromSeed(seed: string): () => number {
  let state = createHash('sha1').update(seed).digest();
  return () => {
    state = createHash('sha1').update(state).digest();
    return state.readUInt32BE(0) / 0x1_0000_0000;
  };
}

/** PURE: argmax mean among arms with at least one pull. */
export function bestArm<T extends string = string>(arms: Record<string, ArmStat>): T | undefined {
  let best: string | undefined;
  for (const [k, s] of Object.entries(arms)) {
    if (s.n >= 1 && (best === undefined || s.mean > arms[best].mean)) best = k;
  }
  return best as T | undefined;
}

/** PURE: the current best-known choice per dimension (untried dimensions omitted). */
export function chooseExploit(policy: Policy, mode: ContentMode): PolicyChoice {
  const arms = policy.modes[mode];
  const preset = bestArm(arms.captionPreset);
  const hook = bestArm<'moment' | 'title'>(arms.hookSource);
  const zoom = bestArm<ZoomBucket>(arms.zoomBucket);
  const sfx = bestArm(arms.sfxOn);
  return {
    ...(preset ? { captionPreset: preset } : {}),
    ...(hook ? { hookSource: hook } : {}),
    ...(zoom ? { zoomBucket: zoom } : {}),
    ...(sfx !== undefined ? { sfxOn: sfx === 'true' } : {}),
  };
}

function bump(arms: Record<string, ArmStat>, key: string, reward: number): Record<string, ArmStat> {
  const prev = arms[key] ?? { n: 0, mean: 0 };
  const n = prev.n + 1;
  return { ...arms, [key]: { n, mean: prev.mean + (reward - prev.mean) / n } };
}

/** PURE: incremental mean update for every dimension present in the choice. */
export function updatePolicy(policy: Policy, mode: ContentMode, choice: PolicyChoice, reward: number): Policy {
  const arms = policy.modes[mode];
  const next: ModeArms = {
    captionPreset: choice.captionPreset !== undefined ? bump(arms.captionPreset, choice.captionPreset, reward) : arms.captionPreset,
    hookSource: choice.hookSource !== undefined ? bump(arms.hookSource, choice.hookSource, reward) : arms.hookSource,
    zoomBucket: choice.zoomBucket !== undefined ? bump(arms.zoomBucket, choice.zoomBucket, reward) : arms.zoomBucket,
    sfxOn: choice.sfxOn !== undefined ? bump(arms.sfxOn, String(choice.sfxOn), reward) : arms.sfxOn,
  };
  return {
    ...policy,
    version: policy.version + 1,
    modes: { ...policy.modes, [mode]: next },
    updated_at: new Date().toISOString(),
  };
}

export function policyPath(wsDir?: string): string {
  return join(wsDir ?? process.env.WORKSPACE_DIR ?? './workspace', 'policy', 'policy.json');
}

/** Missing or corrupt file → cold-start default (never throws). */
export async function loadPolicy(wsDir?: string): Promise<Policy> {
  try {
    const raw = JSON.parse(await readFile(policyPath(wsDir), 'utf8'));
    if (typeof raw?.version === 'number' && raw?.modes?.clippies && raw?.modes?.mindcuts) return raw as Policy;
  } catch { /* cold start */ }
  return defaultPolicy();
}

export async function savePolicy(p: Policy, wsDir?: string): Promise<void> {
  const path = policyPath(wsDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(p, null, 2));
}
