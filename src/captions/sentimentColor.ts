const SENTIMENT_COLORS: Record<string, string> = {
  funny: '#22DD55',
  serious: '#FF3B30',
  intense: '#FF8C00',
};

/** PURE: map a clip's Gemini sentiment to a caption accent color, falling back for neutral/unknown/missing. */
export function sentimentColor(sentiment: string | undefined, fallback: string): string {
  if (!sentiment) return fallback;
  return SENTIMENT_COLORS[sentiment] ?? fallback;
}
