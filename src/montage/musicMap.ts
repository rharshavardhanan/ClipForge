/**
 * Music analysis for the montagem engine — the TRACK masters the timeline.
 * Beats via music-tempo (pure JS; house pivot: librosa → music-tempo), drops via the
 * rankrot bass-band trick (lowpass RMS surge after a dip). PCM goes through a temp
 * file: run() stdout is utf8 and corrupts binary.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import MusicTempo from 'music-tempo';
import { run } from '../utils/cmd.js';
import { audioCurve, type CurvePoint } from '../rankrot/signals.js';
import type { Drop, MusicMap, Section } from './types.js';

const SR = 44_100;

export async function decodePcmMono(audioPath: string): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-pcm-'));
  const out = join(dir, 'a.f32');
  try {
    await run('ffmpeg', ['-y', '-i', audioPath, '-ac', '1', '-ar', String(SR), '-f', 'f32le', out]);
    const buf = await readFile(out);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const meanIn = (c: CurvePoint[], a: number, b: number): number => {
  const xs = c.filter((p) => p.time >= a && p.time < b);
  return xs.length === 0 ? 0 : xs.reduce((s, p) => s + p.v, 0) / xs.length;
};

/** PURE: bass surge (post ≥ 6.5, jump ≥ 2 on the 0-10 scale) after a dip; ≥8s apart. */
export function detectDrops(bass: CurvePoint[]): Drop[] {
  const raw: Drop[] = [];
  for (const p of bass) {
    // Only consider drops where there's actual preceding data
    const prePoints = bass.filter((pt) => pt.time >= p.time - 2 && pt.time < p.time - 0.25);
    if (prePoints.length === 0) continue;

    const pre = meanIn(bass, p.time - 2, p.time - 0.25);
    const post = meanIn(bass, p.time, p.time + 1);
    if (post >= 6.5 && post - pre >= 2) raw.push({ time: p.time, strength: post - pre });
  }
  const drops: Drop[] = [];
  for (const d of raw.sort((a, b) => b.strength - a.strength)) {
    if (drops.every((k) => Math.abs(k.time - d.time) >= 8)) drops.push(d);
  }
  return drops.sort((a, b) => a.time - b.time);
}

/** PURE: build until each drop, `dropLen`s of drop, tail after the last drop = cool. */
export function classifySections(drops: Drop[], duration: number, dropLen = 8): Section[] {
  if (drops.length === 0) return [{ kind: 'build', start: 0, end: duration }];
  const out: Section[] = [];
  let cursor = 0;
  for (const d of drops) {
    if (d.time > cursor) out.push({ kind: 'build', start: cursor, end: d.time });
    const end = Math.min(d.time + dropLen, duration);
    out.push({ kind: 'drop', start: d.time, end });
    cursor = end;
  }
  if (cursor < duration) out.push({ kind: 'cool', start: cursor, end: duration });
  return out;
}

export async function buildMusicMap(audioPath: string): Promise<MusicMap> {
  const pcm = await decodePcmMono(audioPath);
  const duration = pcm.length / SR;
  const mt = new MusicTempo(pcm);
  const [energy, bass] = [await audioCurve(audioPath), await audioCurve(audioPath, true)];
  let drops = detectDrops(bass);
  // A montage needs a climax: no detectable drop → synthesize one at 60% of the track.
  if (drops.length === 0) drops = [{ time: duration * 0.6, strength: 1 }];
  return {
    bpm: Number(mt.tempo), beats: mt.beats, drops, energy,
    sections: classifySections(drops, duration), duration,
  };
}
