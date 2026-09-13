import { useState } from 'react';

import { Button } from '../../../components/common';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import type { GalleryPublishDeps } from '../../../services/galleryPublishService';
import { GalleryAlbumModal } from './GalleryAlbumModal';
import { GalleryImageModal } from './GalleryImageModal';
import '../../owner/owner.css';

/**
 * Owner-only Gallery controls.
 *
 * This module is the lazy boundary for the whole Gallery write path: it is
 * dynamically imported only when the capability is a positively verified owner,
 * so the image pipeline, publish service and modals never enter the visitor
 * startup graph. It returns `null` for every other capability instead of
 * rendering disabled controls, so the visitor DOM contains no owner affordance.
 */
export interface GalleryOwnerPanelProps {
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: GalleryPublishDeps;
}

export default function GalleryOwnerPanel({ deps }: GalleryOwnerPanelProps) {
  const { isOwner } = useCapability();
  const environment = useQortalEnvironment();
  const [openModal, setOpenModal] = useState<'image' | 'album' | null>(null);

  if (!isOwner) return null;

  const close = () => setOpenModal(null);

  return (
    <section className="sa-owner-panel" aria-label="Owner gallery controls">
      <div className="sa-owner-panel__header">
        <h2 className="sa-owner-panel__title">Owner controls</h2>
        <p className="sa-owner-panel__note">
          Publishing under <strong>{environment.publisherName ?? 'the publishing name'}</strong>.
          Qortal asks for approval before each publish step and may charge the current
          arbitrary-data fee.
        </p>
      </div>
      <div className="sa-owner-panel__actions">
        <Button variant="primary" onClick={() => setOpenModal('image')}>
          Add image
        </Button>
        <Button variant="secondary" onClick={() => setOpenModal('album')}>
          Create album
        </Button>
      </div>

      {openModal === 'image' ? <GalleryImageModal onClose={close} deps={deps} /> : null}
      {openModal === 'album' ? <GalleryAlbumModal onClose={close} deps={deps} /> : null}
    </section>
  );
}
