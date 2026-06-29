import type { TranscriptSegment, TriggerHit } from '../types/index.js';

function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

const TIER1 = ['wait', 'hold on', 'actually', "here's the thing", 'nobody tells you',
  'the truth is', 'this is the part where', 'what nobody knows', "i'm going to be honest",
  'this changed everything', 'the real reason', "here's what happened"];
const TIER2 = ['think about it', 'you know what i mean', 'crazy right', 'let me explain',
  'plot twist', "here's why", 'the problem is', 'imagine', 'picture this', 'real talk',
  'be honest', "most people don't", 'everyone gets this wrong'];
const TIER3 = ['interesting', 'funny thing', 'believe it or not', "here's the deal",
  'quick question', 'fun fact'];

const NUMBER_RE = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(reasons?|things?|ways?|signs?|steps?|rules?)\b/i;
const CONTRAST_RE = /\b(but|however|except)\b/i;

export function detectTriggers(segments: TranscriptSegment[]): TriggerHit[] {
  const hits: TriggerHit[] = [];
  for (const s of segments) {
    for (const p of TIER1) if (phraseRegex(p).test(s.text)) hits.push({ time: s.start, weight: 2.5, phrase: p, tier: 1 });
    for (const p of TIER2) if (phraseRegex(p).test(s.text)) hits.push({ time: s.start, weight: 1.5, phrase: p, tier: 2 });
    for (const p of TIER3) if (phraseRegex(p).test(s.text)) hits.push({ time: s.start, weight: 0.5, phrase: p, tier: 3 });
    if (NUMBER_RE.test(s.text)) hits.push({ time: s.start, weight: 1.0, phrase: 'number-statement', tier: 'structural' });
    if (CONTRAST_RE.test(s.text)) hits.push({ time: s.start, weight: 1.0, phrase: 'contrast', tier: 'structural' });
  }
  return hits;
}
