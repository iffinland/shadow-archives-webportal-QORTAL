import { Navigate, useParams } from 'react-router-dom';

import { routes } from '../../app/config/navigation';

/**
 * Legacy generic gallery route (Phase 1B shipped `/gallery/:id`). The approved
 * architecture defines separate album/item routes, so this alias resolves to the
 * item route for backwards compatibility.
 */
export default function GalleryDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to={routes.gallery} replace />;
  return <Navigate to={routes.galleryItem(id)} replace />;
}
