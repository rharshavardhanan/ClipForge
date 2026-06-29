import type { AudioEnergyLayer, TriggerHit, WindowScore } from '../types/index.js';

const WINDOW = 30;
const STEP = 15;

export function scoreWindows(duration: number, triggers: TriggerHit[], audio: AudioEnergyLayer): WindowScore[] {
  const windows: WindowScore[] = [];
  for (let start = 0; start < duration; start += STEP) {
    const end = Math.min(start + WINDOW, duration);
    const triggerSum = triggers.filter((t) => t.time >= start && t.time < end).reduce((a, t) => a + t.weight, 0);
    const triggerScore = Math.min(10, triggerSum);
    const pts = audio.rms_curve.filter((p) => p.time >= start && p.time < end);
    const audioScore = pts.length ? pts.reduce((a, p) => a + p.rms, 0) / pts.length : 0;
    windows.push({ start, end, triggerScore, audioScore, composite: triggerScore * 0.6 + audioScore * 0.4 });
  }
  return windows;
}
