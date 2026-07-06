/**
 * Platform safe-area rect (v4 Part 3 §7.4 / Part 4 §7): the fractions of the 9:16 output
 * frame reserved by platform UI. Captions must sit inside it and framing must keep faces
 * clear of the caption band. Shared by the caption gate, the (future) crop-solver
 * caption-avoidance, and the audit — one source of truth.
 */
export interface SafeArea { top: number; bottom: number; left: number; right: number; }

/** Shorts/Reels/TikTok share a similar band: top clock/close (~12%), bottom caption/CTA
 *  stack (~18%), narrow side margins (~5%). */
export const PLATFORM_SAFE_AREA: SafeArea = { top: 0.12, bottom: 0.18, left: 0.05, right: 0.05 };

/** PURE: the vertical band (fractions) where burned captions render — a 14%-tall strip
 *  resting on top of the bottom UI. */
export function captionBandRect(sa: SafeArea = PLATFORM_SAFE_AREA): { yTop: number; yBottom: number } {
  const yBottom = 1 - sa.bottom;
  return { yTop: yBottom - 0.14, yBottom };
}
