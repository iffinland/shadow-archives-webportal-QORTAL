import { useMemo, useRef, useState } from 'react';

import { Button } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { LIMITS } from '../../../domain/constants';
import {
  createGalleryPublishDeps,
  GalleryPublishError,
  publishGalleryAlbum,
  verifyGalleryPublication,
  type GalleryPublishDeps,
  type GalleryPublishProgress,
  type GalleryPublicationResult,
  type GalleryVerifyResult,
  type OwnerWriteContext,
} from '../../../services/galleryPublishService';
import { useArchive, useArchiveRefresh } from '../../content';
import { PublicationOutcome, PublishProgressList } from './publishFeedback';
import { TaxonomyInput } from '../../owner/TaxonomyInput';

const DEFAULT_LANGUAGE = 'en';

export interface GalleryAlbumModalProps {
  readonly onClose: () => void;
  readonly deps?: GalleryPublishDeps;
}

export function GalleryAlbumModal({
  onClose,
  deps = createGalleryPublishDeps(),
}: GalleryAlbumModalProps) {
  const environment = useQortalEnvironment();
  const { capability } = useCapability();
  const { account } = useAuth();
  const snapshot = useArchive();
  const refresh = useArchiveRefresh();

  const ctx: OwnerWriteContext = useMemo(
    () => ({ capability, account, environment }),
    [capability, account, environment],
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<GalleryPublishProgress | null>(null);
  const [result, setResult] = useState<GalleryPublicationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<GalleryVerifyResult | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const validateForm = (): string | null => {
    if (!title.trim()) return 'A title is required.';
    if (title.trim().length > LIMITS.title)
      return `The title must be at most ${LIMITS.title} characters.`;
    if (description.trim().length > LIMITS.description) {
      return `The description must be at most ${LIMITS.description} characters.`;
    }
    if (!language.trim()) return 'A language code is required.';
    return null;
  };

  const onPublish = async () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError(null);
    setVerifyResult(null);
    setSubmitting(true);
    try {
      const publication = await publishGalleryAlbum(
        ctx,
        {
          title,
          description,
          categories,
          tags,
          language,
          id: result?.id,
        },
        { onProgress: setProgress },
        deps,
      );
      setResult(publication);
      refresh();
    } catch (error) {
      setFormError(
        error instanceof GalleryPublishError ? error.message : 'The album could not be published.',
      );
    } finally {
      setProgress(null);
      setSubmitting(false);
    }
  };

  const onVerify = async () => {
    if (!result) return;
    setVerifying(true);
    try {
      setVerifyResult(
        await verifyGalleryPublication(
          {
            kind: 'gallery-album',
            id: result.id,
            publisherName: ctx.environment.publisherName ?? '',
            expectedEntityPayload: result.entityPayload,
          },
          deps,
        ),
      );
    } catch {
      setVerifyResult(null);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal
      title="Create gallery album"
      description="Albums group Gallery items. No separate image upload is required."
      onRequestClose={onClose}
      canClose={!submitting}
      initialFocusRef={firstFieldRef}
      footer={
        result ? null : (
          <div className="sa-modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void onPublish()} disabled={submitting}>
              {submitting ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <PublicationOutcome
          result={result}
          verifying={verifying}
          verifyResult={verifyResult}
          onVerify={() => void onVerify()}
          onRetry={() => {
            setResult(null);
            setVerifyResult(null);
            void onPublish();
          }}
          onClose={onClose}
        />
      ) : (
        <form
          className="sa-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onPublish();
          }}
        >
          <p className="sa-form__notice">
            Qortal will ask you to approve the publish and may charge the current arbitrary-data fee
            set by the host.
          </p>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-album-title">
              Title
            </label>
            <input
              ref={firstFieldRef}
              id="sa-album-title"
              className="sa-input"
              type="text"
              required
              maxLength={LIMITS.title}
              value={title}
              disabled={submitting}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-album-description">
              Description
            </label>
            <textarea
              id="sa-album-description"
              className="sa-input sa-input--textarea"
              rows={4}
              maxLength={LIMITS.description}
              value={description}
              disabled={submitting}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <TaxonomyInput
            label="Categories"
            values={categories}
            suggestions={snapshot.taxonomy.categories}
            onChange={setCategories}
          />
          <TaxonomyInput
            label="Tags"
            values={tags}
            suggestions={snapshot.taxonomy.tags}
            onChange={setTags}
          />

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-album-language">
              Language
            </label>
            <input
              id="sa-album-language"
              className="sa-input"
              type="text"
              maxLength={LIMITS.language}
              value={language}
              disabled={submitting}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>

          {progress ? <PublishProgressList progress={progress} variant="album" /> : null}

          {formError ? (
            <p className="sa-field__error" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
