import { useParams } from 'react-router-dom';

import { IconImage } from '../../components/common';
import { ListingGrid, useArchive, useListingState } from '../content';
import { normalizeTaxonomySlug } from '../../domain';

/** Cross-type results for one canonical app category (owner decision D2). */
export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const normalized = normalizeTaxonomySlug(slug ?? '') ?? '';
  const { taxonomy } = useArchive();
  const label = taxonomy.categories.find((entry) => entry.slug === normalized)?.label ?? slug ?? '';
  const state = useListingState({ category: normalized });

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Category</h1>
        <p className="sa-detail__meta">{label || slug || '(none)'}</p>
        <p className="sa-route__lead">
          Cross-type results filtered locally from validated catalog metadata; no per-result network
          request is made.
        </p>
      </header>

      <ListingGrid
        state={state}
        emptyTitle="No content in this category"
        emptyDescription="No published content in the verified scope uses this category."
        emptyIcon={<IconImage width={26} height={26} />}
      />
    </div>
  );
}
