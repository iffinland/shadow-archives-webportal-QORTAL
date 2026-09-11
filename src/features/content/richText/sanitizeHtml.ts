import DOMPurify from 'dompurify';

/**
 * DOMPurify defence-in-depth boundary (owner decision D4).
 *
 * This module is imported only from the lazy blog-detail render path, so
 * DOMPurify stays out of the home/startup bundle.
 *
 * The allowlist mirrors exactly what `renderTipTap.ts` can emit. A post-sanitize
 * hook can only tighten the result: it strips `target` and forces
 * `rel="noopener noreferrer"` on every anchor, so it cannot reintroduce unsafe
 * markup.
 *
 * `USE_PROFILES` is deliberately NOT set: the `html` profile would union a broad
 * default tag set into `ALLOWED_TAGS` and silently re-enable elements (for
 * example `form`) that this boundary must not admit.
 */
const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'hr',
  'br',
  'strong',
  'em',
  'u',
  's',
  'span',
  'mark',
  'a',
  'img',
];

const ALLOWED_ATTR = ['href', 'rel', 'src', 'alt', 'width', 'height', 'start', 'class', 'style'];

const ALLOWED_URI_REGEXP = /^(?:(?:https?|qortal):|\/)/i;

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'target') {
      data.keepAttr = false;
      return;
    }
    if (node.nodeName === 'A' && data.attrName === 'rel') {
      data.attrValue = 'noopener noreferrer';
    }
  });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer');
      node.removeAttribute('target');
    }
  });
}

export function sanitizeRenderedHtml(html: string): string {
  configure();
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  return typeof sanitized === 'string' ? sanitized : '';
}
