/**
 * PURE: the unified understanding prompt — the arc-mining rules VERBATIM from
 * miningPrompt (same six-component instructions, same JSON example) plus scene
 * segmentation, story edges, and the perception-facts digest. One call per chunk,
 * same budget as arc mining alone.
 */
import { MODE_VOCAB } from '../analysis/arcMiner.js';
import type { TranscriptChunk } from '../analysis/arcChunker.js';
import type { ContentMode } from '../modes.js';

export function understandingPrompt(
  chunk: TranscriptChunk, evidence: string, digest: string, mode: ContentMode, maxSpanSec?: number,
): string {
  const transcript = chunk.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  return [
    `Analyze this ${mode} source segment. Return micro-stories, scenes, and story edges.`,
    '',
    'MICRO-STORIES: find 0-4 COMPLETE micro-stories.',
    'A micro-story has ALL SIX components: setup, trigger, escalation, peak, payoff, reaction.',
    'Components may be brief (>=0.5s) or overlap/nest (a trigger inside setup, escalation coinciding with peak) — identify all six or omit the story.',
    `Mode vocabulary: ${MODE_VOCAB[mode]}`,
    ...(maxSpanSec ? [`HARD LIMIT: each micro-story must span at most ${maxSpanSec} seconds from setup start to reaction end — longer stories are rejected downstream.`] : []),
    'Set reactionAfterPeak true when a clear reaction FOLLOWS the peak (weight those stories higher).',
    '',
    'SCENES: segment the window into 2-8 coherent SCENES (each >=3s, non-overlapping, in time order):',
    'label (short natural phrase of what is happening), participants (speaker ids like "S0" when known, else names),',
    'goal (what they are trying to do), emotion (dominant tone), events (up to 5 notable happenings), importance (0-1: how much a viewer must see this).',
    '',
    'EDGES: 0-8 STORY EDGES connecting scenes/stories: type one of setup_for|escalates|pays_off|reacts_to|callback.',
    'from/to reference YOUR OWN arrays in this response: "sc<i>" = scenes[i], "arc<i>" = arcs[i].',
    '',
    'Times are source-absolute seconds.',
    'Return ONLY JSON in EXACTLY this shape (numbers in seconds, every key shown):',
    '{"arcs":[{"synopsis":"one line","confidence":0.8,"reactionAfterPeak":true,'
      + '"components":{"setup":{"start":12.9,"end":31.3},"trigger":{"start":31.3,"end":36.8},'
      + '"escalation":{"start":36.8,"end":57.4},"peak":{"start":57.4,"end":77.8},'
      + '"payoff":{"start":77.8,"end":93.6},"reaction":{"start":93.6,"end":110.3}}}],'
      + '"scenes":[{"span":{"start":10.0,"end":42.5},"label":"gym bet between friends","participants":["S0","S1"],'
      + '"goal":"win the bet","emotion":"hype","events":["bet made","first attempt fails"],"importance":0.8}],'
      + '"edges":[{"from":"sc0","to":"arc0","type":"setup_for","confidence":0.8}]}',
    '', 'TRANSCRIPT:', transcript,
    '', 'SIGNAL EVIDENCE:', evidence,
    ...(digest.trim() !== '' ? ['', 'PERCEPTION FACTS:', digest] : []),
  ].join('\n');
}
