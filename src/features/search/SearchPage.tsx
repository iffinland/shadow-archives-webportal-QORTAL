import { useSearchParams } from 'react-router-dom';

import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const type = params.get('type') ?? 'all';

  return (
    <RoutePlaceholder
      title="Search"
      lead="Deep search across archived posts, videos and gallery items."
      note="The approved design compiles a local search index from the QDN catalog rather than issuing a request per keystroke. Neither the catalog nor the index is implemented in this phase, so the shell interaction (expand, submit, URL state) works but no results are produced and no QDN request is made."
      details={[
        { label: 'Query', value: query || '(empty)' },
        { label: 'Content type filter', value: type },
      ]}
    />
  );
}
