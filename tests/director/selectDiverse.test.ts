import { describe, it, expect } from 'vitest';
import { selectDiverse, type Selectable } from '../../src/director/selectDiverse.js';

const s = (id: string, composite: number, visual: number, topic: string, sourceId = 'v1'): Selectable =>
  ({ id, composite, visual, topic, sourceId });

describe('selectDiverse', () => {
  it('picks the off-topic clip over a higher-composite same-topic one for variety', () => {
    const items = [
      s('a', 9, 0.8, 'dunks'), s('b', 8.5, 0.8, 'dunks'), s('c', 8.5, 0.8, 'dunks'),
      s('d', 7, 0.8, 'fails'),
    ];
    const picked = selectDiverse(items, 2).map((x) => x.id);
    expect(picked[0]).toBe('a');           // highest composite first
    expect(picked[1]).toBe('d');           // variety beats a 3rd dunks clip
  });

  it('a much higher visual feasibility can outrank a slightly higher composite', () => {
    const items = [s('lowvis', 8.2, 0.1, 't1'), s('hivis', 8.0, 0.95, 't2')];
    expect(selectDiverse(items, 1)[0].id).toBe('hivis');
  });

  it('empty topic is never penalized against another empty topic', () => {
    const items = [s('a', 9, 0.8, ''), s('b', 8.9, 0.8, ''), s('c', 5, 0.8, 'other')];
    const picked = selectDiverse(items, 2).map((x) => x.id);
    expect(picked).toEqual(['a', 'b']);    // both unknown-topic, high composite, no penalty
  });

  it('is deterministic and tie-breaks by id', () => {
    const items = [s('b', 8, 0.5, 't'), s('a', 8, 0.5, 'u')];
    expect(selectDiverse(items, 2)).toEqual(selectDiverse(items, 2));
    expect(selectDiverse(items, 1)[0].id).toBe('a'); // equal adjusted → lexicographic
  });

  it('top >= items returns all', () => {
    const items = [s('a', 9, 0.8, 't'), s('b', 8, 0.8, 'u')];
    expect(selectDiverse(items, 5)).toHaveLength(2);
  });
});
