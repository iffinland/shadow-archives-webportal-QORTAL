import { describe, expect, it } from 'vitest';

import { richTextToMarkdown, richTextToPlainText } from './richTextMarkdown';
import type { RichTextDocument, RichTextNode } from './types';

function doc(...content: RichTextNode[]): RichTextDocument {
  return { format: 'tiptap-json-v1', doc: { type: 'doc', content } };
}

function paragraph(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content };
}

function text(value: string, marks?: RichTextNode['marks']): RichTextNode {
  return { type: 'text', text: value, ...(marks ? { marks } : {}) };
}

describe('richTextToMarkdown — structure', () => {
  it('derives headings, paragraphs and inline marks', () => {
    const markdown = richTextToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Heading')] },
        paragraph(
          text('bold', [{ type: 'bold' }]),
          text(' '),
          text('italic', [{ type: 'italic' }]),
        ),
        paragraph(
          text('under', [{ type: 'underline' }]),
          text(' '),
          text('gone', [{ type: 'strike' }]),
        ),
        paragraph(text('code', [{ type: 'code' }])),
      ),
    );
    expect(markdown).toBe('## Heading\n\n**bold** *italic*\n\n<u>under</u> ~~gone~~\n\n`code`');
  });

  it('renders safe links and degrades an unsafe scheme to plain text', () => {
    const markdown = richTextToMarkdown(
      doc(
        paragraph(
          text('qortal', [{ type: 'link', attrs: { href: 'qortal://APP/Shadow%20Archives' } }]),
          text(' '),
          text('click me', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        ),
      ),
    );
    expect(markdown).toBe('[qortal](qortal://APP/Shadow%20Archives) click me');
  });

  it('derives bullet and ordered lists with nesting', () => {
    const markdown = richTextToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [paragraph(text('one')), paragraph(text('two'))],
          },
          {
            type: 'listItem',
            content: [
              paragraph(text('three')),
              {
                type: 'orderedList',
                content: [{ type: 'listItem', content: [paragraph(text('nested'))] }],
              },
            ],
          },
        ],
      }),
    );
    expect(markdown).toBe('- one\n\n  two\n- three\n\n  1. nested');
  });

  it('derives quotes, rules, code blocks and hard breaks', () => {
    const markdown = richTextToMarkdown(
      doc(
        { type: 'blockquote', content: [paragraph(text('quoted'))] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] },
        { type: 'horizontalRule' },
        paragraph(text('before'), { type: 'hardBreak' }, text('after')),
      ),
    );
    expect(markdown).toBe(
      ['> quoted', '', '```ts', 'const a = 1;', '```', '', '---', '', 'before\nafter'].join('\n'),
    );
  });
});

describe('richTextToMarkdown — safety and fidelity', () => {
  it('escapes stored text so it cannot become HTML or markdown syntax', () => {
    const markdown = richTextToMarkdown(
      doc(paragraph(text('<script>alert(1)</script> *not italic* # not a heading'))),
    );
    expect(markdown).not.toContain('<script>');
    expect(markdown.startsWith('\\<script\\>')).toBe(true);
    expect(markdown).toContain('\\*not italic\\*');
    expect(markdown).toContain('\\# not a heading');
  });

  it('neutralizes a code fence hidden inside a code block', () => {
    const markdown = richTextToMarkdown(
      doc({ type: 'codeBlock', content: [text('```\nlol\n```')] }),
    );
    expect(markdown.match(/```/g)).toHaveLength(2);
  });

  it('keeps inline code literal (no Markdown escaping inside a code span)', () => {
    const markdown = richTextToMarkdown(doc(paragraph(text('a.b*c_d', [{ type: 'code' }]))));
    expect(markdown).toBe('`a.b*c_d`');
  });

  it('keeps a safe image and drops an unsafe one', () => {
    const markdown = richTextToMarkdown(
      doc(
        paragraph({
          type: 'image',
          attrs: { src: 'https://example.org/a.png', alt: 'alt text' },
        }),
        paragraph({ type: 'image', attrs: { src: 'blob:http://localhost/dead', alt: 'gone' } }),
      ),
    );
    expect(markdown).toBe('![alt text](https://example.org/a.png)');
  });

  it('traverses an unknown node instead of dropping its text', () => {
    const markdown = richTextToMarkdown(
      doc({
        type: 'someFutureBlock',
        content: [paragraph(text('kept'))],
      }),
    );
    expect(markdown).toBe('kept');
  });

  it('returns an empty string for an empty document', () => {
    expect(richTextToMarkdown(doc(paragraph()))).toBe('');
    expect(richTextToPlainText(doc(paragraph()))).toBe('');
  });
});

describe('richTextToPlainText', () => {
  it('normalizes whitespace, keeps block boundaries and marks list items', () => {
    const plain = richTextToPlainText(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        paragraph(text('Some   spaced'), text(' text.')),
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('first'))] }],
        },
      ),
    );
    expect(plain).toBe('Title\n\nSome spaced text.\n\n- first');
  });

  it('is bounded by the bodyText limit', () => {
    const long = richTextToPlainText(doc(paragraph(text('x'.repeat(9000)))));
    expect(long.length).toBe(8192);
  });
});
