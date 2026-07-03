/** Output geometries for short-form exports. 9:16 = full portrait, 3:4 = tall-but-not-full. */
export function aspectDims(flag: string): { outW: number; outH: number; ratio: number } {
  if (flag === '9:16') return { outW: 1080, outH: 1920, ratio: 9 / 16 };
  if (flag === '3:4') return { outW: 1080, outH: 1440, ratio: 3 / 4 };
  throw new Error(`--aspect must be 9:16 or 3:4 (got "${flag}")`);
}
