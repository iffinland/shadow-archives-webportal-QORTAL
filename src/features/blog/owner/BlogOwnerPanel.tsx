import { useState } from 'react';

import { Button } from '../../../components/common';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import type { BlogPublishDeps } from '../../../services/blogPublishService';
import type { BlogEditorProps } from './BlogEditor';
import { BlogPublishModal } from './BlogPublishModal';
import '../../owner/owner.css';
import './blogOwner.css';

/**
 * Owner-only Blog controls.
 *
 * This module is the lazy boundary for the whole Blog write path: it is
 * dynamically imported only when the capability is a positively verified owner,
 * so the TipTap editor, the cover pipeline, the publish service, the SubWire
 * adapter and the Quitter adapter never enter the visitor startup graph. It
 * returns `null` for every other capability instead of rendering disabled
 * controls, so the visitor DOM contains no owner affordance.
 */
export interface BlogOwnerPanelProps {
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: BlogPublishDeps;
  /** Test seam; production renders the real TipTap editor. */
  readonly renderEditor?: (props: BlogEditorProps) => React.ReactNode;
}

export default function BlogOwnerPanel({ deps, renderEditor }: BlogOwnerPanelProps) {
  const { isOwner } = useCapability();
  const environment = useQortalEnvironment();
  const [openModal, setOpenModal] = useState(false);

  if (!isOwner) return null;

  return (
    <section className="sa-owner-panel" aria-label="Owner blog controls">
      <div className="sa-owner-panel__header">
        <h2 className="sa-owner-panel__title">Owner controls</h2>
        <p className="sa-owner-panel__note">
          Publishing under <strong>{environment.publisherName ?? 'the publishing name'}</strong>.
          One workflow publishes the article, its cover, the Shadow Archives metadata and a
          SubWire-compatible article resource, then updates the Blog index. Qortal asks for approval
          before each publish step and may charge the current arbitrary-data fee.
        </p>
      </div>
      <div className="sa-owner-panel__actions">
        <Button variant="primary" onClick={() => setOpenModal(true)}>
          Write a post
        </Button>
      </div>

      {openModal ? (
        <BlogPublishModal
          onClose={() => setOpenModal(false)}
          deps={deps}
          renderEditor={renderEditor}
        />
      ) : null}
    </section>
  );
}
