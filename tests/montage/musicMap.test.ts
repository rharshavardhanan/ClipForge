import { describe, expect, it } from 'vitest';
import { detectDrops, classifySections } from '../../src/montage/musicMap.js';

const flat = (v: number, n: number, dt = 0.5) =>
  Array.from({ length: n }, (_, i) => ({ time: i * dt, v }));

describe('detectDrops', () => {
  it('finds a bass surge after a dip', () => {
    // 0-10s quiet bass (3), 10-20s loud (8) → one drop at ~10s
    const bass = [...flat(3, 20), ...flat(8, 20).map((p) => ({ ...p, time: p.time + 10 }))];
    const drops = detectDrops(bass);
    expect(drops).toHaveLength(1);
    expect(drops[0].time).toBeGreaterThanOrEqual(9.5);
    expect(drops[0].time).toBeLessThanOrEqual(11);
  });
  it('flat loud bass has no drop', () => {
    expect(detectDrops(flat(8, 60))).toHaveLength(0);
  });
  it('two surges 20s apart are two drops', () => {
    const seg = (v: number, from: number, sec: number) =>
      flat(v, sec * 2).map((p) => ({ ...p, time: p.time + from }));
    const bass = [...seg(3, 0, 10), ...seg(8, 10, 5), ...seg(3, 15, 15), ...seg(8, 30, 5)];
    expect(detectDrops(bass)).toHaveLength(2);
  });
});

describe('classifySections', () => {
  it('build → drop → build → drop → cool', () => {
    const s = classifySections([{ time: 10, strength: 5 }, { time: 30, strength: 4 }], 45);
    expect(s.map((x) => x.kind)).toEqual(['build', 'drop', 'build', 'drop', 'cool']);
    expect(s[1]).toMatchObject({ start: 10, end: 18 });
    expect(s[4].end).toBe(45);
  });
  it('no drops → one build section', () => {
    expect(classifySections([], 30)).toEqual([{ kind: 'build', start: 0, end: 30 }]);
  });
});
