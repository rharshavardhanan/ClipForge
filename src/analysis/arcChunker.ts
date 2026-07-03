/** PURE: split a transcript into ~chunkSec windows with overlapSec overlap for arc mining. */
import type { TranscriptSegment } from '../types/index.js';

export interface TranscriptChunk { start: number; end: number; segments: TranscriptSegment[]; }

export function chunkTranscript(
  segments: TranscriptSegment[], chunkSec = 540, overlapSec = 60,
): TranscriptChunk[] {
  if (segments.length === 0) return [];
  const last = Math.max(...segments.map((s) => s.end));
  const step = Math.max(1, chunkSec - overlapSec);
  const out: TranscriptChunk[] = [];
  for (let start = 0; start < last; start += step) {
    const end = start + chunkSec;
    const inWindow = segments.filter((s) => s.end > start && s.start < end);
    if (inWindow.length > 0) out.push({ start, end, segments: inWindow });
    if (end >= last) break;
  }
  return out;
}
