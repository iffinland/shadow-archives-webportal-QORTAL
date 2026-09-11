import { describe, expect, it } from 'vitest';

import { validateRichTextDocument } from './richText';
import { SAFE_RICH_TEXT_DOC } from '../test/fixtures/content';

function wrap(doc: unknown) {
  return { format: 'tiptap-json-v1', doc };
}

describe('validateRichTextDocument', () => {
  it('accepts a well-formed tiptap-json-v1 document', () => {
    const result = validateRichTextDocument(wrap(SAFE_RICH_TEXT_DOC));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.format).toBe('tiptap-json-v1');
      expect(result.value.doc.type).toBe('doc');
    }
  });

  it('rejects a non-object payload', () => {
    expect(validateRichTextDocument(null).ok).toBe(false);
    expect(validateRichTextDocument('text').ok).toBe(false);
    expect(validateRichTextDocument([]).ok).toBe(false);
  });

  it('rejects an unsupported format token', () => {
    const result = validateRichTextDocument({ format: 'html-v1', doc: SAFE_RICH_TEXT_DOC });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported-format');
  });

  it('requires the root node to be a doc', () => {
    const result = validateRichTextDocument(wrap({ type: 'paragraph' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-value');
  });

  it('rejects malformed nodes instead of coercing them', () => {
    expect(validateRichTextDocument(wrap({ type: 'doc', content: [{ type: '' }] })).ok).toBe(false);
    expect(
      validateRichTextDocument(wrap({ type: 'doc', content: [{ type: 'text', text: 7 }] })).ok,
    ).toBe(false);
    expect(validateRichTextDocument(wrap({ type: 'doc', content: 'nope' })).ok).toBe(false);
    expect(
      validateRichTextDocument(wrap({ type: 'doc', content: [{ type: 'text', marks: 5 }] })).ok,
    ).toBe(false);
  });

  it('drops nested unexpected attribute objects rather than trusting them', () => {
    const result = validateRichTextDocument(
      wrap({
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: '/arbitrary/THUMBNAIL/Shadow%20Archives/ok.webp',
              nested: { evil: true },
              list: [1, 2, 3],
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const image = result.value.doc.content?.[0];
      expect(image?.attrs).toEqual({ src: '/arbitrary/THUMBNAIL/Shadow%20Archives/ok.webp' });
    }
  });

  it('enforces the node-count bound', () => {
    // Many small content arrays (each below the per-array cap) so the global
    // node budget is what trips, not the bounded-array check.
    const content = Array.from({ length: 100 }, () => ({
      type: 'paragraph',
      content: Array.from({ length: 60 }, () => ({ type: 'text', text: 'x' })),
    }));
    const result = validateRichTextDocument(wrap({ type: 'doc', content }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too-large');
  });

  it('rejects a single over-long content array as invalid-type', () => {
    const content = Array.from({ length: 6000 }, () => ({ type: 'paragraph' }));
    const result = validateRichTextDocument(wrap({ type: 'doc', content }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-type');
  });

  it('enforces the nesting-depth bound', () => {
    let node: Record<string, unknown> = { type: 'text', text: 'deep' };
    for (let index = 0; index < 60; index += 1) node = { type: 'paragraph', content: [node] };
    const result = validateRichTextDocument(wrap({ type: 'doc', content: [node] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too-large');
  });

  it('enforces the total-text bound', () => {
    const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(200_001) }] }];
    const result = validateRichTextDocument(wrap({ type: 'doc', content }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too-large');
  });
});
