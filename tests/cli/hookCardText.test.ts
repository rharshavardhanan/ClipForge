import { describe, it, expect } from 'vitest';
import { hookCardText } from '../../src/cli/commands/all.js';

describe('hookCardText', () => {
  it('passes through strings of 8 words or fewer unchanged', () => {
    expect(hookCardText('this is exactly eight words long right here')).toBe('this is exactly eight words long right here');
  });
  it('passes through short strings unchanged', () => {
    expect(hookCardText('short hook')).toBe('short hook');
  });
  it('truncates strings over 8 words to 7 words plus an ellipsis', () => {
    const input = 'one two three four five six seven eight nine ten';
    expect(hookCardText(input)).toBe('one two three four five six seven…');
  });
  it('collapses extra whitespace before counting words', () => {
    expect(hookCardText('  this   is   exactly   eight   words   long   right   here  ')).toBe('this is exactly eight words long right here');
  });
});
