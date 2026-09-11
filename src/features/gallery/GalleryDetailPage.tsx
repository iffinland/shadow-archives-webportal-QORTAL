import { useParams } from 'react-router-dom';

import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function GalleryDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <RoutePlaceholder
      title="Gallery item"
      lead="A single archive item or album."
      note="Item resolution and the full-size media view arrive with the gallery phase; nothing is fetched here."
      details={[{ label: 'Requested reference', value: id ?? '(none)' }]}
    />
  );
}
