import { useState } from 'react';

import { Button } from '../../../components/common';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import type { VideoPublishDeps } from '../../../services/videoPublishService';
import { VideoPublishModal, type VideoProbe } from './VideoPublishModal';
import '../../owner/owner.css';

/**
 * Owner-only Video controls.
 *
 * This module is the lazy boundary for the whole Video write path: it is
 * dynamically imported only when the capability is a positively verified owner,
 * so the poster pipeline, the publish service, the Q-Tube adapter and the modal
 * never enter the visitor startup graph. It returns `null` for every other
 * capability instead of rendering disabled controls, so the visitor DOM contains
 * no owner affordance.
 */
export interface VideoOwnerPanelProps {
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: VideoPublishDeps;
  /** Test seam; production uses the bounded browser duration probe. */
  readonly probe?: VideoProbe;
}

export default function VideoOwnerPanel({ deps, probe }: VideoOwnerPanelProps) {
  const { isOwner } = useCapability();
  const environment = useQortalEnvironment();
  const [openModal, setOpenModal] = useState(false);

  if (!isOwner) return null;

  return (
    <section className="sa-owner-panel" aria-label="Owner video controls">
      <div className="sa-owner-panel__header">
        <h2 className="sa-owner-panel__title">Owner controls</h2>
        <p className="sa-owner-panel__note">
          Publishing under <strong>{environment.publisherName ?? 'the publishing name'}</strong>.
          One workflow publishes the video, its poster, the Shadow Archives metadata and a
          Q-Tube-compatible listing resource. Qortal asks for approval before each publish step and
          may charge the current arbitrary-data fee.
        </p>
      </div>
      <div className="sa-owner-panel__actions">
        <Button variant="primary" onClick={() => setOpenModal(true)}>
          Add video
        </Button>
      </div>

      {openModal ? (
        <VideoPublishModal onClose={() => setOpenModal(false)} deps={deps} probe={probe} />
      ) : null}
    </section>
  );
}
