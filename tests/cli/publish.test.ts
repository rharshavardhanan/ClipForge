import { describe, it, expect } from 'vitest';
import { selectClips } from '../../src/cli/commands/publish.js';

describe('selectClips', () => {
  const clips = [{ clip_id: 'clip_001' }, { clip_id: 'clip_002' }, { clip_id: 'clip_003' }];
  it('no filter → all clips in order', () => {
    expect(selectClips(clips)).toEqual(['clip_001', 'clip_002', 'clip_003']);
  });
  it('csv filter keeps manifest order, ignores unknown ids', () => {
    expect(selectClips(clips, 'clip_003,clip_001,clip_999')).toEqual(['clip_001', 'clip_003']);
  });
  it('whitespace in csv is tolerated', () => {
    expect(selectClips(clips, ' clip_002 , clip_003 ')).toEqual(['clip_002', 'clip_003']);
  });
});
