import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { LIMITS } from '../../../domain/constants';
import { formatByteSize } from '../../../domain/galleryMedia';
import {
  assertUsableImageSource,
  ImageProcessingError,
  type GalleryImageProcessingResult,
} from '../../../services/imageProcessing';
import {
  createGalleryPublishDeps,
  GalleryPublishError,
  publishGalleryImage,
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

export interface GalleryImageModalProps {
  readonly onClose: () => void;
  readonly deps?: GalleryPublishDeps;
}

export function GalleryImageModal({
  onClose,
  deps = createGalleryPublishDeps(),
}: GalleryImageModalProps) {
  const environment = useQortalEnvironment();
  const { capability } = useCapability();
  const { account } = useAuth();
  const snapshot = useArchive();
  const refresh = useArchiveRefresh();

  const ctx: OwnerWriteContext = useMemo(
    () => ({ capability, account, environment }),
    [capability, account, environment],
  );

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [albumId, setAlbumId] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<GalleryPublishProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prepared, setPrepared] = useState<GalleryImageProcessingResult | null>(null);
  const [result, setResult] = useState<GalleryPublicationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<GalleryVerifyResult | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const albumOptions = useMemo(
    () =>
      snapshot.listings
        .filter((listing) => listing.type === 'gallery-album' && listing.state === 'active')
        .map((listing) => ({ id: listing.id, title: listing.title || 'Untitled album' })),
    [snapshot.listings],
  );

  const onSelectFile = useCallback(async (selected: File | null) => {
    setFileError(null);
    setPreviewSize(null);
    setFile(selected);
    setPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return selected ? URL.createObjectURL(selected) : null;
    });
    if (!selected) return;
    try {
      await assertUsableImageSource(selected);
    } catch (error) {
      setFileError(
        error instanceof ImageProcessingError
          ? error.message
          : 'The selected file could not be checked.',
      );
    }
  }, []);

  const validateForm = (): string | null => {
    if (!file) return 'Choose an image file.';
    if (fileError) return fileError;
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
    if (!file) return;
    setFormError(null);
    setVerifyResult(null);
    setSubmitting(true);

    try {
      const publication = await publishGalleryImage(
        ctx,
        {
          file,
          title,
          description,
          albumId: albumId || null,
          categories,
          tags,
          language,
          // Reuse the identity of a previous attempt so a retry cannot duplicate.
          id: result?.id,
        },
        {
          onProgress: setProgress,
          onPrepared: setPrepared,
        },
        deps,
      );
      setResult(publication);
      refresh();
    } catch (error) {
      setFormError(
        error instanceof GalleryPublishError
          ? error.message
          : 'The Gallery item could not be published.',
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
      const verification = await verifyGalleryPublication(
        {
          kind: 'gallery-item',
          id: result.id,
          publisherName: ctx.environment.publisherName ?? '',
          expectedEntityPayload: result.entityPayload,
        },
        deps,
      );
      setVerifyResult(verification);
    } catch {
      setVerifyResult(null);
    } finally {
      setVerifying(false);
    }
  };

  const retry = () => {
    setResult(null);
    setVerifyResult(null);
    void onPublish();
  };

  const critical = submitting;

  return (
    <Modal
      title="Add gallery image"
      description="Publishes the image, its thumbnail and the Gallery metadata under this app's publishing name."
      onRequestClose={onClose}
      canClose={!critical}
      initialFocusRef={firstFieldRef}
      wide
      footer={
        result ? null : (
          <div className="sa-modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={critical}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void onPublish()} disabled={critical}>
              {critical ? 'Publishing…' : 'Publish'}
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
          onRetry={retry}
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
            Qortal will ask you to approve each publish step and may charge the current
            arbitrary-data fee. The fee is set by the host and is never hardcoded here.
          </p>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-image-file">
              Image file (JPEG, PNG or WebP)
            </label>
            <input
              id="sa-image-file"
              className="sa-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={critical}
              onChange={(event) => void onSelectFile(event.target.files?.[0] ?? null)}
            />
            {fileError ? (
              <p className="sa-field__error" role="alert">
                {fileError}
              </p>
            ) : null}
            {file && previewUrl ? (
              <div className="sa-preview">
                <img
                  className="sa-preview__image"
                  src={previewUrl}
                  alt="Selected image preview"
                  onLoad={(event) =>
                    setPreviewSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
                <p className="sa-field__hint">
                  {file.name} · {file.type || 'type not declared'} · {formatByteSize(file.size)}
                  {previewSize
                    ? ` · ${previewSize.width}×${previewSize.height} px`
                    : ' · reading dimensions…'}
                </p>
              </div>
            ) : null}
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-image-title">
              Title
            </label>
            <input
              ref={firstFieldRef}
              id="sa-image-title"
              className="sa-input"
              type="text"
              required
              maxLength={LIMITS.title}
              value={title}
              disabled={critical}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-image-description">
              Description
            </label>
            <textarea
              id="sa-image-description"
              className="sa-input sa-input--textarea"
              rows={4}
              maxLength={LIMITS.description}
              value={description}
              disabled={critical}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-image-album">
              Album (optional)
            </label>
            <select
              id="sa-image-album"
              className="sa-input"
              value={albumId}
              disabled={critical}
              onChange={(event) => setAlbumId(event.target.value)}
            >
              <option value="">No album</option>
              {albumOptions.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.title}
                </option>
              ))}
            </select>
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
            hint="Up to five short tags are mirrored into Qortal metadata for ecosystem discovery."
          />

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-image-language">
              Language
            </label>
            <input
              id="sa-image-language"
              className="sa-input"
              type="text"
              maxLength={LIMITS.language}
              value={language}
              disabled={critical}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>

          {prepared ? (
            <div className="sa-prepared">
              <p className="sa-prepared__title">Prepared for upload</p>
              <p className="sa-field__hint">
                Original {prepared.source.width}×{prepared.source.height} px ·{' '}
                {formatByteSize(prepared.source.bytes)} ({prepared.source.mimeType})
              </p>
              <p className="sa-field__hint">
                Image {prepared.full.width}×{prepared.full.height} px ·{' '}
                {formatByteSize(prepared.full.bytes)} ({prepared.full.mimeType}) · thumbnail{' '}
                {prepared.thumbnail.width}×{prepared.thumbnail.height} px ·{' '}
                {formatByteSize(prepared.thumbnail.bytes)}
              </p>
              {prepared.notices.map((notice) => (
                <p className="sa-field__hint" key={notice}>
                  {notice}
                </p>
              ))}
              {prepared.warnings.map((warning) => (
                <p className="sa-field__error" key={warning} role="alert">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {progress ? <PublishProgressList progress={progress} variant="image" /> : null}

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
