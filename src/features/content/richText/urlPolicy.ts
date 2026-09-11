/**
 * URL policy for stored content.
 *
 * - `http(s)`: allowed as a link element, but the product policy (and the
 *   platform's own `q-apps.js` handler) prevents navigating the Q-App away.
 *   The reader component intercepts the click and copies the URL instead.
 * - `qortal://`: allowed as a real anchor; the host intercepts and opens/keeps
 *   the tab. This is the verified in-ecosystem link mechanism.
 * - Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, relative
 *   paths, fragments) is rejected: the link mark is dropped and its text is kept.
 */

import { hasControlCharacters } from '../../../domain/validation';

export type ContentUrlDecision =
  | { readonly kind: 'external-web'; readonly url: string }
  | { readonly kind: 'qortal'; readonly url: string }
  | { readonly kind: 'reject' };

export function classifyContentUrl(raw: unknown): ContentUrlDecision {
  if (typeof raw !== 'string') return { kind: 'reject' };
  const value = raw.trim();
  if (value.length === 0 || value.length > 2048) return { kind: 'reject' };
  if (hasControlCharacters(value)) return { kind: 'reject' };

  // Scheme check happens before any URL parsing; a scheme-less value (including
  // `javascript:alert(1)` obfuscated with entities) cannot pass this test.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!schemeMatch) return { kind: 'reject' };
  const scheme = schemeMatch[1].toLowerCase();

  if (scheme === 'qortal') {
    return { kind: 'qortal', url: value };
  }
  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'reject' };
      return { kind: 'external-web', url: parsed.toString() };
    } catch {
      return { kind: 'reject' };
    }
  }
  return { kind: 'reject' };
}

/**
 * Image source policy: only same-origin `/arbitrary/...` paths and inline
 * `data:image/*` payloads. External origins are blocked by the production CSP
 * anyway; anything else (`javascript:`, `file:`, protocol-relative) is dropped.
 */
export function isAllowedImageSource(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (value.length === 0 || value.length > 4096) return false;
  if (hasControlCharacters(value)) return false;
  if (value.startsWith('/arbitrary/')) return true;
  return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value);
}
