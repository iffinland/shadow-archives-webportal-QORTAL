import { useParams } from 'react-router-dom';

import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <RoutePlaceholder
      title="Category"
      lead="Cross-type results for one archive category."
      note="The hybrid taxonomy is decided, but indexing and result discovery are later phases."
      details={[{ label: 'Requested category', value: slug ?? '(none)' }]}
    />
  );
}
