import { describe, it, expect, vi } from 'vitest';
import { resolvePerception, type PerceptionClient } from '../../src/perception/perceptionClient.js';

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
