import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: null }, { a: 'line\nbreak', b: 2, c: 3 }], [
      { key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' },
    ]);
    expect(csv).toBe('A,B,C\r\n"x,y","say ""hi""",\r\n"line\nbreak",2,3\r\n');
  });
});
