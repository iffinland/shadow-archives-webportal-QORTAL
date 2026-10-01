/**
 * Qortal private chat (direct CHAT message) transport.
 *
 * VERIFIED CONTRACT — re-verified 2026-09-14 against the pinned upstream
 * revisions in the workspace standard, not from memory:
 *
 * - Core `108bf191` (v6.1.9)
 *   - `Q-Apps.md`: `SEND_CHAT_MESSAGE` with `destinationAddress` + `message`
 *     "requires user approval"; `SEARCH_CHAT_MESSAGES` is a public read and
 *     takes either `txGroupId` or exactly two `involving` addresses.
 *   - `src/main/resources/q-apps/q-apps.js`: `SEND_CHAT_MESSAGE` is NOT handled
 *     in the frame — it falls through to the `default` branch, which marks the
 *     request `requestedHandler: "UI"` and forwards it to the host. Its default
 *     action timeout is 60 s (proof-of-work). `SEARCH_CHAT_MESSAGES` IS handled
 *     in the frame as `GET /chat/messages`.
 *   - `src/main/java/org/qortal/transaction/ChatTransaction.java`: direct chat
 *     data is capped at `MAX_DATA_SIZE = 4000` bytes (the encrypted blob), and
 *     `isConfirmable()` is `false`, so a CHAT transaction never enters a block.
 *   - `src/main/java/org/qortal/api/resource/TransactionsResource.java`
 *     (`/transactions/process`): a CHAT transaction is delegated to
 *     `ChatTransactionDelegate` and the marshalled `TransactionData` (with its
 *     base58 `signature` and a `creatorAddress` sender field) is returned as
 *     `text/plain` JSON. That is an acceptance acknowledgment, NOT a delivery or
 *     confirmation. `ChatTransaction.isConfirmable()` is `false`, so a CHAT
 *     transaction never enters a block: no endpoint can ever "confirm" one.
 *   - `src/main/java/org/qortal/api/resource/ChatResource.java` +
 *     `ChatTransactionDelegate.getMessagesMatchingCriteria`: `involving` must be
 *     exactly two addresses and matches messages where BOTH are sender/recipient,
 *     over the delegate's in-memory validated chats, so a just-sent direct
 *     message is visible to its own sender+recipient pair.
 * - Hub `12a573b2`
 *   - `src/hooks/useQortalMessageListener.tsx` / `src/qortal/qortal-requests.ts`:
 *     the whole flat request object is forwarded as `payload`; the host is the
 *     only party that signs, and it opens an approval dialog unless the user has
 *     previously chosen "always allow chat messages from this app".
 *   - `src/qortal/get.ts` `sendChatMessage`: reads `data.message`,
 *     `data.fullMessageObject || data.fullContent`, `data.destinationAddress ||
 *     data.recipient`, `data.groupId` and `data.chatReference`. For a direct
 *     message it resolves the recipient public key itself from
 *     `/addresses/publickey/{address}` (so the app MUST NOT send a key), refuses
 *     when the recipient has no public key on chain, refuses when the sender
 *     holds less than `MIN_REQUIRED_QORTS` (4 QORT), wraps a bare `message`
 *     string into the legacy `{messageText: <tiptap doc>, images: [], repliedTo:
 *     '', version: 3}` object, and encrypts with ed2curve + nacl secretbox
 *     before submitting `POST /transactions/process?apiVersion=2`.
 * - `qapp-core` `0f9d6ac` `src/types/qortalRequests/interfaces.ts`:
 *   `SendChatMessageQortalRequest` accepts `recipient` as an alias of
 *   `destinationAddress`; the app sends the documented `destinationAddress`.
 *
 * This module is the ONLY place allowed to call `SEND_CHAT_MESSAGE` or
 * `SEARCH_CHAT_MESSAGES`. It is deliberately NOT re-exported from `qortal/index.ts`
 * so the chat transport stays out of the visitor startup graph.
 */

import { QortalAction, WRITE_ACTIONS } from './actions';
import { QortalBridgeError, request, type RequestOptions } from './bridge';
import { isRecord } from '../domain/validation';

/**
 * Core's own default timeout for `SEND_CHAT_MESSAGE` (`q-apps.js`), which the
 * injected shim applies to the request it returns to us.
 */
export const CHAT_SEND_ACTION_TIMEOUT_MS = 60 * 1000;

/**
 * Our own backstop deadline. It is intentionally longer than the shim's action
 * timeout so the shim's own (more specific) timeout surfaces first; a custom
 * and shorter deadline here would report a timeout while the host might still be
 * waiting for the user's approval.
 */
export const CHAT_SEND_TIMEOUT_MS = 75 * 1000;

/** Bounded deadline for one read-back attempt. */
export const CHAT_READ_TIMEOUT_MS = 20 * 1000;

/** Bounded read-back page size; only our own signature is looked for. */
export const CHAT_READ_LIMIT = 50;

/** Exact payload accepted by the host for one direct private message. */
export interface PrivateChatMessageInput {
  /** Recipient Qortal address. The host resolves the encryption key itself. */
  readonly recipientAddress: string;
  /** Plain-text body. The host wraps and encrypts it; never HTML. */
  readonly message: string;
}

/**
 * Acknowledged submission. `signature` is the CHAT transaction signature the
 * host returned; it is a submission identifier, not a delivery receipt.
 */
export interface ChatSubmission {
  readonly signature: string | null;
  /** Sender address reported by the node (`creatorAddress`), when present. */
  readonly sender: string | null;
  readonly recipient: string | null;
  readonly timestamp: number | null;
  /** Raw host result, retained for diagnostics without private content. */
  readonly raw: unknown;
}

/**
 * Outcome of one `SEND_CHAT_MESSAGE` attempt.
 *
 * - `submitted` — the host returned a transaction result.
 * - `ambiguous` — the request timed out; the send may or may not have happened.
 *   It must never be retried automatically.
 * - `rejected` — the user declined the host approval dialog, or the host
 *   refused before signing.
 * - `failed` — the call failed before anything was signed or relayed.
 */
export type ChatSendAttempt =
  | { readonly kind: 'submitted'; readonly submission: ChatSubmission }
  | { readonly kind: 'ambiguous'; readonly error: QortalBridgeError }
  | { readonly kind: 'rejected'; readonly error: QortalBridgeError }
  | { readonly kind: 'failed'; readonly error: QortalBridgeError };

/** The send boundary the Contact service depends on; tests inject a fake. */
export interface ChatSendPort {
  send(message: PrivateChatMessageInput, options?: RequestOptions): Promise<ChatSendAttempt>;
}

/**
 * One bounded read of recent direct-chat signatures between two addresses.
 *
 * `null` means "the read could not be used to prove anything" (unavailable,
 * malformed, unparsable); an empty array means "read succeeded, nothing there".
 * Only signatures are read: private message content is never fetched or logged.
 */
export interface ChatReadPort {
  recentMessageSignatures(
    query: { readonly sender: string; readonly recipient: string },
    options?: RequestOptions,
  ): Promise<readonly string[] | null>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function submissionFrom(raw: unknown): ChatSubmission {
  const record = isRecord(raw) ? raw : {};
  return {
    signature: readNonEmptyString(record.signature),
    /*
     * `/transactions/process?apiVersion=2` marshals the CHAT `TransactionData`
     * itself (`TransactionsResource.processTransaction` → `ApiRequest.marshall`),
     * and the sender is exposed there as `creatorAddress`
     * (`TransactionData.getCreatorAddress()`: `Crypto.toAddress(creatorPublicKey)`,
     * annotated `@XmlElement(name = "creatorAddress")`). `creatorPublicKey` is
     * `@XmlTransient`, and there is no `sender` field on that object — reading
     * `sender` alone would silently disable the read-back confirmation forever.
     * `sender` is kept as a fallback for hosts that echo the chat shape.
     */
    sender: readNonEmptyString(record.creatorAddress) ?? readNonEmptyString(record.sender),
    recipient: readNonEmptyString(record.recipient),
    timestamp: readFiniteNumber(record.timestamp),
    raw,
  };
}

/**
 * A user decline reaches the app as the host's localized error text (Hub
 * `question:message.generic.user_declined_send_message` → "user declined to send
 * message"), so the bridge classifier's `rejected` kind is the truthful bucket.
 * Everything else before a signature is a genuine failure.
 */
export const bridgeChatSendPort: ChatSendPort = {
  async send(message, options) {
    try {
      const raw = await request<unknown>(
        WRITE_ACTIONS.SEND_CHAT_MESSAGE,
        {
          destinationAddress: message.recipientAddress,
          message: message.message,
        },
        { timeoutMs: options?.timeoutMs ?? CHAT_SEND_TIMEOUT_MS, signal: options?.signal },
      );
      return { kind: 'submitted', submission: submissionFrom(raw) };
    } catch (error) {
      const bridgeError =
        error instanceof QortalBridgeError
          ? error
          : new QortalBridgeError('error', 'Chat send failed', WRITE_ACTIONS.SEND_CHAT_MESSAGE);

      if (bridgeError.kind === 'timeout') return { kind: 'ambiguous', error: bridgeError };
      if (bridgeError.kind === 'rejected') return { kind: 'rejected', error: bridgeError };
      return { kind: 'failed', error: bridgeError };
    }
  },
};

/**
 * Read-back of the node's own direct-chat list.
 *
 * This proves only that the local node has the message in its (short-lived)
 * chat store. It never decrypts or returns message content — a caller only ever
 * looks for its own signature.
 */
export const bridgeChatReadPort: ChatReadPort = {
  async recentMessageSignatures(query, options) {
    try {
      const raw = await request<unknown>(
        QortalAction.SEARCH_CHAT_MESSAGES,
        {
          involving: [query.sender, query.recipient],
          encoding: 'BASE64',
          limit: CHAT_READ_LIMIT,
          reverse: true,
        },
        { timeoutMs: options?.timeoutMs ?? CHAT_READ_TIMEOUT_MS, signal: options?.signal },
      );
      if (!Array.isArray(raw)) return null;
      const signatures: string[] = [];
      for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const signature = readNonEmptyString(entry.signature);
        if (signature) signatures.push(signature);
      }
      return signatures;
    } catch {
      return null;
    }
  },
};
