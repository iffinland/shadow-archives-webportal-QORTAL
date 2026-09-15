/**
 * Contact message model and validation.
 *
 * The Contact feature sends ONE plain-text chat body. There is no subject field:
 * the current private-chat contract (`SEND_CHAT_MESSAGE`) has no subject, and the
 * host wraps a bare `message` string into a single-paragraph legacy chat object
 * (Hub `12a573b2` `src/qortal/get.ts` `sendChatMessage`). Pretending otherwise
 * would either be invisible to the recipient or waste the size budget.
 *
 * Size bound: Core caps the ENCRYPTED chat data blob at
 * `ChatTransaction.MAX_DATA_SIZE = 4000` bytes (`qortal` `108bf191`). The host
 * encrypts the JSON envelope with nacl secretbox, which adds a 16-byte
 * authenticator, so the JSON envelope itself must fit in 3984 bytes. We rebuild
 * the host's exact envelope locally so an over-long message is refused before an
 * approval dialog and a failed submission.
 */

/** Core `ChatTransaction.MAX_DATA_SIZE` — the encrypted chat data cap. */
export const CHAT_DATA_MAX_BYTES = 4000;

/** `nacl.secretbox` overhead (Poly1305 authenticator) added by the host. */
export const CHAT_ENCRYPTION_OVERHEAD_BYTES = 16;

/** Maximum bytes available for the JSON envelope the host encrypts. */
export const CHAT_ENVELOPE_MAX_BYTES = CHAT_DATA_MAX_BYTES - CHAT_ENCRYPTION_OVERHEAD_BYTES;

/** Owner-facing product bound; the UI counts against this, not the byte cap. */
export const CONTACT_MESSAGE_MAX_LENGTH = 2000;

/**
 * JSON overhead of the host envelope with an empty body
 * (`{"messageText":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]},"images":[],"repliedTo":"","version":3}`).
 */
const ENVELOPE_OVERHEAD_BYTES = new TextEncoder().encode(
  JSON.stringify(hostMessageEnvelope('')),
).length;

/**
 * The exact object the current host builds when a Q-App sends only `message`.
 * Kept private to the module so callers validate against the real envelope
 * instead of an estimate.
 */
function hostMessageEnvelope(message: string): Record<string, unknown> {
  return {
    messageText: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        },
      ],
    },
    images: [],
    repliedTo: '',
    version: 3,
  };
}

/** UTF-8 byte length of the host's JSON envelope for `message`. */
export function contactEnvelopeBytes(message: string): number {
  return new TextEncoder().encode(JSON.stringify(hostMessageEnvelope(message))).length;
}

/** Bytes left for the message body once the envelope overhead is paid. */
export const CONTACT_MESSAGE_BYTE_BUDGET = CHAT_ENVELOPE_MAX_BYTES - ENVELOPE_OVERHEAD_BYTES;

export type ContactMessageValidation =
  | { readonly ok: true; readonly value: string; readonly bytes: number }
  | {
      readonly ok: false;
      readonly code: 'empty' | 'too-long' | 'too-large';
      readonly message: string;
    };

/**
 * Validate and normalize a draft body. Never mutates or escapes the text: the
 * body is transmitted as a JSON string field by the host, so it can never be
 * interpreted as markup by this app.
 */
export function validateContactMessage(raw: string): ContactMessageValidation {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, code: 'empty', message: 'Enter a message before sending.' };
  }
  if (value.length > CONTACT_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      code: 'too-long',
      message: `Messages are limited to ${CONTACT_MESSAGE_MAX_LENGTH} characters.`,
    };
  }
  const bytes = contactEnvelopeBytes(value);
  if (bytes > CHAT_ENVELOPE_MAX_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `That message is too long to send as a private chat message (${bytes} of ${CHAT_ENVELOPE_MAX_BYTES} bytes once encoded). Shorten it or split it into several messages.`,
    };
  }
  return { ok: true, value, bytes };
}
