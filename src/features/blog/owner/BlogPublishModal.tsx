import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { BLOG_COVER_ACCEPT, BLOG_COVER_SOURCE_MIME_TYPES } from '../../../domain/blogMedia';
import { LIMITS } from '../../../domain/constants';
import { formatByteSize } from '../../../domain/galleryMedia';
import { richTextToMarkdown } from '../../../domain/richTextMarkdown';
import type { RichTextDocument } from '../../../domain/types';
import {
  assertUsableImageSource,
  ImageProcessingError,
  type PosterImageResult,
} from '../../../services/imageProcessing';
import {
  announceOnQuitter,
  BlogPublishError,
  createBlogPublishDeps,
  publishBlogPost,
  verifyBlogPublication,
  type BlogPublicationResult,
  type BlogPublishDeps,
  type BlogPublishProgress,
  type BlogVerifyResult,
  type OwnerWriteContext,
  type QuitterAnnouncementResult,
} from '../../../services/blogPublishService';
import { useArchive, useArchiveRefresh } from '../../content';
import { TaxonomyInput } from '../../owner/TaxonomyInput';
import { BlogEditor, type BlogEditorProps } from './BlogEditor';
import {
  BlogPublicationOutcome,
  BlogPublishProgressList,
  QuitterAnnouncementStep,
} from './blogPublishFeedback';

const DEFAULT_LANGUAGE = 'en';

export interface BlogPublishModalProps {
  readonly onClose: () => void;
  /** Test seam; production uses the real bridge-backed dependencies. */
  readonly deps?: BlogPublishDeps;
  /** Test seam; production renders the lazy TipTap editor. */
  readonly renderEditor?: (props: BlogEditorProps) => ReactNode;
}

function defaultRenderEditor(props: BlogEditorProps): ReactNode {
  return <BlogEditor {...props} />;
}

/**
 * Owner blog publish modal — the single Shadow Archives article workflow.
 *
 * Writes, in three truthful stages: (1) the cover, (2) the canonical Shadow
 * Archives entity plus the derived SubWire-compatible article, and (3) the derived
 * Blog index. The exact QDN identities are always shown, and an index-only or
 * ambiguous result is never reported as a full failure.
 *
 * The optional Quitter announcement is a separate, explicitly owner-triggered step
 * that appears only after the authoritative article entity is acknowledged; its
 * failure never changes the article's outcome.
 */
export function BlogPublishModal({
  onClose,
  deps = createBlogPublishDeps(),
  renderEditor = defaultRenderEditor,
}: BlogPublishModalProps) {
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
  const [excerpt, setExcerpt] = useState('');
  const [body, setBody] = useState<RichTextDocument | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [quitterOptIn, setQuitterOptIn] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BlogPublishProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prepared, setPrepared] = useState<PosterImageResult | null>(null);
  const [result, setResult] = useState<BlogPublicationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<BlogVerifyResult | null>(null);
  const [quitterText, setQuitterText] = useState('');
  const [quitterRunning, setQuitterRunning] = useState(false);
  const [quitterError, setQuitterError] = useState<string | null>(null);
  const [quitterResult, setQuitterResult] = useState<QuitterAnnouncementResult | null>(null);
  const [quitterSkipped, setQuitterSkipped] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  /** Retained across attempts so resubmitting reuses the same QDN coordinates. */
  const draftIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const onSelectCover = useCallback(async (selected: File | null) => {
    setCoverError(null);
    setPrepared(null);
    setCoverFile(selected);
    setCoverPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return selected ? URL.createObjectURL(selected) : null;
    });
    if (!selected) return;
    try {
      const detected = await assertUsableImageSource(selected);
      if (!(BLOG_COVER_SOURCE_MIME_TYPES as readonly string[]).includes(detected)) {
        setCoverError('Use a JPEG, PNG or WebP cover image.');
      }
    } catch (error) {
      setCoverError(
        error instanceof ImageProcessingError
          ? error.message
          : 'The selected cover image could not be checked.',
      );
    }
  }, []);

  const validateForm = (): string | null => {
    if (!title.trim()) return 'A title is required.';
    if (title.trim().length > LIMITS.title) {
      return `The title must be at most ${LIMITS.title} characters.`;
    }
    if (excerpt.trim().length > LIMITS.excerpt) {
      return `The excerpt must be at most ${LIMITS.excerpt} characters.`;
    }
    if (!body || richTextToMarkdown(body).trim().length === 0) {
      return 'Write the article body before publishing.';
    }
    if (!coverFile) return 'Choose a cover image.';
    if (coverError) return coverError;
    if (!language.trim()) return 'A language code is required.';
    return null;
  };

  const onPublish = async () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    if (!coverFile || !body) return;
    setFormError(null);
    setVerifyResult(null);
    setQuitterResult(null);
    setQuitterError(null);
    setQuitterSkipped(false);
    setSubmitting(true);

    try {
      const publication = await publishBlogPost(
        ctx,
        {
          title,
          excerpt,
          body,
          cover: coverFile,
          categories,
          tags,
          language,
          // Reuse the identity of a previous attempt so a retry cannot duplicate.
          id: draftIdRef.current ?? undefined,
        },
        {
          onProgress: setProgress,
          onCoverPrepared: setPrepared,
        },
        deps,
      );
      draftIdRef.current = publication.id;
      setResult(publication);
      setQuitterText(publication.quitterAnnouncementText);
      refresh();
    } catch (error) {
      setFormError(
        error instanceof BlogPublishError ? error.message : 'The article could not be published.',
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
      const verification = await verifyBlogPublication(
        {
          id: result.id,
          publisherName: ctx.environment.publisherName ?? '',
          expectedEntityPayload: result.entityPayload,
          expectedSubwireCover: result.coverBase64,
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

  const onAnnounceQuitter = async () => {
    if (!result) return;
    setQuitterRunning(true);
    setQuitterError(null);
    try {
      const announcement = await announceOnQuitter(
        ctx,
        { id: result.id, text: quitterText, coverBase64: result.coverBase64 },
        deps,
      );
      setQuitterResult(announcement);
      refresh();
    } catch (error) {
      setQuitterError(
        error instanceof BlogPublishError
          ? error.message
          : 'The Quitter announcement could not be published.',
      );
    } finally {
      setQuitterRunning(false);
    }
  };

  const critical = submitting || quitterRunning;
  const articleExists =
    result !== null && (result.status === 'published' || result.status === 'index-incomplete');
  const showQuitterStep =
    articleExists && quitterOptIn && !quitterSkipped && quitterResult === null;
  const showQuitterOutcome = articleExists && quitterOptIn && quitterResult !== null;

  return (
    <Modal
      title="Add blog post"
      description="Publishes the article, its cover, the Shadow Archives metadata and a SubWire-compatible article resource under this app's publishing name."
      onRequestClose={onClose}
      canClose={!critical}
      initialFocusRef={firstFieldRef}
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
            <label className="sa-field__label" htmlFor="sa-blog-title">
              Title
            </label>
            <input
              ref={firstFieldRef}
              id="sa-blog-title"
              className="sa-input"
              type="text"
              required
              maxLength={LIMITS.title}
              value={title}
              disabled={critical}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="sa-field__hint">
              Stored in full in Shadow Archives. The shared Qortal and SubWire metadata mirror a
              byte-safe truncation of it.
            </p>
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-blog-excerpt">
              Excerpt / summary
            </label>
            <textarea
              id="sa-blog-excerpt"
              className="sa-input sa-input--textarea"
              rows={3}
              maxLength={LIMITS.excerpt}
              value={excerpt}
              disabled={critical}
              onChange={(event) => setExcerpt(event.target.value)}
            />
            <p className="sa-field__hint">
              Used on listing cards, as the SubWire article subtitle and in the optional Quitter
              announcement.
            </p>
          </div>

          <div className="sa-field">
            <span className="sa-field__label">Article body</span>
            {renderEditor({
              onChange: setBody,
              disabled: critical,
            })}
          </div>

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-blog-cover">
              Cover image (JPEG, PNG or WebP)
            </label>
            <p className="sa-field__hint">
              Required. Published as the QDN thumbnail and embedded in the SubWire-compatible
              article, so SubWire shows the same cover.
            </p>
            <input
              id="sa-blog-cover"
              className="sa-input"
              type="file"
              accept={BLOG_COVER_ACCEPT}
              disabled={critical}
              onChange={(event) => void onSelectCover(event.target.files?.[0] ?? null)}
            />
            {coverError ? (
              <p className="sa-field__error" role="alert">
                {coverError}
              </p>
            ) : null}
            {coverFile && coverPreviewUrl ? (
              <div className="sa-preview">
                <img
                  className="sa-preview__image"
                  src={coverPreviewUrl}
                  alt="Selected cover preview"
                />
                <p className="sa-field__hint">
                  {coverFile.name} · {formatByteSize(coverFile.size)}
                </p>
              </div>
            ) : null}
          </div>

          <TaxonomyInput
            label="Categories"
            values={categories}
            suggestions={snapshot.taxonomy.categories}
            onChange={setCategories}
            hint="Shadow Archives taxonomy is canonical; it is never replaced by another app's category enum."
          />
          <TaxonomyInput
            label="Tags"
            values={tags}
            suggestions={snapshot.taxonomy.tags}
            onChange={setTags}
            hint="Up to five short tags are mirrored into Qortal metadata for ecosystem discovery."
          />

          <div className="sa-field">
            <label className="sa-field__label" htmlFor="sa-blog-language">
              Language
            </label>
            <input
              id="sa-blog-language"
              className="sa-input"
              type="text"
              maxLength={LIMITS.language}
              value={language}
              disabled={critical}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>

          <label className="sa-field sa-field--inline" htmlFor="sa-blog-quitter">
            <input
              id="sa-blog-quitter"
              type="checkbox"
              checked={quitterOptIn}
              disabled={critical}
              onChange={(event) => setQuitterOptIn(event.target.checked)}
            />
            <span>
              Also offer a Quitter announcement after publishing
              <span className="sa-field__hint">
                Nothing is posted to Quitter automatically. After the article is published you can
                review and edit the announcement text, and Quitter asks for its own approval.
              </span>
            </span>
          </label>

          {prepared ? (
            <div className="sa-prepared">
              <p className="sa-prepared__title">Prepared for upload</p>
              <p className="sa-field__hint">
                Cover {prepared.width}×{prepared.height} px · {formatByteSize(prepared.bytes)} (
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

          {progress ? <BlogPublishProgressList progress={progress} /> : null}

          {formError ? (
            <p className="sa-field__error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="sa-route__actions">
            <Button variant="primary" type="submit" disabled={critical}>
              {submitting ? 'Publishing…' : 'Publish article'}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={critical}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <BlogPublicationOutcome
            result={result}
            verifying={verifying}
            verifyResult={verifyResult}
            onVerify={() => void onVerify()}
            onRetry={retry}
            onClose={onClose}
          />

          {showQuitterStep ? (
            <QuitterAnnouncementStep
              text={quitterText}
              onTextChange={setQuitterText}
              coverIncluded={result.coverBase64.length > 0}
              running={quitterRunning}
              result={null}
              error={quitterError}
              onAnnounce={() => void onAnnounceQuitter()}
              onDecline={() => setQuitterSkipped(true)}
              onRetry={() => void onAnnounceQuitter()}
            />
          ) : null}

          {showQuitterOutcome ? (
            <QuitterAnnouncementStep
              text={quitterText}
              onTextChange={setQuitterText}
              coverIncluded={result.coverBase64.length > 0}
              running={quitterRunning}
              result={quitterResult}
              error={quitterError}
              onAnnounce={() => void onAnnounceQuitter()}
              onDecline={() => setQuitterSkipped(true)}
              onRetry={() => {
                setQuitterResult(null);
                void onAnnounceQuitter();
              }}
            />
          ) : null}

          {articleExists && quitterOptIn && quitterSkipped && quitterResult === null ? (
            <p className="sa-field__hint" role="status">
              Quitter announcement skipped. The article is published and unaffected.
            </p>
          ) : null}
        </>
      )}
    </Modal>
  );
}
