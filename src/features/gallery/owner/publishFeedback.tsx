import { Button } from '../../../components/common';
import type {
  GalleryPublishProgress,
  GalleryPublishStep,
  GalleryPublicationResult,
  GalleryVerifyResult,
} from '../../../services/galleryPublishService';

const IMAGE_STEPS: readonly { readonly step: GalleryPublishStep; readonly label: string }[] = [
  { step: 'preparing-media', label: 'Preparing image and thumbnail' },
  { step: 'checking-authority', label: 'Checking owner authority' },
  { step: 'awaiting-approval', label: 'Awaiting Qortal approval' },
  { step: 'publishing-media', label: 'Publishing media and thumbnail' },
  { step: 'publishing-metadata', label: 'Publishing metadata' },
  { step: 'updating-index', label: 'Updating the Gallery index' },
  { step: 'confirming', label: 'Confirming' },
];

const ALBUM_STEPS: readonly { readonly step: GalleryPublishStep; readonly label: string }[] = [
  { step: 'checking-authority', label: 'Checking owner authority' },
  { step: 'awaiting-approval', label: 'Awaiting Qortal approval' },
  { step: 'publishing-metadata', label: 'Publishing album metadata' },
  { step: 'updating-index', label: 'Updating the Gallery index' },
  { step: 'confirming', label: 'Confirming' },
];

export function PublishProgressList({
  progress,
  variant,
}: {
  readonly progress: GalleryPublishProgress;
  readonly variant: 'image' | 'album';
}) {
  const steps = variant === 'image' ? IMAGE_STEPS : ALBUM_STEPS;

  return (
    <div className="sa-publish-progress" role="status" aria-live="polite">
      <p className="sa-publish-progress__current">{progress.label}</p>
      <p className="sa-publish-progress__counter">
        Step {progress.index} of {progress.total}
      </p>
      {progress.detail ? <p className="sa-publish-progress__detail">{progress.detail}</p> : null}
      <ol className="sa-publish-progress__steps">
        {steps.map((entry) => (
          <li
            key={entry.step}
            className={
              entry.step === progress.step
                ? 'sa-publish-progress__step sa-publish-progress__step--active'
                : 'sa-publish-progress__step'
            }
          >
            {entry.label}
          </li>
        ))}
      </ol>
      <p className="sa-publish-progress__note">
        Never close or navigate away while a step is in progress. A submission that times out is
        never retried automatically.
      </p>
    </div>
  );
}

function outcomeTone(result: GalleryPublicationResult): string {
  if (result.status === 'published') return 'sa-outcome--ok';
  if (result.status === 'index-incomplete') return 'sa-outcome--warn';
  return 'sa-outcome--error';
}

export function PublicationOutcome({
  result,
  verifying,
  verifyResult,
  onVerify,
  onRetry,
  onClose,
}: {
  readonly result: GalleryPublicationResult;
  readonly verifying: boolean;
  readonly verifyResult: GalleryVerifyResult | null;
  readonly onVerify: () => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const ambiguous = result.status === 'ambiguous';
  const verifySaysMissing = verifyResult !== null && verifyResult.summary === 'missing';
  const canRetry = !ambiguous || verifySaysMissing;

  return (
    <div className={`sa-outcome ${outcomeTone(result)}`}>
      <p className="sa-outcome__message" role="status" aria-live="polite">
        {result.message}
      </p>

      <dl className="sa-route__details">
        <div className="sa-route__detail">
          <dt>Item</dt>
          <dd>{result.entityIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Metadata submitted</dt>
          <dd>{result.status === 'failed' ? 'no' : 'yes'}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Availability</dt>
          <dd>
            {result.entityConfirmed
              ? 'confirmed by a bounded read'
              : 'verification pending (submission acknowledged)'}
          </dd>
        </div>
        <div className="sa-route__detail">
          <dt>Index</dt>
          <dd>
            {result.indexUpdated
              ? 'updated'
              : result.status === 'index-incomplete'
                ? 'incomplete — content is authoritative, discovery falls back to a prefix scan'
                : 'not updated'}
          </dd>
        </div>
      </dl>

      {result.failures.length > 0 ? (
        <ul className="sa-outcome__failures">
          {result.failures.map((failure) => (
            <li key={`${failure.service}-${failure.identifier ?? 'none'}`}>
              {failure.service} {failure.identifier ?? ''}: {failure.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {ambiguous ? (
        <p className="sa-outcome__warning">
          The submission timed out, so the result is uncertain: the host may have published it. Use
          Verify before any resubmission — the same item identity is reused, so a retry cannot
          create a duplicate.
        </p>
      ) : null}

      {verifyResult ? (
        <div className="sa-outcome__verify" role="status">
          <p>
            Verify result: {verifyResult.summary}
            {verifyResult.contentMatches === true
              ? ' — the served payload matches the intended item.'
              : verifyResult.contentMatches === false
                ? ' — the served payload does not match the intended item.'
                : ''}
          </p>
          <ul className="sa-outcome__resources">
            <li>
              DOCUMENT {verifyResult.entity.identifier}:{' '}
              {verifyResult.entity.present === null
                ? 'unknown'
                : verifyResult.entity.present
                  ? (verifyResult.entity.status ?? 'present')
                  : 'missing'}
            </li>
            {verifyResult.media ? (
              <li>
                IMAGE {verifyResult.media.identifier}:{' '}
                {verifyResult.media.present === null
                  ? 'unknown'
                  : verifyResult.media.present
                    ? (verifyResult.media.status ?? 'present')
                    : 'missing'}
              </li>
            ) : null}
            {verifyResult.thumbnail ? (
              <li>
                THUMBNAIL {verifyResult.thumbnail.identifier}:{' '}
                {verifyResult.thumbnail.present === null
                  ? 'unknown'
                  : verifyResult.thumbnail.present
                    ? (verifyResult.thumbnail.status ?? 'present')
                    : 'missing'}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="sa-route__actions">
        <Button variant="secondary" onClick={onVerify} disabled={verifying}>
          {verifying ? 'Verifying…' : 'Verify'}
        </Button>
        {canRetry && result.status !== 'published' ? (
          <Button variant="primary" onClick={onRetry}>
            Publish again
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
