import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useAuth } from '../../app/providers/AuthProvider';
import { useQortalEnvironment } from '../../app/providers/BridgeProvider';
import { Button, Skeleton } from '../../components/common';
import { CONTACT_MESSAGE_MAX_LENGTH, validateContactMessage } from '../../services/contactMessage';
import {
  CONTACT_RECIPIENT_MESSAGES,
  type ContactRecipientResult,
} from '../../services/contactRecipient';
import { contactRetentionNotice } from '../../services/contactRetention';
import {
  createContactSendDeps,
  sendContactMessage,
  type ContactSendOutcome,
  type ContactSendDeps,
} from '../../services/contactService';
import '../owner/owner.css';
import './contact.css';

export interface ContactPageProps {
  /** Test seam; production builds the real bridge-backed dependencies. */
  readonly deps?: ContactSendDeps;
}

interface SettledResolution {
  /** The dependency graph that produced the result. */
  readonly deps: ContactSendDeps;
  readonly result: ContactRecipientResult;
}

type ResolutionState =
  | { readonly status: 'resolving' }
  | { readonly status: 'settled'; readonly result: ContactRecipientResult };

/**
 * Contact page — Shadow Archives' only visitor-facing write flow.
 *
 * Transport is exactly one action: a Qortal private chat message
 * (`SEND_CHAT_MESSAGE`) from the account active in the visitor's Qortal host to
 * the CURRENT owner of the app's publishing name. The recipient is resolved from
 * the injected publishing identity on mount and again immediately before every
 * send; there is no hardcoded owner, no public-chat fallback and no Q-Mail send.
 *
 * The draft lives only in component state: it is cleared after a submission the
 * host acknowledged and kept for every ambiguous, rejected or failed result.
 * Nothing is written to storage, and the message body is never logged.
 */
export default function ContactPage({ deps: injectedDeps }: ContactPageProps = {}) {
  const environment = useQortalEnvironment();
  const { account } = useAuth();

  const [draft, setDraft] = useState('');
  const [settled, setSettled] = useState<SettledResolution | null>(null);
  const [outcome, setOutcome] = useState<ContactSendOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submitGuard = useRef(false);
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const resolutionGeneration = useRef(0);

  const deps = useMemo(
    () => injectedDeps ?? createContactSendDeps(environment),
    [injectedDeps, environment],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const generation = resolutionGeneration.current + 1;
    resolutionGeneration.current = generation;
    void deps.resolveRecipient().then((result) => {
      // A late answer from a superseded dependency graph is ignored rather than
      // written into state.
      if (generation !== resolutionGeneration.current) return;
      setSettled({ deps, result });
    });
  }, [deps]);

  /*
   * Derived during render, not written in an effect: a result only counts for
   * the dependency graph that produced it, so a changed graph is `resolving`
   * again without a cascading state update on mount.
   */
  const resolution: ResolutionState =
    settled && settled.deps === deps
      ? { status: 'settled', result: settled.result }
      : { status: 'resolving' };

  // Move focus to the result panel so a keyboard or screen-reader user is told
  // the outcome instead of having to hunt for it.
  useEffect(() => {
    if (outcome) outcomeRef.current?.focus();
  }, [outcome]);

  const recipient =
    resolution.status === 'settled' && resolution.result.kind === 'resolved'
      ? resolution.result.recipient
      : null;

  const blockedReason =
    resolution.status === 'resolving'
      ? null
      : resolution.result.kind === 'unresolved'
        ? resolution.result.message
        : null;

  const canSend = recipient !== null && !pending;
  const ambiguous = outcome?.kind === 'ambiguous';

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // A second click (or Enter repeat) while a send is in flight must never
      // start a duplicate host request.
      if (submitGuard.current || pending || !recipient) return;

      const check = validateContactMessage(draft);
      if (!check.ok) {
        setFieldError(check.message);
        return;
      }

      submitGuard.current = true;
      setFieldError(null);
      setPending(true);
      setOutcome(null);

      // The exact text submitted, so a successful send clears only that text and
      // never anything the visitor typed while waiting for the host.
      const submittedDraft = draft;
      void sendContactMessage(draft, deps)
        .then((result) => {
          if (!mountedRef.current) return;
          setOutcome(result);
          // Only a submission the host acknowledged may clear the draft.
          if (result.kind === 'sent') {
            setDraft((current) => (current === submittedDraft ? '' : current));
          }
        })
        .finally(() => {
          submitGuard.current = false;
          if (mountedRef.current) setPending(false);
        });
    },
    [deps, draft, pending, recipient],
  );

  const submitLabel = pending
    ? 'Sending…'
    : ambiguous
      ? 'Send again (may duplicate)'
      : 'Send private message';

  return (
    <div className="sa-route sa-contact">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Contact</h1>
        <p className="sa-route__lead">
          Send a private message to the current owner of{' '}
          {environment.publisherName ?? 'this archive'} through Qortal private chat.
        </p>
      </header>

      <section className="sa-contact__transport" aria-labelledby="sa-contact-transport-title">
        <h2 className="sa-contact__transport-title" id="sa-contact-transport-title">
          How this message is delivered
        </h2>
        <p className="sa-contact__transport-body">{contactRetentionNotice()}</p>
        <p className="sa-contact__transport-body">
          The message is encrypted to the owner&rsquo;s Qortal public key by your Qortal host, and
          your host asks you to approve it before anything is signed. This app never sees your keys
          and never stores your draft.
        </p>
      </section>

      <section className="sa-contact__recipient" aria-labelledby="sa-contact-recipient-title">
        <h2 className="sa-contact__recipient-title" id="sa-contact-recipient-title">
          Recipient
        </h2>
        {resolution.status === 'resolving' ? (
          <div className="sa-contact__recipient-body" role="status" aria-live="polite">
            <Skeleton width="18rem" height="1rem" />
            <span className="sa-visually-hidden">
              Resolving the current owner of the publishing name.
            </span>
          </div>
        ) : recipient ? (
          <p className="sa-contact__recipient-body">
            <strong>{recipient.publisherName}</strong> — the name this app is published under. The
            owner address is resolved from the Qortal node now and re-checked immediately before the
            message is sent, so a name transfer is never ignored.
          </p>
        ) : (
          <p className="sa-contact__recipient-body sa-contact__recipient-body--blocked">
            {blockedReason ?? CONTACT_RECIPIENT_MESSAGES['name-unresolved']}
          </p>
        )}
        <p className="sa-contact__sender">
          {account
            ? `Sender: ${account.address} (the account active in this session).`
            : 'Sender: the Qortal account currently active in your Qortal host. Your host shows that account in the approval dialog.'}
        </p>
      </section>

      <form className="sa-form sa-contact__form" onSubmit={handleSubmit} noValidate>
        <div className="sa-field">
          <label className="sa-field__label" htmlFor="sa-contact-message">
            Message
          </label>
          {/*
            The field stays writable while the recipient resolves and while a
            send is in flight: a visitor who starts typing immediately must
            never lose keystrokes to a disabled control. Only the Send action is
            gated on a resolved recipient, and the recipient is resolved again
            at send time regardless.
          */}
          <textarea
            aria-describedby="sa-contact-message-hint sa-contact-message-error"
            aria-invalid={fieldError ? true : undefined}
            className="sa-input sa-input--textarea"
            disabled={resolution.status === 'settled' && recipient === null}
            id="sa-contact-message"
            maxLength={CONTACT_MESSAGE_MAX_LENGTH * 2}
            name="message"
            onChange={(event) => {
              setDraft(event.target.value);
              if (fieldError) setFieldError(null);
            }}
            rows={8}
            value={draft}
          />
          <p className="sa-field__hint" id="sa-contact-message-hint">
            {draft.trim().length} / {CONTACT_MESSAGE_MAX_LENGTH} characters. Plain text only; links
            are not clickable for the recipient.
          </p>
          {fieldError ? (
            <p className="sa-field__error" id="sa-contact-message-error" role="alert">
              {fieldError}
            </p>
          ) : (
            <span id="sa-contact-message-error" />
          )}
        </div>

        <div className="sa-contact__actions">
          <Button
            disabled={!canSend}
            type="submit"
            variant="primary"
            aria-busy={pending ? true : undefined}
            title={
              ambiguous
                ? 'The previous attempt timed out. Sending again may deliver a duplicate message.'
                : undefined
            }
          >
            {submitLabel}
          </Button>
          {recipient === null && resolution.status === 'settled' ? (
            <p className="sa-contact__blocked-note">
              Sending is unavailable in this context, so no message can be submitted.
            </p>
          ) : null}
        </div>
      </form>

      <div
        aria-live="polite"
        className="sa-contact__outcome"
        ref={outcomeRef}
        role="status"
        tabIndex={-1}
      >
        {pending ? (
          <p className="sa-contact__pending">
            Waiting for your Qortal host to sign and this node to relay the message…
          </p>
        ) : null}
        {outcome ? <OutcomePanel outcome={outcome} /> : null}
      </div>
    </div>
  );
}

interface OutcomePanelProps {
  readonly outcome: ContactSendOutcome;
}

function OutcomePanel({ outcome }: OutcomePanelProps) {
  if (outcome.kind === 'sent') {
    const confirmed = outcome.delivery === 'confirmed';
    return (
      <div className={confirmed ? 'sa-outcome sa-outcome--ok' : 'sa-outcome sa-outcome--warn'}>
        <p className="sa-outcome__message">
          {confirmed ? 'Message sent. ' : 'Message submitted, delivery unconfirmed. '}
          {outcome.message}
        </p>
        {confirmed ? null : (
          <p className="sa-outcome__warning">
            The node accepted the message for relay but did not (yet) confirm it in its chat store.
            Retrying is not recommended immediately, because it can duplicate the message.
          </p>
        )}
        <TechnicalDetails outcome={outcome} />
      </div>
    );
  }

  if (outcome.kind === 'ambiguous') {
    return (
      <div className="sa-outcome sa-outcome--warn">
        <p className="sa-outcome__message">Send result unknown.</p>
        <p className="sa-outcome__warning">{outcome.message}</p>
        <TechnicalDetails outcome={outcome} />
      </div>
    );
  }

  if (outcome.kind === 'rejected') {
    return (
      <div className="sa-outcome sa-outcome--error">
        <p className="sa-outcome__message">Not sent.</p>
        <p>{outcome.message}</p>
        <TechnicalDetails outcome={outcome} />
      </div>
    );
  }

  return (
    <div className="sa-outcome sa-outcome--error">
      <p className="sa-outcome__message">Not sent.</p>
      <p>{outcome.message}</p>
      <TechnicalDetails outcome={outcome} />
    </div>
  );
}

/**
 * Diagnostics only: identifiers that help a visitor and the owner reason about a
 * submission. Never the message body, never a recipient address or public key.
 */
function TechnicalDetails({ outcome }: { readonly outcome: ContactSendOutcome }) {
  const signature = outcome.kind === 'sent' ? outcome.submission.signature : null;
  const timestamp = outcome.kind === 'sent' ? outcome.submission.timestamp : null;

  if (!signature && timestamp === null) return null;

  return (
    <details className="sa-contact__details">
      <summary>Technical details</summary>
      <dl>
        {signature ? (
          <div>
            <dt>Chat message signature</dt>
            <dd>
              <code>{signature}</code>
            </dd>
          </div>
        ) : null}
        {timestamp !== null ? (
          <div>
            <dt>Signed at</dt>
            <dd>{new Date(timestamp).toISOString()}</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}
