import { describe, it, expect, afterEach } from 'vitest';
import { formatTimestamp, groupCues, writeSrt } from '../../src/captions/srtGenerator.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const w = (text: string, start: number) => ({ text, start, end: start + 0.4, emphasized: false });
const out = join('workspace', 'temp', 'test.srt');
afterEach(async () => { await rm(out, { force: true }); });

describe('srtGenerator', () => {
  it('formats timestamps as HH:MM:SS,mmm', () => {
    expect(formatTimestamp(3661.5)).toBe('01:01:01,500');
    expect(formatTimestamp(0)).toBe('00:00:00,000');
    expect(formatTimestamp(3600)).toBe('01:00:00,000');
    expect(formatTimestamp(3661.9995)).toBe('01:01:02,000'); // rounds up cleanly, no ",1000"
  });
  it('groups into cues of <=4 words', () => {
    const cues = groupCues([w('a', 0), w('b', 0.5), w('c', 1), w('d', 1.5), w('e', 2)], 4);
    expect(cues).toHaveLength(2);
    expect(cues[0].text.split(' ')).toHaveLength(4);
  });
  it('writes a valid SRT file', async () => {
    await writeSrt([w('Hello', 0), w('world', 0.5)], out);
    const txt = await readFile(out, 'utf8');
    expect(txt).toMatch(/^1\n00:00:00,000 --> /);
    expect(txt).toContain('Hello world');
  });
});
