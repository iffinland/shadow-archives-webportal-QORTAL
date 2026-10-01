import { describe, expect, it } from 'vitest';

import {
  CHAT_DATA_MAX_BYTES,
  CHAT_ENVELOPE_MAX_BYTES,
  CONTACT_MESSAGE_BYTE_BUDGET,
  CONTACT_MESSAGE_MAX_LENGTH,
  contactEnvelopeBytes,
  validateContactMessage,
} from './contactMessage';

describe('validateContactMessage', () => {
  it('trims surrounding whitespace and reports the encoded envelope size', () => {
    const result = validateContactMessage('  hello owner  ');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe('hello owner');
    expect(result.ok && result.bytes).toBe(contactEnvelopeBytes('hello owner'));
  });

  it('rejects an empty or whitespace-only draft', () => {
    for (const draft of ['', '   ', '\n\t ']) {
      const result = validateContactMessage(draft);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.code).toBe('empty');
    }
  });

  it('rejects a draft over the product character bound', () => {
    const result = validateContactMessage('a'.repeat(CONTACT_MESSAGE_MAX_LENGTH + 1));
    expect(!result.ok && result.code).toBe('too-long');
  });

  it('keeps the byte budget inside the encrypted chat data cap', () => {
    // Envelope budget = Core's encrypted-data cap minus the secretbox overhead.
    expect(CHAT_ENVELOPE_MAX_BYTES).toBe(CHAT_DATA_MAX_BYTES - 16);
    expect(CONTACT_MESSAGE_BYTE_BUDGET).toBeGreaterThan(1500);
  });

  it('accounts for JSON escaping rather than assuming character count equals bytes', () => {
    const plain = 'x'.repeat(1200);
    const escaped = '"'.repeat(1200);
    expect(contactEnvelopeBytes(escaped)).toBeGreaterThan(contactEnvelopeBytes(plain));
  });

  it('rejects a draft whose encoded envelope cannot fit, even under the character bound', () => {
    // Each quote becomes two bytes inside the JSON string, so this fits the
    // character bound but not the encrypted byte budget.
    const result = validateContactMessage('"'.repeat(CONTACT_MESSAGE_MAX_LENGTH));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('too-large');
  });

  it('accepts the exact byte budget boundary', () => {
    // Binary search for the largest accepted single-byte-character body.
    let low = 1;
    let high = CONTACT_MESSAGE_MAX_LENGTH;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const result = validateContactMessage('a'.repeat(mid));
      if (result.ok) low = mid;
      else high = mid - 1;
    }
    expect(validateContactMessage('a'.repeat(low)).ok).toBe(true);
    expect(validateContactMessage('a'.repeat(low + 1)).ok).toBe(false);
    expect(contactEnvelopeBytes('a'.repeat(low))).toBeLessThanOrEqual(CHAT_ENVELOPE_MAX_BYTES);
  });

  it('does not transform the body, so markup stays plain text', () => {
    const markup = '<script>alert(1)</script>';
    const result = validateContactMessage(markup);
    expect(result.ok && result.value).toBe(markup);
  });

  it('counts multi-byte characters in bytes, not characters', () => {
    const emoji = '🙂'.repeat(1000);
    expect(contactEnvelopeBytes(emoji)).toBeGreaterThan(contactEnvelopeBytes('a'.repeat(1000)));
  });
});
