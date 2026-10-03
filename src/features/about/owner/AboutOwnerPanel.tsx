import { useState } from 'react';

import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { Button } from '../../../components/common';
import type { RichTextNode } from '../../../domain/types';
import type { AboutPublishDeps } from '../../../services/aboutPublishService';
import type { BlogEditorProps } from '../../blog/owner/BlogEditor';
import { AboutPublishModal } from './AboutPublishModal';
import '../../owner/owner.css';

/**
 * Owner-only About-page controls.
 *
 * This module is the lazy boundary for the About write path: it is dynamically
 * imported only when the capability is a positively verified owner, so the
 * reused TipTap editor and the publish service never enter the visitor startup
 * graph. It returns `null` for every other capability instead of rendering a
 * disabled control.
 */
export interface AboutOwnerPanelProps {
  /** The document currently rendered (stored resource, or the built-in default). */
  readonly initialDoc: RichTextNode;
  /** Called after an acknowledged write so the page can re-read what is served. */
  readonly onPublished: () => void;
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: AboutPublishDeps;
  /** Test seam; production renders the real TipTap editor. */
  readonly renderEditor?: (props: BlogEditorProps) => React.ReactNode;
}

export default function AboutOwnerPanel({
  initialDoc,
  onPublished,
  deps,
  renderEditor,
}: AboutOwnerPanelProps) {
  const { isOwner } = useCapability();
  const environment = useQortalEnvironment();
  const [open, setOpen] = useState(false);

  if (!isOwner) return null;

  return (
    <section className="sa-owner-panel" aria-label="Owner About-page controls">
      <div className="sa-owner-panel__header">
        <h2 className="sa-owner-panel__title">Owner controls</h2>
        <p className="sa-owner-panel__note">
          Edit the text visitors read on this page. It is stored as the canonical rich-text document
          under <strong>{environment.publisherName ?? 'the publishing name'}</strong>, and Qortal
          asks for approval before the write.
        </p>
      </div>
      <div className="sa-owner-panel__actions">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Edit About page
        </Button>
      </div>

      {open ? (
        <AboutPublishModal
          initialDoc={initialDoc}
          onClose={() => setOpen(false)}
          onPublished={onPublished}
          deps={deps}
          renderEditor={renderEditor}
        />
      ) : null}
    </section>
  );
}
