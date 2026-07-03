import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CAPTION_FAMILIES, defaultPolicy, rngFromSeed, bestArm, chooseExploit, updatePolicy,
  policyPath, loadPolicy, savePolicy,
} from '../../src/avss/policy.js';

describe('defaultPolicy', () => {
  it('has version 1, epsilon 0.1 and empty arms for both modes', () => {
    const p = defaultPolicy();
    expect(p.version).toBe(1);
    expect(p.epsilon).toBe(0.1);
    expect(p.modes.clippies.captionPreset).toEqual({});
    expect(p.modes.mindcuts.zoomBucket).toEqual({});
  });
});

describe('CAPTION_FAMILIES', () => {
  it('lists mode-appropriate preset families', () => {
    expect(CAPTION_FAMILIES.clippies).toEqual(['mrbeast', 'gaming', 'hormozi']);
    expect(CAPTION_FAMILIES.mindcuts).toEqual(['podcast', 'cinematic', 'gadzhi']);
  });
});

describe('rngFromSeed', () => {
  it('is deterministic per seed and uniform-ish in [0,1)', () => {
    const a1 = rngFromSeed('seed-a');
    const a2 = rngFromSeed('seed-a');
    const b = rngFromSeed('seed-b');
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual([b(), b(), b()]);
    for (const v of seqA1) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('bestArm', () => {
  it('picks the highest mean with at least one pull', () => {
    expect(bestArm({ a: { n: 2, mean: 0.4 }, b: { n: 1, mean: 0.7 }, c: { n: 0, mean: 0 } })).toBe('b');
  });
  it('is undefined when nothing has been tried', () => {
    expect(bestArm({})).toBeUndefined();
    expect(bestArm({ a: { n: 0, mean: 0 } })).toBeUndefined();
  });
});

describe('updatePolicy', () => {
  it('does incremental mean updates and bumps the version', () => {
    let p = defaultPolicy();
    p = updatePolicy(p, 'clippies', { captionPreset: 'mrbeast', sfxOn: true }, 0.4);
    p = updatePolicy(p, 'clippies', { captionPreset: 'mrbeast', sfxOn: true }, 0.8);
    expect(p.modes.clippies.captionPreset.mrbeast.n).toBe(2);
    expect(p.modes.clippies.captionPreset.mrbeast.mean).toBeCloseTo(0.6, 12);
    expect(p.modes.clippies.sfxOn.true.n).toBe(2);
    expect(p.modes.clippies.sfxOn.true.mean).toBeCloseTo(0.6, 12);
    expect(p.modes.clippies.hookSource).toEqual({});
    expect(p.modes.mindcuts.captionPreset).toEqual({});
    expect(p.version).toBe(3);
  });
});

describe('chooseExploit', () => {
  it('returns best arms per dimension, omitting untried dimensions', () => {
    let p = defaultPolicy();
    p = updatePolicy(p, 'mindcuts', { captionPreset: 'cinematic', zoomBucket: 'sparse' }, 0.9);
    p = updatePolicy(p, 'mindcuts', { captionPreset: 'podcast' }, 0.2);
    const c = chooseExploit(p, 'mindcuts');
    expect(c.captionPreset).toBe('cinematic');
    expect(c.zoomBucket).toBe('sparse');
    expect(c.hookSource).toBeUndefined();
    expect(c.sfxOn).toBeUndefined();
  });
});

describe('load/save', () => {
  it('loads default on missing file and round-trips through disk', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'avss-policy-'));
    const fresh = await loadPolicy(ws);
    expect(fresh.version).toBe(1);
    const p = updatePolicy(fresh, 'clippies', { captionPreset: 'gaming' }, 0.5);
    await savePolicy(p, ws);
    const back = await loadPolicy(ws);
    expect(back.modes.clippies.captionPreset.gaming).toEqual({ n: 1, mean: 0.5 });
    expect(JSON.parse(await readFile(policyPath(ws), 'utf8')).version).toBe(2);
  });
});
