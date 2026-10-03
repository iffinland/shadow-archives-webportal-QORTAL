/**
 * Runtime-compatible random identifier helper.
 *
 * `crypto.randomUUID()` is only defined in secure contexts and is absent from
 * some embedded Qortal Hub/webview runtimes (observed owner runtime error:
 * `crypto.randomUUID is not a function`). `crypto.getRandomValues()` belongs to
 * the older Web Crypto core and is available in those same runtimes, so the one
 * reusable helper here derives identifiers from it instead.
 */

const HEX_DIGITS = '0123456789abcdef';

function cryptoSource(): Crypto {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('Cryptographically secure randomness is unavailable in this context');
  }
  return source;
}

/**
 * A lowercase hex token of `length` characters taken from
 * `crypto.getRandomValues`. Hex keeps the exact shape previously produced by
 * the removed `crypto.randomUUID()` call (8 hex characters for a comment id).
 */
export function randomHexId(length = 8): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('randomHexId length must be a positive integer');
  }
  const bytes = new Uint8Array(length);
  cryptoSource().getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) value += HEX_DIGITS[byte & 0x0f];
  return value;
}
