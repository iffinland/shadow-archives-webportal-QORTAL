import { describe, expect, it } from 'vitest';

import {
  dedupeTaxonomy,
  normalizeTaxonomySlug,
  taxonomyIncludesSlug,
  toTaxonomyReference,
} from './taxonomy';

describe('normalizeTaxonomySlug', () => {
  it('normalises case, spaces, underscores and punctuation', () => {
    expect(normalizeTaxonomySlug(' Field Notes ')).toBe('field-notes');
    expect(normalizeTaxonomySlug('field_notes')).toBe('field-notes');
    expect(normalizeTaxonomySlug('Field   Notes!!')).toBe('field-notes');
    expect(normalizeTaxonomySlug('Café-Notes')).toBe('caf-notes');
  });

  it('returns null when nothing usable remains or the input is not a string', () => {
    expect(normalizeTaxonomySlug('   ')).toBeNull();
    expect(normalizeTaxonomySlug('!!!')).toBeNull();
    expect(normalizeTaxonomySlug(42)).toBeNull();
    expect(normalizeTaxonomySlug('x'.repeat(121))).toBeNull();
  });
});

describe('toTaxonomyReference', () => {
  it('keeps the display label and derives the canonical slug', () => {
    expect(toTaxonomyReference('Field Notes')).toEqual({
      label: 'Field Notes',
      slug: 'field-notes',
    });
    expect(toTaxonomyReference('  spaced  ')).toEqual({ label: 'spaced', slug: 'spaced' });
  });

  it('rejects values that yield no slug', () => {
    expect(toTaxonomyReference('   ')).toBeNull();
    expect(toTaxonomyReference(null)).toBeNull();
  });
});

describe('dedupeTaxonomy', () => {
  it('dedupes by slug, keeping the first label seen', () => {
    expect(
      dedupeTaxonomy([
        { label: 'Field Notes', slug: 'field-notes' },
        { label: 'field notes', slug: 'field-notes' },
        { label: 'Archive', slug: 'archive' },
      ]),
    ).toEqual([
      { label: 'Field Notes', slug: 'field-notes' },
      { label: 'Archive', slug: 'archive' },
    ]);
  });
});

describe('taxonomyIncludesSlug', () => {
  it('matches labels by their normalised slug, not raw equality', () => {
    expect(taxonomyIncludesSlug(['Field Notes'], 'field-notes')).toBe(true);
    expect(taxonomyIncludesSlug(['Field Notes'], 'other')).toBe(false);
  });
});
