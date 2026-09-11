import type { TaxonomyReference } from './types';

const SLUG_MAX_LENGTH = 120;

/**
 * Normalise a taxonomy value to its canonical slug (contract §5.8):
 * lowercase(trim) with spaces/underscores to `-`, other characters removed,
 * collapsed dashes. Returns null when nothing usable remains.
 */
export function normalizeTaxonomySlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length === 0 || slug.length > SLUG_MAX_LENGTH) return null;
  return slug;
}

/** Build a labelled taxonomy reference; returns null when the slug is empty. */
export function toTaxonomyReference(label: unknown): TaxonomyReference | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > SLUG_MAX_LENGTH) return null;
  const slug = normalizeTaxonomySlug(trimmed);
  if (slug === null) return null;
  return { label: trimmed, slug };
}

/** Deduplicate taxonomy references by slug, preserving first-seen order. */
export function dedupeTaxonomy(references: readonly TaxonomyReference[]): TaxonomyReference[] {
  const seen = new Set<string>();
  const result: TaxonomyReference[] = [];
  for (const reference of references) {
    if (seen.has(reference.slug)) continue;
    seen.add(reference.slug);
    result.push(reference);
  }
  return result;
}

export function taxonomyIncludesSlug(labels: readonly string[], slug: string): boolean {
  return labels.some((label) => normalizeTaxonomySlug(label) === slug);
}
