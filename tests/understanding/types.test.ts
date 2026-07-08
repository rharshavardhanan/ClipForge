import { describe, expect, it } from 'vitest';
import { STORY_EDGE_TYPES, UNDERSTAND_SCHEMA } from '../../src/understanding/types.js';

/** Every object node in a Claude-facing schema must set additionalProperties: false. */
function assertStrictObjects(node: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (!node || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  if (n.type === 'object' && n.additionalProperties !== false) out.push(path);
  for (const [k, v] of Object.entries(n)) out.push(...assertStrictObjects(v, `${path}.${k}`));
  return out;
}

describe('UNDERSTAND_SCHEMA', () => {
  it('sets additionalProperties:false on every object (Claude structured-outputs rule)', () => {
    expect(assertStrictObjects(UNDERSTAND_SCHEMA)).toEqual([]);
  });
  it('requires arcs, scenes and edges at the top level', () => {
    expect((UNDERSTAND_SCHEMA as { required: string[] }).required).toEqual(['arcs', 'scenes', 'edges']);
  });
  it('edge type enum matches STORY_EDGE_TYPES', () => {
    const edgeItems = (UNDERSTAND_SCHEMA as never as {
      properties: { edges: { items: { properties: { type: { enum: string[] } } } } };
    }).properties.edges.items;
    expect(edgeItems.properties.type.enum).toEqual([...STORY_EDGE_TYPES]);
  });
});
