import { useParams } from 'react-router-dom';

import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function TagPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <RoutePlaceholder
      title="Tag"
      lead="Cross-type results for one archive tag."
      note="The hybrid taxonomy is decided, but indexing and result discovery are later phases."
      details={[{ label: 'Requested tag', value: slug ?? '(none)' }]}
    />
  );
}
