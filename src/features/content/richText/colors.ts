/**
 * Strict CSS colour allowlist for stored rich-text marks.
 *
 * Only the emitted `color`/`background-color` declarations ever use this value,
 * and it is additionally re-checked by DOMPurify's CSS sanitizer, so a hostile
 * `attrs.color` cannot inject arbitrary CSS.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const HSL =
  /^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

const NAMED = new Set([
  'black',
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
  'grey',
  'brown',
  'pink',
  'teal',
  'navy',
  'maroon',
  'olive',
]);

export function normalizeCssColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  if (color.length === 0 || color.length > 64) return null;
  if (HEX.test(color) || RGB.test(color) || HSL.test(color)) return color;
  const lower = color.toLowerCase();
  return NAMED.has(lower) ? lower : null;
}
