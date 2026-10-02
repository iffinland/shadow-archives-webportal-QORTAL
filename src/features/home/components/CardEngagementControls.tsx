import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../../../app/providers/AuthProvider';
import { useQortalEnvironment } from '../../../app/providers/BridgeProvider';
import { Button, IconComment, IconShare, IconThumbsUp, IconTip } from '../../../components/common';
import { Modal } from '../../../components/overlay/Modal';
import {
  publishComment,
  readEngagementComments,
  readEngagementCounts,
  sendTip,
  setLike,
  type EngagementKind,
  type EngagementComment,
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

interface Counts {
  readonly likes: number;
  readonly comments: number;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Qortal's embedded frame may not expose the asynchronous clipboard API.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    if (!document.execCommand('copy')) throw new Error('The browser rejected the copy request.');
  } finally {
    document.body.removeChild(textarea);
  }
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
  const [counts, setCounts] = useState<Counts | null>(null);
  const [comments, setComments] = useState<readonly EngagementComment[] | null>(null);
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

  useEffect(() => {
    let current = true;
    if (!target) {
      setCounts(null);
      return () => {
        current = false;
      };
    }
    void readEngagementCounts(target)
      .then((next) => {
        if (current) setCounts(next);
      })
      .catch(() => {
        if (current) setCounts(null);
      });
    return () => {
      current = false;
    };
  }, [target]);

  useEffect(() => {
    let current = true;
    if (intent !== 'comment' || !target)
      return () => {
        current = false;
      };
    setComments(null);
    void readEngagementComments(target)
      .then((next) => {
        if (current) setComments(next);
      })
      .catch(() => {
        if (current) setComments([]);
      });
    return () => {
      current = false;
    };
  }, [intent, target]);

  const open = (next: Exclude<Intent, null>) => {
    setFeedback(null);
    setIntent(next);
    if (!actingName && ownedNames.length === 1) setActingName(ownedNames[0].name);
  };

  const share = async () => {
    const url = new URL(item.href, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url });
        setFeedback({ action: 'share', tone: 'ok', message: 'Share link opened.' });
      } else {
        await copyToClipboard(url);
        setFeedback({ action: 'share', tone: 'ok', message: 'Share link copied.' });
      }
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
        if (outcome.tone === 'ok') {
          setLiked(nextLiked);
          setCounts((current) =>
            current
              ? { ...current, likes: Math.max(0, current.likes + (nextLiked ? 1 : -1)) }
              : current,
          );
        }
        setFeedback(outcome);
      } else if (intent === 'comment') {
        const outcome = publicationMessage(
          'comment',
          await publishComment(target, actingName, comment),
        );
        if (outcome.tone === 'ok') {
          setCounts((current) =>
            current ? { ...current, comments: current.comments + 1 } : current,
          );
        }
        setFeedback(outcome);
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
          count={counts ? counts.likes : null}
        >
          <IconThumbsUp />
        </ActionButton>
        <ActionButton
          label="Comment"
          tooltip="Write a QDN comment"
          feedback={feedback?.action === 'comment' ? feedback : null}
          onClick={() => open('comment')}
          count={counts ? counts.comments : null}
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
                <div className="sa-engagement-comments">
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
                  <section aria-live="polite" aria-label="Published QDN comments">
                    <h3 className="sa-engagement-comments__title">Published comments</h3>
                    {comments === null ? (
                      <p className="sa-field__hint">Loading public QDN comments…</p>
                    ) : comments.length === 0 ? (
                      <p className="sa-field__hint">No public comments have been found yet.</p>
                    ) : (
                      <ul className="sa-engagement-comments__list">
                        {comments.map((published) => (
                          <li key={published.id} className="sa-engagement-comments__item">
                            <strong>{published.authorName}</strong>
                            <p>{published.bodyText}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
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
  count,
  children,
}: {
  readonly label: string;
  readonly tooltip: string;
  readonly feedback: Feedback | null;
  readonly onClick: () => void;
  readonly count?: number | null;
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
        {count !== undefined ? (
          <span
            className="sa-card__action-count"
            aria-label={count === null ? 'Loading count' : undefined}
          >
            {count ?? '…'}
          </span>
        ) : null}
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
