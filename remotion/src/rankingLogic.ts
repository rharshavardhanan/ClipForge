// type aliases (not interfaces) so props satisfy Remotion's Record<string, unknown> constraint
export type RankingItem = {
  videoPath: string; // relative to remotion/public (staticFile)
  rank: number;
  durationInFrames: number;
  title?: string;
};

export type TimelineSegment = {
  kind: 'card' | 'clip';
  itemIndex: number;
  from: number;
  durationInFrames: number;
};

export type RankingProps = {
  items: RankingItem[]; // in play order (#N first … #1 last)
  fps: number;
  cardFrames: number;
  accentColor: string;
};

/** One countdown card then the clip itself, per item, in the given order. */
export function buildTimeline(items: RankingItem[], cardFrames: number): TimelineSegment[] {
  const segs: TimelineSegment[] = [];
  let from = 0;
  items.forEach((item, itemIndex) => {
    segs.push({ kind: 'card', itemIndex, from, durationInFrames: cardFrames });
    from += cardFrames;
    segs.push({ kind: 'clip', itemIndex, from, durationInFrames: item.durationInFrames });
    from += item.durationInFrames;
  });
  return segs;
}

export function totalFrames(items: RankingItem[], cardFrames: number): number {
  return Math.max(1, items.reduce((a, i) => a + i.durationInFrames + cardFrames, 0));
}
