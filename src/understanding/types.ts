/**
 * SP2 Understanding contract (spec 2026-07-08): Scene Graph nodes, Story Graph edges,
 * the assembled UnderstandingResult, the unified LLM response schema, and the pinned
 * constants from the spec. Arc items reuse ARC_MINE_SCHEMA's items verbatim so the
 * arc contract cannot drift from the miner's.
 */
import type { ArcLabel, ArcSpan } from '../types/index.js';
import { ARC_MINE_SCHEMA } from '../analysis/arcMiner.js';

export const STORY_EDGE_TYPES = ['setup_for', 'escalates', 'pays_off', 'reacts_to', 'callback'] as const;
export type StoryEdgeType = (typeof STORY_EDGE_TYPES)[number];

export interface SceneNode {
  id: string;                     // "sc0"… global after assembly
  span: ArcSpan;                  // source-absolute seconds
  label: string;                  // natural phrase, never /^scene \d+$/
  participants: string[];         // speaker ids ("S0") when diarized, else inferred names
  goal: string;
  emotion: string;
  events: string[];               // ≤5
  importance: number;             // 0-1 LLM anchor
}

export interface StoryEdge {
  from: string;                   // "sc<i>" | "arc<i>"
  to: string;
  type: StoryEdgeType;
  confidence: number;             // 0-1
}

export interface ImportancePoint { t: number; v: number; }

export interface UnderstandingResult {
  scenes: SceneNode[];
  arcs: ArcLabel[];               // EXACTLY today's mineArcs output shape
  edges: StoryEdge[];
  importance: ImportancePoint[];  // 1s resolution, whole video, 0-1
  provider: string;               // 'claude' | 'gemini' | 'none'
}

// --- pinned constants (spec §3-§4) ---
export const EDGE_MIN_CONFIDENCE = 0.3;
export const MIN_SCENE_SEC = 3;
export const SCENE_MERGE_MAX_GAP_SEC = 1;
export const SCENE_MERGE_MAX_SEC = 180;
export const W_SCENE = 0.45;
export const W_RMS = 0.20;
export const W_MOTION = 0.15;
export const W_EVENT = 0.20;
export const IMPORTANCE_SORT_WEIGHT = 1.5;
export const MAX_DIGEST_LINES = 40;

// --- unified response schema ---
const SPAN_SCHEMA = {
  type: 'object',
  properties: { start: { type: 'number' }, end: { type: 'number' } },
  required: ['start', 'end'],
  additionalProperties: false,
} as const;

const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    span: SPAN_SCHEMA,
    label: { type: 'string' },
    participants: { type: 'array', items: { type: 'string' } },
    goal: { type: 'string' },
    emotion: { type: 'string' },
    events: { type: 'array', items: { type: 'string' } },
    importance: { type: 'number' },
  },
  required: ['span', 'label', 'participants', 'goal', 'emotion', 'events', 'importance'],
  additionalProperties: false,
} as const;

const EDGE_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    type: { enum: [...STORY_EDGE_TYPES] },
    confidence: { type: 'number' },
  },
  required: ['from', 'to', 'type', 'confidence'],
  additionalProperties: false,
} as const;

export const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    arcs: (ARC_MINE_SCHEMA as { properties: { arcs: unknown } }).properties.arcs,
    scenes: { type: 'array', items: SCENE_SCHEMA },
    edges: { type: 'array', items: EDGE_SCHEMA },
  },
  required: ['arcs', 'scenes', 'edges'],
  additionalProperties: false,
};
