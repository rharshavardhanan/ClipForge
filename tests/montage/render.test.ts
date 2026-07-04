import { it, expect } from 'vitest';
import { buildMontageProps } from '../../src/montage/render.js';
import type { MontagePlan } from '../../src/montage/types.js';

const plan: MontagePlan = {
  segments: [
    { src: 'a.mp4', srcStart: 1, srcDur: 2, playbackRate: 2, freeze: false, zoom: false, shake: false }, // 1s wall
    { src: 'b.mp4', srcStart: 0, srcDur: 0.7, playbackRate: 1, freeze: true, zoom: false, shake: false }, // 0.7s wall
  ],
  flashes: [{ time: 1, kind: 'white', frames: 3 }],
  musicOffset: 4, payoffAt: 1, payoffDur: 0.7, totalDur: 1.7,
};

it('converts wall seconds to cumulative frames', () => {
  const staged = new Map([['a.mp4', 'input/m_a.mp4'], ['b.mp4', 'input/m_b.mp4']]);
  const p = buildMontageProps(plan, [{ time: 0.5, value: 1 }], 'REPS', staged, 'input/music.mp3', '', 30, 0.9) as never as {
    segments: { from: number; durationInFrames: number; startFromFrames: number }[];
    flashes: { at: number }[]; counter: { at: number; value: number }[];
    musicStartFromFrames: number; payoffAtFrame: number;
  };
  expect(p.segments[0]).toMatchObject({ from: 0, durationInFrames: 30, startFromFrames: 30 });
  expect(p.segments[1].from).toBe(30);
  expect(p.segments[1].durationInFrames).toBe(21);
  expect(p.flashes[0].at).toBe(30);
  expect(p.counter[0]).toEqual({ at: 15, value: 1 });
  expect(p.musicStartFromFrames).toBe(120);
  expect(p.payoffAtFrame).toBe(30);
});
