import { useParams } from 'react-router-dom';

import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function BlogPostPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <RoutePlaceholder
      title="Blog post"
      lead="A single archived post, resolved from its stable reference."
      note="The identifier scheme is already decided (saw_post_<id>), but fetching the resource is not implemented in this phase, so no content is shown."
      details={[{ label: 'Requested reference', value: id ?? '(none)' }]}
    />
  );
}
