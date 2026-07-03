/**
 * PURE: compact numeric evidence block for arc prompts — RMS/motion curves
 * (downsampled), silence gaps, face counts. Capped at MAX_EVIDENCE_LINES so
 * long windows can't blow up the prompt.
 */
import type { CurvePoint } from '../rankrot/signals.js';
import type { ArcSpan, SilenceRegion } from '../types/index.js';

export const MAX_EVIDENCE_LINES = 40;

export function downsampleCurve(points: CurvePoint[], span: ArcSpan, stepSec = 2): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let t = span.start; t < span.end; t += stepSec) {
    const bucket = points.filter((p) => p.time >= t && p.time < t + stepSec);
    if (bucket.length > 0) out.push({ time: t, v: bucket.reduce((a, p) => a + p.v, 0) / bucket.length });
  }
  return out;
}

const fmtCurve = (label: string, pts: CurvePoint[]): string[] => (pts.length === 0 ? [] : [
  `${label} (time:value):`,
  pts.map((p) => `${p.time.toFixed(1)}:${p.v.toFixed(1)}`).join(' '),
]);

export interface EvidenceInput {
  window: ArcSpan;
  rms: CurvePoint[];
  motion: CurvePoint[];
  silences?: SilenceRegion[];
  facesPerSec?: CurvePoint[];
}

export function buildEvidenceBlock(e: EvidenceInput): string {
  // Widen the step until each curve fits in one long line and the block stays capped.
  const span = e.window;
  const step = Math.max(2, Math.ceil((span.end - span.start) / 30 / 2) * 2);
  const lines: string[] = [
    `window ${span.start.toFixed(1)}-${span.end.toFixed(1)}s`,
    ...fmtCurve('audio rms', downsampleCurve(e.rms, span, step)),
    ...fmtCurve('motion', downsampleCurve(e.motion, span, step)),
  ];
  const sil = (e.silences ?? []).filter((s) => s.end > span.start && s.start < span.end);
  if (sil.length > 0) lines.push(`silences: ${sil.map((s) => `silence ${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', ')}`);
  const faces = downsampleCurve(e.facesPerSec ?? [], span, step);
  if (faces.length > 0) lines.push(...fmtCurve('faces on screen', faces));
  return lines.slice(0, MAX_EVIDENCE_LINES).join('\n');
}
