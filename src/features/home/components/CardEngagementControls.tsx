import { useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../../../app/providers/AuthProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { Button, IconComment, IconShare, IconThumbsUp, IconTip } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import {
  publishComment,
  sendTip,
  setLike,
  type EngagementKind,
  type EngagementTarget,
} from '../../../services/engagementService';
import type { ContentCardModel } from '../../../types/content';
import '../../owner/owner.css';

type Intent = 'like' | 'comment' | 'tip' | null;
type FeedbackTone = 'ok' | 'error' | 'warn';
interface Feedback {
  readonly action: Exclude<Intent, null> | 'share';
  readonly tone: FeedbackTone;
  readonly message: string;
}

function kindFor(item: ContentCardModel): EngagementKind {
  return item.kind;
}

function publicationMessage(
  action: 'like' | 'comment',
  result: Awaited<ReturnType<typeof setLike>>,
): Feedback {
  if (result.kind === 'submitted')
    return {
      action,
      tone: 'ok',
      message: `${action === 'like' ? 'Like' : 'Comment'} submitted to QDN.`,
    };
  if (result.kind === 'partial')
    return {
      action,
      tone: 'warn',
      message: 'Only part of the QDN operation completed. Do not retry automatically.',
    };
  if (result.kind === 'ambiguous')
    return {
      action,
      tone: 'warn',
      message: 'The result timed out and may have been submitted. Check QDN before retrying.',
    };
  return { action, tone: 'error', message: result.error.message };
}

/** Shared, real engagement controls for Blog, Video and Gallery cards. */
export function CardEngagementControls({ item }: { readonly item: ContentCardModel }) {
  const environment = useQortalEnvironment();
  const { account, ownedNames, permission, authenticate } = useAuth();
  const [intent, setIntent] = useState<Intent>(null);
  const [actingName, setActingName] = useState('');
  const [comment, setComment] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [liked, setLiked] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const target = useMemo<EngagementTarget | null>(() => {
    if (!environment.publisherName) return null;
    return {
      kind: kindFor(item),
      entityIdentifier: item.id,
      publisherName: environment.publisherName,
      title: item.title,
    };
  }, [environment.publisherName, item]);

  const open = (next: Exclude<Intent, null>) => {
    setFeedback(null);
    setIntent(next);
    if (!actingName && ownedNames.length === 1) setActingName(ownedNames[0].name);
  };

  const share = async () => {
    const url = new URL(item.href, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else throw new Error('Sharing is not supported by this browser.');
      setFeedback({ action: 'share', tone: 'ok', message: 'Share link ready.' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sharing was cancelled or unavailable.';
      setFeedback({ action: 'share', tone: 'error', message });
    }
  };

  const connect = async () => {
    setBusy(true);
    await authenticate({ retry: permission === 'rejected' || permission === 'unavailable' });
    setBusy(false);
  };

  const submit = async () => {
    if (!target || !intent) {
      setFeedback({
        action: intent ?? 'like',
        tone: 'error',
        message: 'This card has no verified QDN target.',
      });
      return;
    }
    if (!account || ownedNames.length === 0) return;
    setBusy(true);
    try {
      if (intent === 'like') {
        const nextLiked = !liked;
        const result = await setLike(target, actingName, nextLiked);
        const outcome = publicationMessage('like', result);
        if (outcome.tone === 'ok') setLiked(nextLiked);
        setFeedback(outcome);
      } else if (intent === 'comment') {
        setFeedback(
          publicationMessage('comment', await publishComment(target, actingName, comment)),
        );
        setComment('');
      } else {
        const result = await sendTip(target, Number(amount));
        setFeedback(
          result.kind === 'submitted'
            ? {
                action: 'tip',
                tone: 'ok',
                message: `${result.amount} QORT tip submitted for Hub approval.`,
              }
            : {
                action: 'tip',
                tone: result.kind === 'ambiguous' ? 'warn' : 'error',
                message: result.message,
              },
        );
      }
      setIntent(null);
    } catch (error) {
      setFeedback({
        action: intent,
        tone: 'error',
        message: error instanceof Error ? error.message : 'The action failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const label =
    intent === 'like' ? (liked ? 'Remove like' : 'Like') : intent === 'comment' ? 'Comment' : 'Tip';
  const requiresName = intent === 'like' || intent === 'comment';

  return (
    <>
      <div className="sa-card__actions" aria-label={`Actions for ${item.title}`}>
        <ActionButton
          label={liked ? 'Remove like' : 'Like'}
          tooltip={liked ? 'Remove your like' : 'Like this item'}
          feedback={feedback?.action === 'like' ? feedback : null}
          onClick={() => open('like')}
        >
          <IconThumbsUp />
        </ActionButton>
        <ActionButton
          label="Comment"
          tooltip="Write a QDN comment"
          feedback={feedback?.action === 'comment' ? feedback : null}
          onClick={() => open('comment')}
        >
          <IconComment />
        </ActionButton>
        <ActionButton
          label="Share"
          tooltip="Share or copy this item link"
          feedback={feedback?.action === 'share' ? feedback : null}
          onClick={() => void share()}
        >
          <IconShare />
        </ActionButton>
        <ActionButton
          label="Tip"
          tooltip="Send QORT to the publisher"
          feedback={feedback?.action === 'tip' ? feedback : null}
          onClick={() => open('tip')}
        >
          <IconTip />
        </ActionButton>
      </div>

      {intent ? (
        <Modal
          title={label}
          description={
            intent === 'tip'
              ? 'The Hub will show the recipient, amount and fee before any QORT transfer.'
              : 'A Qortal host approval is required; this action is never retried automatically.'
          }
          onRequestClose={() => !busy && setIntent(null)}
          canClose={!busy}
          footer={
            <div className="sa-modal__actions">
              <Button variant="secondary" disabled={busy} onClick={() => setIntent(null)}>
                Cancel
              </Button>
              {account && (!requiresName || ownedNames.length > 0) ? (
                <Button
                  variant="primary"
                  disabled={busy || (requiresName && !actingName)}
                  onClick={() => void submit()}
                >
                  {busy ? 'Working…' : label}
                </Button>
              ) : null}
            </div>
          }
        >
          {!account ? (
            <div className="sa-form__notice">
              <p>
                Connect your Qortal account to continue. Shadow Archives will request only the
                account and its registered names.
              </p>
              <Button variant="primary" disabled={busy} onClick={() => void connect()}>
                {busy ? 'Connecting…' : 'Connect Qortal account'}
              </Button>
            </div>
          ) : requiresName && ownedNames.length === 0 ? (
            <p className="sa-field__error" role="alert">
              This action needs a registered Qortal name. The connected account has none.
            </p>
          ) : (
            <div className="sa-form">
              {requiresName ? (
                <div className="sa-field">
                  <label className="sa-field__label" htmlFor="sa-engagement-name">
                    Acting as
                  </label>
                  <select
                    id="sa-engagement-name"
                    className="sa-input"
                    value={actingName}
                    onChange={(event) => setActingName(event.target.value)}
                  >
                    <option value="">Choose a Qortal name</option>
                    {ownedNames.map((name) => (
                      <option key={name.name} value={name.name}>
                        {name.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {intent === 'comment' ? (
                <div className="sa-field">
                  <label className="sa-field__label" htmlFor="sa-engagement-comment">
                    Comment
                  </label>
                  <textarea
                    id="sa-engagement-comment"
                    className="sa-input"
                    rows={5}
                    maxLength={4096}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </div>
              ) : null}
              {intent === 'tip' ? (
                <div className="sa-field">
                  <label className="sa-field__label" htmlFor="sa-engagement-amount">
                    QORT amount
                  </label>
                  <input
                    id="sa-engagement-amount"
                    className="sa-input"
                    type="number"
                    min="0.00000001"
                    step="0.00000001"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                  <p className="sa-field__hint">
                    The recipient is the current Qortal owner of{' '}
                    {target?.publisherName ?? 'this content'}.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

function ActionButton({
  label,
  tooltip,
  feedback,
  onClick,
  children,
}: {
  readonly label: string;
  readonly tooltip: string;
  readonly feedback: Feedback | null;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <span className="sa-card__action-wrap">
      <button
        type="button"
        className="sa-card__action"
        aria-label={label}
        aria-describedby={`sa-card-action-${label}`}
        onClick={onClick}
      >
        {children}
      </button>
      <span id={`sa-card-action-${label}`} className="sa-card__tooltip" role="tooltip">
        {tooltip}
      </span>
      {feedback ? (
        <span className={`sa-card__feedback sa-card__feedback--${feedback.tone}`} role="status">
          {feedback.message}
        </span>
      ) : null}
    </span>
  );
}
