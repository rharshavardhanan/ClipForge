/**
 * Comment-timestamp mining (the "viewers flagged this moment" signal).
 *
 * YouTube viewers often comment timestamps like "3:42 best part" — and when such a
 * comment is highly liked, that moment is very likely clip-worthy. This module turns
 * top comments into time-located boost points the scorer can fold into the composite.
 * Pure logic only (no I/O); the comment fetch + score wiring live elsewhere.
 */

export interface CommentInput {
  text: string;
  likes: number;
}

export interface CommentBoost {
  time: number; // seconds
  weight: number; // 0-10, relative strength of viewer interest at this time
}

const TS_RE = /\b(\d{1,3}):(\d{2})(?::(\d{2}))?\b/g;

/**
 * Extract timestamps (in seconds) from a comment. Handles `mm:ss` and `h:mm:ss`.
 * Rejects impossible values (seconds/minutes >= 60 in the relevant field).
 */
export function parseTimestamps(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(TS_RE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = m[3] !== undefined ? Number(m[3]) : undefined;
    if (c !== undefined) {
      // h:mm:ss
      if (b >= 60 || c >= 60) continue;
      out.push(a * 3600 + b * 60 + c);
    } else {
      // mm:ss (minutes may exceed 60 for long videos; seconds must be < 60)
      if (b >= 60) continue;
      out.push(a * 60 + b);
    }
  }
  return out;
}

/**
 * Cluster the timestamps mentioned across top comments and weight each cluster by how
 * many viewers (and how many likes) point at it. Returns 0-10 boost points at cluster centers.
 *
 * @param comments       top comments ({text, likes})
 * @param clusterWindow  seconds; timestamps within this of a cluster join it (default 30)
 * @param maxTime        optional video duration; timestamps outside [0,maxTime] are dropped
 */
export function commentBoosts(
  comments: CommentInput[],
  clusterWindow = 30,
  maxTime?: number,
): CommentBoost[] {
  // Collect (time, likes) points from all comment timestamps.
  const points: { t: number; likes: number }[] = [];
  for (const c of comments) {
    for (const t of parseTimestamps(c.text)) {
      if (t < 0) continue;
      if (maxTime !== undefined && t > maxTime) continue;
      points.push({ t, likes: Math.max(0, c.likes) });
    }
  }
  if (points.length === 0) return [];

  // Greedy cluster by time.
  points.sort((p, q) => p.t - q.t);
  const clusters: { points: { t: number; likes: number }[] }[] = [];
  for (const p of points) {
    const last = clusters[clusters.length - 1];
    const center = last ? mean(last.points.map((x) => x.t)) : undefined;
    if (last && center !== undefined && Math.abs(p.t - center) <= clusterWindow) {
      last.points.push(p);
    } else {
      clusters.push({ points: [p] });
    }
  }

  // Raw weight per cluster: each mention contributes 1 + log(1+likes) (likes have diminishing returns).
  const raw = clusters.map((cl) => {
    const weight = cl.points.reduce((s, x) => s + 1 + Math.log1p(x.likes), 0);
    // like-weighted center so a highly-liked exact timestamp anchors the boost.
    const wsum = cl.points.reduce((s, x) => s + (1 + x.likes), 0);
    const time = cl.points.reduce((s, x) => s + x.t * (1 + x.likes), 0) / wsum;
    return { time, weight };
  });

  // Normalize weights to 0-10 relative to the strongest cluster.
  const maxW = Math.max(...raw.map((r) => r.weight));
  return raw.map((r) => ({ time: r.time, weight: maxW > 0 ? (r.weight / maxW) * 10 : 0 }));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
