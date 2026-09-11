import { describe, expect, it } from 'vitest';

import { renderTipTapDocument } from './renderTipTap';
import { sanitizeRenderedHtml } from './sanitizeHtml';
import { validateRichTextDocument } from '../../../domain';
import { MALICIOUS_RICH_TEXT_CASES, SAFE_RICH_TEXT_DOC } from '../../../test/fixtures/content';
import type { RichTextNode } from '../../../domain';

function render(doc: Record<string, unknown>) {
  return renderTipTapDocument(doc as unknown as RichTextNode);
}

describe('renderTipTapDocument', () => {
  it('renders the supported node subset as escaped markup', () => {
    const result = render({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body', marks: [{ type: 'bold' }] }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'text', text: 'One' }] }],
        },
      ],
    });
    expect(result.html).toBe('<h2>Title</h2><p><strong>Body</strong></p><ul><li>One</li></ul>');
    expect(result.droppedNodes).toBe(0);
  });

  it('escapes stored text and never emits raw HTML', () => {
    const result = render({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
      ],
    });
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('drops an unknown node with its subtree and counts it', () => {
    const result = render({
      type: 'doc',
      content: [{ type: 'mystery', content: [{ type: 'text', text: 'hidden' }] }],
    });
    expect(result.html).toBe('');
    expect(result.droppedNodes).toBe(1);
    expect(result.html).not.toContain('hidden');
  });

  it('ignores unknown marks but preserves their text', () => {
    const result = render({
      type: 'doc',
      content: [{ type: 'text', text: 'kept', marks: [{ type: 'mystery' }] }],
    });
    expect(result.html).toBe('kept');
  });

  it('rejects javascript: and data: link marks, blocking the link but keeping the text', () => {
    const js = render({
      type: 'doc',
      content: [
        {
          type: 'text',
          text: 'click',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    });
    expect(js.html).toBe('click');
    expect(js.blockedLinks).toBe(1);
    expect(js.html).not.toContain('javascript:');

    const data = render({
      type: 'doc',
      content: [
        {
          type: 'text',
          text: 'payload',
          marks: [{ type: 'link', attrs: { href: 'data:text/html;base64,PHNjcmlwdD4=' } }],
        },
      ],
    });
    expect(data.html).toBe('payload');
    expect(data.blockedLinks).toBe(1);
  });

  it('renders http(s) links with a hardened rel and the product link class', () => {
    const result = render({
      type: 'doc',
      content: [
        {
          type: 'text',
          text: 'source',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }],
        },
      ],
    });
    expect(result.html).toBe(
      '<a href="https://example.com/a?b=1" rel="noopener noreferrer" class="sa-content-link">source</a>',
    );
  });

  it('renders qortal:// links as real in-ecosystem anchors', () => {
    const result = render({
      type: 'doc',
      content: [
        {
          type: 'text',
          text: 'app',
          marks: [{ type: 'link', attrs: { href: 'qortal://APP/Q-Tube' } }],
        },
      ],
    });
    expect(result.html).toBe('<a href="qortal://APP/Q-Tube" rel="noopener noreferrer">app</a>');
  });

  it('allows only same-origin /arbitrary and inline image data URLs', () => {
    const allowed = render({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: '/arbitrary/THUMBNAIL/Shadow%20Archives/a.webp',
            alt: 'alt',
            width: 10,
            height: 20,
          },
        },
      ],
    });
    expect(allowed.html).toContain('<img src="/arbitrary/THUMBNAIL/Shadow%20Archives/a.webp"');
    expect(allowed.html).toContain('loading="lazy"');

    const blocked = render({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'javascript:alert(1)', onerror: 'alert(1)' } }],
    });
    expect(blocked.html).toBe('');
    expect(blocked.droppedImages).toBe(1);
  });

  it('never spreads arbitrary image attributes into the DOM', () => {
    const result = render({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: '/arbitrary/IMAGE/Name/i',
            onerror: 'alert(1)',
            onload: 'alert(2)',
            alt: '<b>bold</b>',
          },
        },
      ],
    });
    expect(result.html).not.toContain('onerror');
    expect(result.html).not.toContain('onload');
    expect(result.html).not.toContain('<b>');
  });

  it('normalises heading levels and falls back to a paragraph for invalid ones', () => {
    expect(
      render({ type: 'doc', content: [{ type: 'heading', attrs: { level: '3' } }] }).html,
    ).toBe('<h3></h3>');
    const invalid = render({ type: 'doc', content: [{ type: 'heading', attrs: { level: 9 } }] });
    expect(invalid.html).toBe('<p></p>');
    expect(invalid.droppedNodes).toBe(1);
  });

  it('accepts only an allowlisted CSS colour for text styles', () => {
    const safe = render({
      type: 'doc',
      content: [
        { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }] },
      ],
    });
    expect(safe.html).toBe('<span style="color:#ff0000">x</span>');

    const unsafe = render({
      type: 'doc',
      content: [
        {
          type: 'text',
          text: 'x',
          marks: [
            { type: 'textStyle', attrs: { color: 'red;}</style><script>alert(1)</script>' } },
          ],
        },
      ],
    });
    expect(unsafe.html).toBe('x');
    expect(unsafe.html).not.toContain('<script>');
  });

  it('does not crash on malformed nodes with non-string text', () => {
    const result = render({
      type: 'doc',
      content: [{ type: 'text', text: { evil: true } }],
    });
    expect(result.html).toBe('');
  });
});

describe('rich-text safety pipeline', () => {
  it('renders a safe document through validation and sanitization unchanged in meaning', () => {
    const validated = validateRichTextDocument({
      format: 'tiptap-json-v1',
      doc: SAFE_RICH_TEXT_DOC,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const html = sanitizeRenderedHtml(renderTipTapDocument(validated.value.doc).html);
    expect(html).toBe('<p>Safe text.</p>');
  });

  it.each(MALICIOUS_RICH_TEXT_CASES)('fails safely on $name', ({ doc, forbidden }) => {
    const validated = validateRichTextDocument({ format: 'tiptap-json-v1', doc });
    if (!validated.ok) {
      // Rejected before rendering: also a safe outcome.
      return;
    }
    const html = sanitizeRenderedHtml(renderTipTapDocument(validated.value.doc).html);
    expect(html).not.toContain(forbidden);
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });
});
