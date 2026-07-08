import { describe, it, expect, vi } from 'vitest';
import { resolvePerception, perceptionEnabled, type PerceptionClient } from '../../src/perception/perceptionClient.js';

const fakeTimeline = { job_id: 'j', producers_run: ['mock'] } as unknown;

function client(): PerceptionClient & { analyze: ReturnType<typeof vi.fn> } {
  const analyze = vi.fn(async () => fakeTimeline as never);
  return { analyze };
}

describe('resolvePerception', () => {
  it('returns null and does not call the client when disabled', async () => {
    const c = client();
    const res = await resolvePerception(false, '/v.mp4', 'j', c);
    expect(res).toBeNull();
    expect(c.analyze).not.toHaveBeenCalled();
  });

  it('delegates to the client when enabled', async () => {
    const c = client();
    const res = await resolvePerception(true, '/v.mp4', 'j', c);
    expect(c.analyze).toHaveBeenCalledWith('/v.mp4', 'j');
    expect(res).toBe(fakeTimeline);
  });
});

describe('perceptionEnabled', () => {
  it('defaults ON', () => {
    expect(perceptionEnabled(undefined, {})).toBe(true);
    expect(perceptionEnabled(true, {})).toBe(true);
  });
  it('--no-perception turns it off', () => {
    expect(perceptionEnabled(false, {})).toBe(false);
  });
  it('PERCEPTION env wins in both directions', () => {
    expect(perceptionEnabled(undefined, { PERCEPTION: '0' })).toBe(false);
    expect(perceptionEnabled(false, { PERCEPTION: '1' })).toBe(true);
  });
});
