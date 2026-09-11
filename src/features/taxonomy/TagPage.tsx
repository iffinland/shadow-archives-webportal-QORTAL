import { useParams } from 'react-router-dom';

import { IconImage } from '../../components/common';
import { ListingGrid, useArchive, useListingState } from '../content';
import { normalizeTaxonomySlug } from '../../domain';

/** Cross-type results for one canonical app tag (owner decision D2). */
export default function TagPage() {
  const { slug } = useParams<{ slug: string }>();
  const normalized = normalizeTaxonomySlug(slug ?? '') ?? '';
  const { taxonomy } = useArchive();
  const label = taxonomy.tags.find((entry) => entry.slug === normalized)?.label ?? slug ?? '';
  const state = useListingState({ tag: normalized });

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Tag</h1>
        <p className="sa-detail__meta">{label || slug || '(none)'}</p>
        <p className="sa-route__lead">
          Cross-type results filtered locally from validated catalog metadata; no per-result network
          request is made.
        </p>
      </header>

      <ListingGrid
        state={state}
        emptyTitle="No content with this tag"
        emptyDescription="No published content in the verified scope uses this tag."
        emptyIcon={<IconImage width={26} height={26} />}
      />
    </div>
  );
}
