import { describe, it, expect } from 'vitest';
import { splitThumbLines } from './thumbLogic';

describe('splitThumbLines', () => {
  it('short text stays one line; long text splits into two', () => {
    expect(splitThumbLines('NO WAY')).toEqual({ lines: ['NO WAY'], lastWord: 'WAY' });
    expect(splitThumbLines('HE DID IT')).toEqual({ lines: ['HE DID', 'IT'], lastWord: 'IT' });
    expect(splitThumbLines('THIS GOT SO INSANE')).toEqual({ lines: ['THIS GOT', 'SO INSANE'], lastWord: 'INSANE' });
  });
  it('empty text → one empty line', () => {
    expect(splitThumbLines('')).toEqual({ lines: [''], lastWord: '' });
  });
});
