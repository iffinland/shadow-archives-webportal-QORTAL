import { Button } from '../../../components/common';
import type {
  ResourceVerification,
  VideoPublishProgress,
  VideoPublishStep,
  VideoPublicationResult,
  VideoVerifyResult,
} from '../../../services/videoPublishService';

const VIDEO_STEPS: readonly { readonly step: VideoPublishStep; readonly label: string }[] = [
  { step: 'preparing-media', label: 'Preparing the poster image' },
  { step: 'checking-authority', label: 'Checking owner authority' },
  { step: 'awaiting-approval', label: 'Awaiting Qortal approval' },
  { step: 'publishing-media', label: 'Publishing the video and poster' },
  { step: 'publishing-metadata', label: 'Publishing metadata and the Q-Tube resource' },
  { step: 'updating-index', label: 'Updating the Videos index' },
  { step: 'confirming', label: 'Confirming' },
];

/**
 * Live progress for one video publication.
 *
 * The step list is static because the concrete plan shortens by exactly one
 * stage (the derived index is skipped when it cannot be safely rewritten), and
 * `progress.index/total` is the authoritative counter.
 */
export function VideoPublishProgressList({
  progress,
}: {
  readonly progress: VideoPublishProgress;
}) {
  return (
    <div className="sa-publish-progress" role="status" aria-live="polite">
      <p className="sa-publish-progress__current">{progress.label}</p>
      <p className="sa-publish-progress__counter">
        Step {progress.index} of {progress.total}
      </p>
      {progress.detail ? <p className="sa-publish-progress__detail">{progress.detail}</p> : null}
      <ol className="sa-publish-progress__steps">
        {VIDEO_STEPS.map((entry) => (
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

function outcomeTone(result: VideoPublicationResult): string {
  if (result.status === 'published') return 'sa-outcome--ok';
  if (result.status === 'index-incomplete') return 'sa-outcome--warn';
  return 'sa-outcome--error';
}

function presenceLabel(resource: ResourceVerification): string {
  if (resource.present === null) return resource.note ? `unknown (${resource.note})` : 'unknown';
  if (!resource.present) return 'missing';
  return resource.status ?? 'present';
}

export function VideoPublicationOutcome({
  result,
  verifying,
  verifyResult,
  onVerify,
  onRetry,
  onClose,
}: {
  readonly result: VideoPublicationResult;
  readonly verifying: boolean;
  readonly verifyResult: VideoVerifyResult | null;
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
          <dt>Video entity</dt>
          <dd>{result.entityIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Media (VIDEO)</dt>
          <dd>{result.videoIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Poster (THUMBNAIL)</dt>
          <dd>{result.thumbnailIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Q-Tube metadata</dt>
          <dd>{result.metadataIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Publisher</dt>
          <dd>{result.publisherName}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Availability</dt>
          <dd>
            {result.entityConfirmed
              ? 'entity confirmed by a bounded read'
              : 'verification pending (submission acknowledged)'}
          </dd>
        </div>
        <div className="sa-route__detail">
          <dt>Index</dt>
          <dd>
            {result.indexUpdated
              ? 'updated'
              : result.status === 'index-incomplete'
                ? 'incomplete — the entity is authoritative, discovery falls back to a prefix scan'
                : 'not updated'}
          </dd>
        </div>
      </dl>

      {result.failures.length > 0 ? (
        <ul className="sa-outcome__failures">
          {result.failures.map((failure, index) => (
            <li key={`${failure.service}-${failure.identifier ?? 'none'}-${index}`}>
              {failure.service} {failure.identifier ?? ''}: {failure.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {ambiguous ? (
        <p className="sa-outcome__warning">
          The submission timed out, so the result is uncertain: the host may have published it. Use
          Verify before any resubmission — the same video identity is reused, so a retry cannot
          create a duplicate.
        </p>
      ) : null}

      {verifyResult ? (
        <div className="sa-outcome__verify" role="status">
          <p>
            Verify result: {verifyResult.summary}
            {verifyResult.contentMatches === true
              ? ' — the served entity matches the intended metadata.'
              : verifyResult.contentMatches === false
                ? ' — the served entity does not match the intended metadata.'
                : ''}
          </p>
          <ul className="sa-outcome__resources">
            <li>
              DOCUMENT {verifyResult.entity.identifier}: {presenceLabel(verifyResult.entity)}
            </li>
            <li>
              VIDEO {verifyResult.video.identifier}: {presenceLabel(verifyResult.video)}
            </li>
            <li>
              THUMBNAIL {verifyResult.thumbnail.identifier}: {presenceLabel(verifyResult.thumbnail)}
            </li>
            <li>
              DOCUMENT {verifyResult.metadata.identifier}: {presenceLabel(verifyResult.metadata)}
            </li>
          </ul>
          <ul className="sa-outcome__resources">
            <li>
              Q-Tube validity gate:{' '}
              {verifyResult.qtubeMetadataValid === null
                ? 'unknown'
                : verifyResult.qtubeMetadataValid
                  ? 'passed'
                  : 'failed'}
            </li>
            <li>
              Q-Tube media reference:{' '}
              {verifyResult.qtubeReferenceMatches === null
                ? 'unknown'
                : verifyResult.qtubeReferenceMatches
                  ? 'points at this publication'
                  : 'does not point at this publication'}
            </li>
            <li>
              Q-Tube discovery query:{' '}
              {verifyResult.qtubeDiscovery.found === null
                ? 'unknown'
                : verifyResult.qtubeDiscovery.found
                  ? `found (${verifyResult.qtubeDiscovery.hits} hit(s) before it)`
                  : 'not returned yet'}
            </li>
          </ul>
          {verifyResult.qtubeDiscovery.note ? (
            <p className="sa-field__hint">{verifyResult.qtubeDiscovery.note}</p>
          ) : null}
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
