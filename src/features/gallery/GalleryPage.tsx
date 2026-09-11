import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function GalleryPage() {
  return (
    <RoutePlaceholder
      title="Gallery"
      lead="Archive media, browsed as thumbnails first and loaded at full size only on demand."
      note="Album and item discovery is not implemented in this phase. Listings will never download gallery originals for thumbnail regions."
    />
  );
}
