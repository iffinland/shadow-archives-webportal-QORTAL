/**
 * Contact send orchestration: draft -> validated message -> freshly resolved
 * recipient -> private-chat transport -> truthful outcome.
 *
 * Rules enforced here (not in the React form):
 * - the recipient is resolved fresh on every attempt, so a name transfer between
 *   page load and send cannot silently message the previous owner;
 * - validation happens before any approval prompt is raised;
 * - a submitted message is only reported as `confirmed` when the node's own chat
 *   read-back shows the returned signature, otherwise it stays `submitted`;
 * - an ambiguous (timed-out) send is NEVER retried automatically, and never
 *   reported as success or failure;
 * - nothing falls back to public chat, QDN, Q-Mail or any other transport.
 */

import {
  bridgeChatReadPort,
  bridgeChatSendPort,
  type ChatReadPort,
  type ChatSendPort,
  type ChatSubmission,
} from '../qortal/chat';
import { QortalBridgeError } from '../qortal/bridge';
import type { QdnEnvironment } from '../qortal/types';
import { validateContactMessage } from './contactMessage';
import { resolveContactRecipient, type ContactRecipientResult } from './contactRecipient';

/** Bounded read-back polling after a submitted send. */
export const CONTACT_VERIFY_ATTEMPTS = 3;
export const CONTACT_VERIFY_DELAY_MS = 1500;

export type ContactSendFailureCode =
  | 'invalid-message'
  | 'recipient-unresolved'
  | 'recipient-not-encryptable'
  | 'bridge-unavailable'
  | 'insufficient-balance'
  | 'too-many-pending'
  | 'send-failed';

export type ContactSendOutcome =
  | {
      readonly kind: 'sent';
      /** `confirmed` = the node's chat list returned our signature; `submitted` = accepted only. */
      readonly delivery: 'submitted' | 'confirmed';
      readonly submission: ChatSubmission;
      readonly message: string;
    }
  | { readonly kind: 'ambiguous'; readonly message: string; readonly error: QortalBridgeError }
  | { readonly kind: 'rejected'; readonly message: string; readonly error: QortalBridgeError }
  | {
      readonly kind: 'failed';
      readonly code: ContactSendFailureCode;
      readonly message: string;
      readonly error: QortalBridgeError | null;
    };

export interface ContactSendDeps {
  /** Resolves the current owner of the app's publishing name. */
  readonly resolveRecipient: () => Promise<ContactRecipientResult>;
  readonly send: ChatSendPort;
  readonly read: ChatReadPort;
  /** Test seams. */
  readonly wait?: (ms: number) => Promise<void>;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Production dependency graph: real bridge reads and the real chat transport. */
export function createContactSendDeps(environment: QdnEnvironment): ContactSendDeps {
  return {
    resolveRecipient: () => resolveContactRecipient(environment),
    send: bridgeChatSendPort,
    read: bridgeChatReadPort,
  };
}

const INSUFFICIENT_BALANCE_PATTERN = /at least\s+[\d.]+\s*qort/i;
const REQUIRED_QORTS_PATTERN = /qortals_required/i;
const PUBLIC_KEY_PATTERN = /publickey|public key/i;
/**
 * Core `ChatTransaction.isValid` rejects with `TOO_MANY_UNCONFIRMED` once the
 * sender's recent unconfirmed CHAT count reaches `maxRecentChatMessagesPerAccount`
 * ("account has too many unconfirmed transactions pending",
 * `TransactionValidity_en.properties` revision 108bf191). The limit and its
 * window (`recentChatMessagesMaxAge`, 1 h on the owner nodes) are node settings,
 * so the copy must not promise a number.
 */
const TOO_MANY_PENDING_PATTERN = /too many unconfirmed|too_many_unconfirmed/i;

/**
 * Map a host/bridge failure onto truthful, actionable copy. The host error text
 * is used only for classification; the message shown to the visitor is ours.
 */
export function describeFailedSend(error: QortalBridgeError): {
  readonly code: ContactSendFailureCode;
  readonly message: string;
} {
  if (error.kind === 'unavailable') {
    return {
      code: 'bridge-unavailable',
      message:
        'The Qortal host bridge is not reachable from this frame, so the message could not be sent. Open the published app inside the Qortal Hub and try again.',
    };
  }

  const text = `${error.message} ${typeof error.detail === 'string' ? error.detail : ''}`;
  if (INSUFFICIENT_BALANCE_PATTERN.test(text) || REQUIRED_QORTS_PATTERN.test(text)) {
    return {
      code: 'insufficient-balance',
      message:
        'Qortal private chat messages are relayed with proof-of-work and your active account needs at least 4 QORT to send one. Nothing was sent.',
    };
  }
  if (PUBLIC_KEY_PATTERN.test(text)) {
    return {
      code: 'recipient-not-encryptable',
      message:
        'The recipient has no public key on chain, so an encrypted private chat message cannot be addressed to them. Nothing was sent.',
    };
  }
  if (TOO_MANY_PENDING_PATTERN.test(text)) {
    return {
      code: 'too-many-pending',
      message:
        'Your account already has as many unconfirmed chat messages pending as this node allows, so this one was not accepted. Nothing was sent. Wait for the earlier messages to expire and try again.',
    };
  }
  return {
    code: 'send-failed',
    message: `The message could not be sent: ${error.message}`,
  };
}

async function verifyPresence(
  submission: ChatSubmission,
  recipientAddress: string,
  deps: ContactSendDeps,
): Promise<boolean> {
  const signature = submission.signature;
  const sender = submission.sender;
  // Without a signature or the node-reported sender address there is nothing to
  // prove against, so the result stays "submitted" rather than guessing.
  if (!signature || !sender) return false;

  const wait = deps.wait ?? defaultWait;
  for (let attempt = 0; attempt < CONTACT_VERIFY_ATTEMPTS; attempt += 1) {
    const signatures = await deps.read.recentMessageSignatures({
      sender,
      recipient: recipientAddress,
    });
    if (signatures?.includes(signature)) return true;
    if (attempt < CONTACT_VERIFY_ATTEMPTS - 1) await wait(CONTACT_VERIFY_DELAY_MS);
  }
  return false;
}

/**
 * Send one contact message and report the outcome truthfully.
 *
 * The returned outcome is the ONLY thing the UI may report; there is no
 * optimistic success path and no automatic retry anywhere in this function.
 */
export async function sendContactMessage(
  draft: string,
  deps: ContactSendDeps,
): Promise<ContactSendOutcome> {
  const validation = validateContactMessage(draft);
  if (!validation.ok) {
    return { kind: 'failed', code: 'invalid-message', message: validation.message, error: null };
  }

  const resolved = await deps.resolveRecipient();
  if (resolved.kind === 'unresolved') {
    const code: ContactSendFailureCode =
      resolved.code === 'recipient-not-encryptable'
        ? 'recipient-not-encryptable'
        : 'recipient-unresolved';
    return { kind: 'failed', code, message: resolved.message, error: null };
  }

  const recipientAddress = resolved.recipient.address;
  const attempt = await deps.send.send({ recipientAddress, message: validation.value });

  if (attempt.kind === 'ambiguous') {
    return {
      kind: 'ambiguous',
      message:
        'The send timed out, so it is not known whether the message was relayed. It may have been sent. Check with the owner before sending again — retrying may duplicate the message.',
      error: attempt.error,
    };
  }

  if (attempt.kind === 'rejected') {
    return {
      kind: 'rejected',
      message: 'The send was declined in your Qortal host, so nothing was sent.',
      error: attempt.error,
    };
  }

  if (attempt.kind === 'failed') {
    const described = describeFailedSend(attempt.error);
    return { ...described, kind: 'failed', error: attempt.error };
  }

  const confirmed = await verifyPresence(attempt.submission, recipientAddress, deps);
  return {
    kind: 'sent',
    delivery: confirmed ? 'confirmed' : 'submitted',
    submission: attempt.submission,
    message: confirmed
      ? 'Your message was accepted and is present in the private chat relay. The owner has not necessarily read it yet.'
      : 'Your message was submitted to the node and accepted for relay, but delivery to the owner is not confirmed. The owner may not have seen it.',
  };
}
