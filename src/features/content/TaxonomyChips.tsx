import { Link } from 'react-router-dom';

import { routes } from '../../app/config/navigation';
import { toTaxonomyReference } from '../../domain';

interface TaxonomyChipsProps {
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly heading?: string;
}

/** Canonical app taxonomy links. Values come from entity/catalog payloads (D2). */
export function TaxonomyChips({ categories = [], tags = [], heading }: TaxonomyChipsProps) {
  const categoryRefs = categories
    .map(toTaxonomyReference)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const tagRefs = tags
    .map(toTaxonomyReference)
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (categoryRefs.length === 0 && tagRefs.length === 0) return null;

  return (
    <div className="sa-taxonomy" aria-label={heading ?? 'Categories and tags'}>
      {categoryRefs.map((reference) => (
        <Link
          key={`c-${reference.slug}`}
          className="sa-taxonomy__chip"
          to={routes.category(reference.slug)}
        >
          {reference.label}
        </Link>
      ))}
      {tagRefs.map((reference) => (
        <Link
          key={`t-${reference.slug}`}
          className="sa-taxonomy__chip sa-taxonomy__chip--tag"
          to={routes.tag(reference.slug)}
        >
          #{reference.label}
        </Link>
      ))}
    </div>
  );
}
