import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../../../app/providers/AuthProvider';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { Button } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import { richTextToPlainText } from '../../../domain/richTextMarkdown';
import type { RichTextDocument, RichTextNode } from '../../../domain/types';
import {
  AboutPublishError,
  createAboutPublishDeps,
  publishAboutPage,
  verifyAboutPublication,
  type AboutPublicationResult,
  type AboutPublishDeps,
  type AboutVerifyResult,
  type OwnerWriteContext,
} from '../../../services/aboutPublishService';
import { BlogEditor, type BlogEditorProps } from '../../blog/owner/BlogEditor';
import '../../blog/owner/blogOwner.css';

export interface AboutPublishModalProps {
  readonly initialDoc: RichTextNode;
  readonly onClose: () => void;
  /** Called once a write was acknowledged, so the page can re-read what is served. */
  readonly onPublished: () => void;
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: AboutPublishDeps;
  /** Test seam; production renders the real TipTap editor. */
  readonly renderEditor?: (props: BlogEditorProps) => ReactNode;
}

function defaultRenderEditor(props: BlogEditorProps): ReactNode {
  return <BlogEditor {...props} />;
}

const OUTCOME_LABEL: Record<AboutPublicationResult['status'], string> = {
  published: 'Published',
  'submitted-unconfirmed': 'Submitted — not yet confirmed',
  ambiguous: 'Submission result unknown',
  failed: 'Not published',
};

/**
 * Owner About-page editor modal.
 *
 * Reuses the canonical rich-text editor and the shared owner-write authority
 * guard. Exactly one DOCUMENT resource is written; the service performs the
 * fresh ownership proof immediately before the write, a bounded read-back
 * afterwards, and never retries an ambiguous write.
 */
export function AboutPublishModal({
  initialDoc,
  onClose,
  onPublished,
  deps = createAboutPublishDeps(),
  renderEditor = defaultRenderEditor,
}: AboutPublishModalProps) {
  const environment = useQortalEnvironment();
  const { capability } = useCapability();
  const { account } = useAuth();

  const ctx: OwnerWriteContext = useMemo(
    () => ({ capability, account, environment }),
    [capability, account, environment],
  );

  const [doc, setDoc] = useState<RichTextDocument>(() => ({
    format: 'tiptap-json-v1',
    doc: initialDoc,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<AboutPublicationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AboutVerifyResult | null>(null);

  const onPublish = useCallback(async () => {
    if (submitting) return;
    if (richTextToPlainText(doc).trim().length === 0) {
      setFormError('Write the About page text before publishing.');
      return;
    }
    setFormError(null);
    setVerifyResult(null);
    setSubmitting(true);
    try {
      const publication = await publishAboutPage(ctx, { body: doc }, deps);
      setResult(publication);
      if (publication.status === 'published' || publication.status === 'submitted-unconfirmed') {
        onPublished();
      }
    } catch (error) {
      setFormError(
        error instanceof AboutPublishError
          ? error.message
          : 'The About page could not be published.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [ctx, deps, doc, onPublished, submitting]);

  const onVerify = useCallback(async () => {
    if (!result) return;
    setVerifying(true);
    try {
      setVerifyResult(
        await verifyAboutPublication(result.publisherName, result.entityPayload, deps),
      );
    } finally {
      setVerifying(false);
    }
  }, [deps, result]);

  return (
    <Modal
      title="Edit About page"
      description="Replaces the singleton About-page resource under this app's publishing name. One resource is written; the host asks for approval first."
      onRequestClose={onClose}
      canClose={!submitting}
      wide
    >
      {!result ? (
        <form
          className="sa-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onPublish();
          }}
        >
          <div className="sa-field">
            <span className="sa-field__label">About text</span>
            {renderEditor({
              initialDoc,
              disabled: submitting,
              onChange: setDoc,
            })}
          </div>

          {formError ? (
            <p className="sa-field__error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="sa-route__actions">
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Publishing…' : 'Save About page'}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={`sa-outcome sa-outcome--${outcomeTone(result.status)}`}>
          <p className="sa-outcome__message">{OUTCOME_LABEL[result.status]}</p>
          <p>{result.message}</p>
          <p className="sa-detail__meta">Resource: DOCUMENT · {result.identifier}</p>

          {result.status === 'submitted-unconfirmed' || result.status === 'ambiguous' ? (
            <div className="sa-route__actions">
              <Button variant="secondary" onClick={() => void onVerify()} disabled={verifying}>
                {verifying ? 'Verifying…' : 'Verify served content'}
              </Button>
            </div>
          ) : null}

          {verifyResult ? <p role="status">{verifyResult.message}</p> : null}

          <div className="sa-route__actions">
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function outcomeTone(status: AboutPublicationResult['status']): 'ok' | 'warn' | 'error' {
  if (status === 'published') return 'ok';
  if (status === 'failed') return 'error';
  return 'warn';
}
