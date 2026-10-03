/**
 * Safe search-match highlighting.
 *
 * Returns plain segments for React to render as text/<mark> nodes. It never
 * builds HTML and never uses `dangerouslySetInnerHTML`, so a query or a stored
 * title cannot become markup. Matching is a case-insensitive literal scan
 * (no regex), so a query full of regex metacharacters is treated as text.
 */

export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (text.length === 0) return [];
  if (needle.length === 0) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  return segments;
}
