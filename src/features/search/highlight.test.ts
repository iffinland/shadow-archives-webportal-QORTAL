import { describe, expect, it } from 'vitest';

import { highlightSegments } from './highlight';

/** Collapse segments to the plain text they render. */
function plain(text: string): string {
  return text;
}

describe('highlightSegments', () => {
  it('returns the whole text unmatched for an empty query', () => {
    expect(highlightSegments('Redaction notes', '   ')).toEqual([
      { text: 'Redaction notes', match: false },
    ]);
  });

  it('marks every case-insensitive occurrence and preserves original casing', () => {
    expect(highlightSegments('Archive archive ARCHIVE', 'archive')).toEqual([
      { text: 'Archive', match: true },
      { text: ' ', match: false },
      { text: 'archive', match: true },
      { text: ' ', match: false },
      { text: 'ARCHIVE', match: true },
    ]);
  });

  it('handles a match at the start and end, and no match', () => {
    expect(highlightSegments('abc', 'ab')).toEqual([
      { text: 'ab', match: true },
      { text: 'c', match: false },
    ]);
    expect(highlightSegments('abc', 'bc')).toEqual([
      { text: 'a', match: false },
      { text: 'bc', match: true },
    ]);
    expect(highlightSegments('abc', 'zzz')).toEqual([{ text: 'abc', match: false }]);
  });

  it('treats regex metacharacters as literal text (no regex path)', () => {
    const segments = highlightSegments('a.*b', '.*');
    expect(segments).toEqual([
      { text: 'a', match: false },
      { text: '.*', match: true },
      { text: 'b', match: false },
    ]);
  });

  it('keeps markup-looking text as plain segments, never HTML', () => {
    const segments = highlightSegments('<img src=x onerror=alert(1)>', 'img');
    expect(segments.map((segment) => segment.text).join('')).toBe('<img src=x onerror=alert(1)>');
    expect(segments.some((segment) => segment.match)).toBe(true);
    expect(plain('')).toBe('');
  });

  it('returns no segments for empty text', () => {
    expect(highlightSegments('', 'archive')).toEqual([]);
  });
});
