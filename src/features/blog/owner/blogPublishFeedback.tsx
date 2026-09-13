import { Button } from '../../../components/common';
import type {
  BlogPublicationResult,
  BlogPublishProgress,
  BlogPublishStep,
  BlogVerifyResult,
  QuitterAnnouncementResult,
  ResourceVerification,
} from '../../../services/blogPublishService';

const BLOG_STEPS: readonly { readonly step: BlogPublishStep; readonly label: string }[] = [
  { step: 'preparing-cover', label: 'Preparing the cover image' },
  { step: 'checking-authority', label: 'Checking owner authority' },
  { step: 'awaiting-approval', label: 'Awaiting Qortal approval' },
  { step: 'publishing-cover', label: 'Publishing the cover image' },
  { step: 'publishing-article', label: 'Publishing the article and its SubWire resource' },
  { step: 'updating-index', label: 'Updating the Blog index' },
  { step: 'confirming', label: 'Confirming' },
];

/**
 * Live progress for one blog publication.
 *
 * The step list is static because the concrete plan shortens by exactly one stage
 * (the derived index is skipped when it cannot be safely rewritten), and
 * `progress.index/total` is the authoritative counter.
 */
export function BlogPublishProgressList({ progress }: { readonly progress: BlogPublishProgress }) {
  return (
    <div className="sa-publish-progress" role="status" aria-live="polite">
      <p className="sa-publish-progress__current">{progress.label}</p>
      <p className="sa-publish-progress__counter">
        Step {progress.index} of {progress.total}
      </p>
      {progress.detail ? <p className="sa-publish-progress__detail">{progress.detail}</p> : null}
      <ol className="sa-publish-progress__steps">
        {BLOG_STEPS.map((entry) => (
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

function outcomeTone(result: BlogPublicationResult): string {
  if (result.status === 'published') return 'sa-outcome--ok';
  if (result.status === 'index-incomplete') return 'sa-outcome--warn';
  return 'sa-outcome--error';
}

function presenceLabel(resource: ResourceVerification): string {
  if (resource.present === null) return resource.note ? `unknown (${resource.note})` : 'unknown';
  if (!resource.present) return 'missing';
  return resource.status ?? 'present';
}

export function BlogPublicationOutcome({
  result,
  verifying,
  verifyResult,
  onVerify,
  onRetry,
  onClose,
}: {
  readonly result: BlogPublicationResult;
  readonly verifying: boolean;
  readonly verifyResult: BlogVerifyResult | null;
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
          <dt>Article entity (DOCUMENT)</dt>
          <dd>{result.entityIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Cover (THUMBNAIL)</dt>
          <dd>{result.thumbnailIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>SubWire-compatible article (DOCUMENT)</dt>
          <dd>{result.subwireIdentifier}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Publisher</dt>
          <dd>{result.publisherName}</dd>
        </div>
        <div className="sa-route__detail">
          <dt>Availability</dt>
          <dd>
            {result.entityConfirmed
              ? 'article entity confirmed by a bounded read'
              : 'verification pending (submission acknowledged)'}
          </dd>
        </div>
        <div className="sa-route__detail">
          <dt>Index</dt>
          <dd>
            {result.indexUpdated
              ? 'updated'
              : result.status === 'index-incomplete'
                ? 'incomplete — the article entity is authoritative, discovery falls back to a prefix scan'
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
          Verify before any resubmission — the same post identity is reused, so a retry cannot
          create a duplicate article.
        </p>
      ) : null}

      {verifyResult ? (
        <div className="sa-outcome__verify" role="status">
          <p>
            Verify result: {verifyResult.summary}
            {verifyResult.contentMatches === true
              ? ' — the served article entity matches the intended metadata.'
              : verifyResult.contentMatches === false
                ? ' — the served article entity does not match the intended metadata.'
                : ''}
          </p>
          <ul className="sa-outcome__resources">
            <li>
              DOCUMENT {verifyResult.entity.identifier}: {presenceLabel(verifyResult.entity)}
            </li>
            <li>
              THUMBNAIL {verifyResult.thumbnail.identifier}: {presenceLabel(verifyResult.thumbnail)}
            </li>
            <li>
              DOCUMENT {verifyResult.subwire.identifier}: {presenceLabel(verifyResult.subwire)}
            </li>
          </ul>
          <ul className="sa-outcome__resources">
            <li>
              SubWire article fields:{' '}
              {verifyResult.subwireValid === null
                ? 'unknown'
                : verifyResult.subwireValid
                  ? 'passed'
                  : 'failed'}
            </li>
            <li>
              SubWire cover matches:{' '}
              {verifyResult.subwireCoverMatches === null
                ? 'unknown'
                : verifyResult.subwireCoverMatches
                  ? 'yes'
                  : 'no'}
            </li>
            <li>
              SubWire discovery query:{' '}
              {verifyResult.subwireDiscovery.found === null
                ? 'unknown'
                : verifyResult.subwireDiscovery.found
                  ? `found (${verifyResult.subwireDiscovery.hits} hit(s) before it)`
                  : 'not returned yet'}
            </li>
          </ul>
          {verifyResult.subwireDiscovery.note ? (
            <p className="sa-field__hint">{verifyResult.subwireDiscovery.note}</p>
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

/**
 * The optional Quitter step.
 *
 * It is a separate owner action with its own Qortal approval, shown only after
 * the article exists. A failed or timed-out announcement is reported here and
 * never changes the article's outcome.
 */
export function QuitterAnnouncementStep({
  text,
  onTextChange,
  coverIncluded,
  running,
  result,
  error,
  onAnnounce,
  onDecline,
  onRetry,
}: {
  readonly text: string;
  readonly onTextChange: (next: string) => void;
  readonly coverIncluded: boolean;
  readonly running: boolean;
  readonly result: QuitterAnnouncementResult | null;
  readonly error: string | null;
  readonly onAnnounce: () => void;
  readonly onDecline: () => void;
  readonly onRetry: () => void;
}) {
  if (result) {
    const tone =
      result.status === 'announced'
        ? 'sa-outcome--ok'
        : result.status === 'ambiguous'
          ? 'sa-outcome--warn'
          : 'sa-outcome--error';
    return (
      <div className={`sa-outcome ${tone}`} role="status" aria-live="polite">
        <p className="sa-outcome__message">{result.message}</p>
        <dl className="sa-route__details">
          <div className="sa-route__detail">
            <dt>Quitter post (DOCUMENT)</dt>
            <dd>{result.identifier}</dd>
          </div>
          <div className="sa-route__detail">
            <dt>Availability</dt>
            <dd>
              {result.postConfirmed
                ? 'post confirmed by a bounded read'
                : 'verification pending (submission acknowledged)'}
            </dd>
          </div>
        </dl>
        {result.status !== 'announced' ? (
          <p className="sa-outcome__warning">
            The article itself is unaffected and already published. A retry reuses the same Quitter
            identity, so it cannot create a duplicate announcement.
          </p>
        ) : null}
        <div className="sa-route__actions">
          {result.status !== 'announced' ? (
            <Button variant="primary" onClick={onRetry} disabled={running}>
              {running ? 'Posting…' : 'Try the announcement again'}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onDecline}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="sa-quitter-step">
      <p className="sa-field__hint">
        Optional. Posting to Quitter is a separate, owner-approved QDN write under the same
        publishing name, using Quitter&apos;s own public post format so Quitter displays it
        natively. Your Shadow Archives article stays published whether or not you announce it.
      </p>
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="sa-quitter-text">
          Quitter announcement
        </label>
        <textarea
          id="sa-quitter-text"
          className="sa-input sa-input--textarea"
          rows={7}
          value={text}
          disabled={running}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <p className="sa-field__hint">
          {coverIncluded
            ? 'The published cover image is attached to the post, as SubWire does when it shares an article.'
            : 'No cover image is attached; the announcement will be text only.'}
        </p>
      </div>
      {error ? (
        <p className="sa-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sa-route__actions">
        <Button
          variant="primary"
          onClick={onAnnounce}
          disabled={running || text.trim().length === 0}
        >
          {running ? 'Posting to Quitter…' : 'Post announcement to Quitter'}
        </Button>
        <Button variant="ghost" onClick={onDecline} disabled={running}>
          Skip
        </Button>
      </div>
    </div>
  );
}
