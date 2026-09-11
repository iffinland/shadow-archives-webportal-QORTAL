import { describe, expect, it } from 'vitest';

import { sanitizeRenderedHtml } from './sanitizeHtml';

describe('sanitizeRenderedHtml (DOMPurify defence in depth)', () => {
  it('strips executable HTML but keeps allowlisted markup', () => {
    const result = sanitizeRenderedHtml('<p>ok</p><script>alert(1)</script>');
    expect(result).toContain('<p>ok</p>');
    expect(result.toLowerCase()).not.toContain('<script');
  });

  it('strips event-handler attributes', () => {
    const result = sanitizeRenderedHtml('<img src="/arbitrary/IMAGE/N/i" onerror="alert(1)" />');
    expect(result).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    const result = sanitizeRenderedHtml('<a href="javascript:alert(1)">x</a>');
    expect(result.toLowerCase()).not.toContain('javascript:');
  });

  it('drops the target attribute and forces a hardened rel', () => {
    const result = sanitizeRenderedHtml('<a href="https://example.com/" target="_blank">x</a>');
    expect(result).not.toContain('target=');
    expect(result).toContain('noopener noreferrer');
  });

  it('drops disallowed tags and attributes', () => {
    const result = sanitizeRenderedHtml(
      '<iframe src="https://evil.test"></iframe><form action="/x"></form>',
    );
    expect(result).not.toContain('iframe');
    expect(result).not.toContain('form');
  });

  it('is idempotent on already-safe renderer output', () => {
    const source =
      '<p><strong>bold</strong> and <a href="https://example.com/" rel="noopener noreferrer">a</a></p>';
    expect(sanitizeRenderedHtml(source)).toBe(source);
  });
});
