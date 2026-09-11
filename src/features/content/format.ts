import { buildQdnResourcePath } from '../../qortal';
import type { EntityKind, QdnMediaReference } from '../../domain';

export function formatDate(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

/** Same-origin media path for a validated QDN media reference. */
export function mediaRefSrc(reference: QdnMediaReference): string {
  return buildQdnResourcePath({
    service: reference.service,
    name: reference.name,
    identifier: reference.identifier,
    path: reference.path ?? null,
  });
}

/** True for services safe to render with an `<img>` element. */
export function isImageService(service: string): boolean {
  return service === 'IMAGE' || service === 'THUMBNAIL';
}

export function typeKindLabel(kind: EntityKind): string {
  switch (kind) {
    case 'blog-post':
      return 'Blog post';
    case 'video':
      return 'Video';
    case 'gallery-item':
      return 'Gallery item';
    case 'gallery-album':
      return 'Gallery album';
  }
}
