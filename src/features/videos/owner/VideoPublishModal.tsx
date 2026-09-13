import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { LIMITS } from '../../../domain/constants';
import { formatByteSize } from '../../../domain/galleryMedia';
import {
  checkVideoSourceSize,
  checkVideoSourceType,
  formatDurationLabel,
  VIDEO_MEDIA_POLICY,
} from '../../../domain/videoMedia';
import {
  assertUsableImageSource,
  ImageProcessingError,
  type PosterImageResult,
} from '../../../services/imageProcessing';
import {
  probeVideoFile,
  VideoProbeError,
  type VideoProbeResult,
} from '../../../services/videoMetadataProbe';
import {
  createVideoPublishDeps,
  publishVideo,
  verifyVideoPublication,
  VideoPublishError,
  type OwnerWriteContext,
  type VideoPublishDeps,
  type VideoPublishProgress,
  type VideoPublicationResult,
  type VideoVerifyResult,
} from '../../../services/videoPublishService';
import { useArchive, useArchiveRefresh } from '../../content';
import { TaxonomyInput } from '../../owner/TaxonomyInput';
import { VideoPublicationOutcome, VideoPublishProgressList } from './videoPublishFeedback';

const DEFAULT_LANGUAGE = 'en';

/** Video containers the browser and the ecosystem both handle. */
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/ogg,video/quicktime';

/** Poster/thumbnail input accepts exactly what the image pipeline can decode. */
const POSTER_ACCEPT = 'image/jpeg,image/png,image/webp';

/** Injectable duration probe (tests inject a deterministic one). */
export type VideoProbe = (file: File) => Promise<VideoProbeResult>;

export interface VideoPublishModalProps {
  readonly onClose: () => void;
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: VideoPublishDeps;
  /** Test seam; production uses the bounded browser `<video>` probe. */
  readonly probe?: VideoProbe;
}

/**
 * Owner video publish modal — the single Shadow Archives video workflow.
 *
 * It writes, in three truthful stages: (1) the media + poster, (2) the canonical
 * Shadow Archives entity plus the Q-Tube-compatible metadata artifact, and (3) the
 * derived Videos index. The exact QDN identities are always shown, a partial or
 * timed-out result is never reported as success, and the stable video id is
 * retained across retries so a retry cannot mint a duplicate.
 */
export function VideoPublishModal({
  onClose,
  deps = createVideoPublishDeps(),
  probe = probeVideoFile,
}: VideoPublishModalProps) {
  const environment = useQortalEnvironment();
  const { capability } = useCapability();
  const { account } = useAuth();
  const snapshot = useArchive();
  const refresh = useArchiveRefresh();

  const ctx: OwnerWriteContext = useMemo(
    () => ({ capability, account, environment }),
    [capability, account, environment],
  );

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [durationInput, setDurationInput] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeNote, setProbeNote] = useState<string | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreviewUrl, setPosterPreviewUrl] = useState<string | null>(null);
  const [posterError, setPosterError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<VideoPublishProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prepared, setPrepared] = useState<PosterImageResult | null>(null);
  const [result, setResult] = useState<VideoPublicationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VideoVerifyResult | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  /**
   * Retained across attempts so resubmitting reuses the same QDN coordinates.
   * Only ever set from a returned publication (the service generates the id).
   */
  const draftIdRef = useRef<string | null>(null);
  /** Guards against a slow probe overwriting a newer file selection. */
  const probeSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl);
    };
  }, [posterPreviewUrl]);

  const onSelectVideo = useCallback(
    (selected: File | null) => {
      setVideoError(null);
      setProbeNote(null);
      setDurationInput('');
      setVideoFile(selected);
      setVideoPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return selected ? URL.createObjectURL(selected) : null;
      });
      if (!selected) return;

      const sizeCheck = checkVideoSourceSize(selected.size, selected.name);
      if (!sizeCheck.ok) {
        setVideoError(sizeCheck.message ?? 'The selected file is not usable.');
        return;
      }
      const typeCheck = checkVideoSourceType(selected.type);
      if (!typeCheck.ok) {
        setVideoError(typeCheck.message ?? 'The selected file type is not supported.');
        return;
      }

      // The probe is a convenience, never a gate: it fills the duration when the
      // browser can read it, and otherwise the owner types it in. It is bounded
      // and never blocks the form.
      const sequence = probeSeqRef.current + 1;
      probeSeqRef.current = sequence;
      setProbing(true);
      void probe(selected)
        .then((info) => {
          if (probeSeqRef.current !== sequence) return;
          setProbing(false);
          setDurationInput(String(Math.max(1, Math.round(info.durationSeconds))));
          setProbeNote(
            `Read from the file: ${formatDurationLabel(info.durationSeconds)}${
              info.width > 0 && info.height > 0 ? ` · ${info.width}×${info.height} px` : ''
            }.`,
          );
        })
        .catch((error: unknown) => {
          if (probeSeqRef.current !== sequence) return;
          setProbing(false);
          setProbeNote(
            error instanceof VideoProbeError
              ? `${error.message} Enter the duration manually.`
              : 'The duration could not be read automatically. Enter it manually.',
          );
        });
    },
    [probe],
  );

  const onSelectPoster = useCallback(async (selected: File | null) => {
    setPosterError(null);
    setPrepared(null);
    setPosterFile(selected);
    setPosterPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return selected ? URL.createObjectURL(selected) : null;
    });
    if (!selected) return;
    try {
      await assertUsableImageSource(selected);
    } catch (error) {
      setPosterError(
        error instanceof ImageProcessingError
          ? error.message
          : 'The selected poster could not be checked.',
      );
    }
  }, []);

  const validateForm = (): string | null => {
    if (!videoFile) return 'Choose a video file.';
    if (videoError) return videoError;
    if (!posterFile) return 'Choose a poster image.';
    if (posterError) return posterError;
    if (!title.trim()) return 'A title is required.';
    if (title.trim().length > LIMITS.title) {
      return `The title must be at most ${LIMITS.title} characters.`;
    }
    if (description.trim().length > LIMITS.description) {
      return `The description must be at most ${LIMITS.description} characters.`;
    }
    if (!language.trim()) return 'A language code is required.';
    const duration = Number(durationInput);
    if (!Number.isFinite(duration) || duration <= 0) {
      return 'Enter the video duration in seconds (a positive number).';
    }
    return null;
  };

  const onPublish = async () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    if (!videoFile || !posterFile) return;
    setFormError(null);
    setVerifyResult(null);
    setSubmitting(true);

    try {
      const publication = await publishVideo(
        ctx,
        {
          video: videoFile,
          poster: posterFile,
          title,
          description,
          categories,
          tags,
          language,
          durationSeconds: Number(durationInput),
          // Reuse the identity of a previous attempt so a retry cannot duplicate.
          id: draftIdRef.current ?? undefined,
        },
        {
          onProgress: setProgress,
          onPosterPrepared: setPrepared,
        },
        deps,
      );
      draftIdRef.current = publication.id;
      setResult(publication);
      refresh();
    } catch (error) {
      setFormError(
        error instanceof VideoPublishError ? error.message : 'The video could not be published.',
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
      const verification = await verifyVideoPublication(
        {
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
      title="Add video"
      description="Publishes the video, its poster, the Shadow Archives metadata and a Q-Tube-compatible listing resource under this app's publishing name."
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
        <VideoPublicationOutcome
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
            <label className="sa-field__label" htmlFor="sa-video-file">
              Video file (MP4, WebM, Ogg or QuickTime)
            </label>
            <p className="sa-field__hint">
              The host accepts uploads up to {formatByteSize(VIDEO_MEDIA_POLICY.maxSourceBytes)}.
              The video bytes are sent to the host once and are never copied into QDN twice.
            </p>
            <input
              id="sa-video-file"
              className="sa-input"
              type="file"
              accept={VIDEO_ACCEPT}
              disabled={critical}
              onChange={(event) => onSelectVideo(event.target.files?.[0] ?? null)}
            />
            {videoError ? (
              <p className="sa-field__error" role="alert">
                {videoError}
              </p>
            ) : null}
            {videoFile && videoPreviewUrl ? (
              <div className="sa-preview">
                <video
                  className="sa-preview__video"
                  src={videoPreviewUrl}
                  controls
                  preload="metadata"
                  playsInline
                />
                <p className="sa-field__hint">
                  {videoFile.name} · {videoFile.type || 'type not declared'} ·{' '}
                  {formatByteSize(videoFile.size)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-video-duration">
              Duration (seconds)
            </label>
            <input
              id="sa-video-duration"
              className="sa-input"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={durationInput}
              disabled={critical}
              onChange={(event) => setDurationInput(event.target.value)}
            />
            <p className="sa-field__hint">
              {probing
                ? 'Reading the duration from the selected file…'
                : (probeNote ??
                  'Read from the selected file when the browser can; otherwise type the duration in seconds. It is stored in the video metadata.')}
            </p>
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-video-poster">
              Poster image (JPEG, PNG or WebP)
            </label>
            <p className="sa-field__hint">
              Required. Published as the QDN thumbnail and embedded in the Q-Tube-compatible
              metadata, so Q-Tube shows a real preview frame.
            </p>
            <input
              id="sa-video-poster"
              className="sa-input"
              type="file"
              accept={POSTER_ACCEPT}
              disabled={critical}
              onChange={(event) => void onSelectPoster(event.target.files?.[0] ?? null)}
            />
            {posterError ? (
              <p className="sa-field__error" role="alert">
                {posterError}
              </p>
            ) : null}
            {posterFile && posterPreviewUrl ? (
              <div className="sa-preview">
                <img
                  className="sa-preview__image"
                  src={posterPreviewUrl}
                  alt="Selected poster preview"
                />
                <p className="sa-field__hint">
                  {posterFile.name} · {formatByteSize(posterFile.size)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-video-title">
              Title
            </label>
            <input
              ref={firstFieldRef}
              id="sa-video-title"
              className="sa-input"
              type="text"
              required
              maxLength={LIMITS.title}
              value={title}
              disabled={critical}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="sa-field__hint">
              The full title is stored in Shadow Archives; the shared Qortal/Q-Tube metadata mirrors
              its first 50 characters.
            </p>
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-video-description">
              Description
            </label>
            <textarea
              id="sa-video-description"
              className="sa-input sa-input--textarea"
              rows={4}
              maxLength={LIMITS.description}
              value={description}
              disabled={critical}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <TaxonomyInput
            label="Categories"
            values={categories}
            suggestions={snapshot.taxonomy.categories}
            onChange={setCategories}
            hint="The first category that matches a Q-Tube category is mirrored into the Q-Tube discovery metadata."
          />
          <TaxonomyInput
            label="Tags"
            values={tags}
            suggestions={snapshot.taxonomy.tags}
            onChange={setTags}
            hint="Up to five short tags are mirrored into Qortal metadata for ecosystem discovery."
          />

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-video-language">
              Language
            </label>
            <input
              id="sa-video-language"
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
                Poster {prepared.width}×{prepared.height} px · {formatByteSize(prepared.bytes)} (
                {prepared.mimeType}) from {prepared.source.width}×{prepared.source.height} px ·{' '}
                {formatByteSize(prepared.source.bytes)}
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

          {progress ? <VideoPublishProgressList progress={progress} /> : null}

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
