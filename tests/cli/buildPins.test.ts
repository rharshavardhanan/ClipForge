import { describe, it, expect } from 'vitest';
import { buildPins, type AllOpts } from '../../src/cli/commands/all.js';
import { CAPTION_PRESETS } from '../../src/captions/presets.js';

const base: AllOpts = { top: 3, accent: '#FFD700' };

describe('buildPins', () => {
  it('unpinned by default when hook text + sfx lib exist', () => {
    expect(buildPins(base, true, true)).toEqual({ captionPreset: false, zooms: false, sfx: false, hook: false });
  });
  it('--style or resolved caption pins the preset', () => {
    expect(buildPins({ ...base, style: 'mrbeast' }, true, true).captionPreset).toBe(true);
    expect(buildPins({ ...base, caption: CAPTION_PRESETS.mrbeast }, true, true).captionPreset).toBe(true);
  });
  it('--no-zooms pins zooms, --no-sfx or empty lib pins sfx', () => {
    expect(buildPins({ ...base, zooms: false }, true, true).zooms).toBe(true);
    expect(buildPins({ ...base, sfx: false }, true, true).sfx).toBe(true);
    expect(buildPins(base, true, false).sfx).toBe(true);
  });
  it('no hook text pins the hook dimension', () => {
    expect(buildPins(base, false, true).hook).toBe(true);
  });
});
