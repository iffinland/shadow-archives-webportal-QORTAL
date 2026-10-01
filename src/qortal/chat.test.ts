import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bridgeChatReadPort,
  bridgeChatSendPort,
  CHAT_READ_LIMIT,
  CHAT_SEND_TIMEOUT_MS,
} from './chat';

const RECIPIENT = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const SENDER = 'QSenderAddressForTests000000000000000000';
const SIGNATURE =
  '4mcxe32QbR1QBUDVXNqx2kq8uH1AqRxiSV1SbeF48q5Vvwi3ohHXGd3FLf79RyA2QuQoJMPXvFrxfkDkPA1QBU9e';

type BridgeImpl = (payload: Record<string, unknown>) => unknown;

function installBridge(impl: BridgeImpl) {
  const mock = vi.fn(impl);
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
  return mock;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('bridgeChatSendPort', () => {
  it('sends the exact verified host payload for a direct private message', async () => {
    // Realistic `/transactions/process?apiVersion=2` CHAT response: the marshalled
    // TransactionData, i.e. `creatorAddress` (NOT `sender`) carries the sender.
    const bridge = installBridge(() =>
      Promise.resolve({
        type: 'CHAT',
        signature: SIGNATURE,
        creatorAddress: SENDER,
        recipient: RECIPIENT,
        timestamp: 1_789_000_000_000,
        txGroupId: 0,
        approvalStatus: 'NOT_REQUIRED',
      }),
    );

    const attempt = await bridgeChatSendPort.send({
      recipientAddress: RECIPIENT,
      message: 'hello from a visitor',
    });

    // The host reads `data.destinationAddress || data.recipient` and
    // `data.message`; nothing else is sent, and no key is supplied by us.
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge.mock.calls[0][0]).toEqual({
      action: 'SEND_CHAT_MESSAGE',
      destinationAddress: RECIPIENT,
      message: 'hello from a visitor',
    });

    expect(attempt.kind).toBe('submitted');
    expect(attempt.kind === 'submitted' && attempt.submission).toEqual({
      signature: SIGNATURE,
      sender: SENDER,
      recipient: RECIPIENT,
      timestamp: 1_789_000_000_000,
      raw: expect.any(Object),
    });
  });

  it('still reads a sender the host reports as `sender`', async () => {
    installBridge(() => Promise.resolve({ signature: SIGNATURE, sender: SENDER }));
    const attempt = await bridgeChatSendPort.send({ recipientAddress: RECIPIENT, message: 'hi' });
    expect(attempt.kind === 'submitted' && attempt.submission.sender).toBe(SENDER);
  });

  it('accepts a submission acknowledgment without a signature but never invents one', async () => {
    installBridge(() => Promise.resolve({ type: 'CHAT' }));
    const attempt = await bridgeChatSendPort.send({ recipientAddress: RECIPIENT, message: 'hi' });
    expect(attempt.kind === 'submitted' && attempt.submission.signature).toBeNull();
    expect(attempt.kind === 'submitted' && attempt.submission.sender).toBeNull();
  });

  it('classifies the injected shim timeout as ambiguous, never as failure or success', async () => {
    installBridge(() => Promise.reject('The request timed out'));
    const attempt = await bridgeChatSendPort.send({ recipientAddress: RECIPIENT, message: 'hi' });
    expect(attempt.kind).toBe('ambiguous');
    expect(attempt.kind === 'ambiguous' && attempt.error.kind).toBe('timeout');
  });

  it('classifies a declined host approval dialog as rejected before send', async () => {
    installBridge(() =>
      Promise.reject({
        error: 'user declined to send message',
        message: 'user declined to send message',
      }),
    );
    const attempt = await bridgeChatSendPort.send({ recipientAddress: RECIPIENT, message: 'hi' });
    expect(attempt.kind).toBe('rejected');
  });

  it('classifies a missing bridge as a failed send, not a rejection', async () => {
    const attempt = await bridgeChatSendPort.send({ recipientAddress: RECIPIENT, message: 'hi' });
    expect(attempt.kind).toBe('failed');
    expect(attempt.kind === 'failed' && attempt.error.kind).toBe('unavailable');
  });

  it('reports a host error (for example insufficient balance) as failed', async () => {
    installBridge(() => Promise.reject({ error: 'you need at least 4 QORT to send a message' }));
    const attempt = await bridgeChatSendPort.send({ recipientAddress: RECIPIENT, message: 'hi' });
    expect(attempt.kind).toBe('failed');
  });

  it('uses a backstop deadline longer than the shim action timeout so the shim wins', () => {
    expect(CHAT_SEND_TIMEOUT_MS).toBeGreaterThan(60 * 1000);
  });
});

describe('bridgeChatReadPort', () => {
  it('reads only signatures for the exact two-address pair', async () => {
    const bridge = installBridge((payload) => {
      expect(payload).toEqual({
        action: 'SEARCH_CHAT_MESSAGES',
        involving: [SENDER, RECIPIENT],
        encoding: 'BASE64',
        limit: CHAT_READ_LIMIT,
        reverse: true,
      });
      return Promise.resolve([
        { signature: 'other-signature', isEncrypted: true, data: 'ciphertext' },
        { signature: SIGNATURE, isEncrypted: true, data: 'ciphertext' },
      ]);
    });

    await expect(
      bridgeChatReadPort.recentMessageSignatures({ sender: SENDER, recipient: RECIPIENT }),
    ).resolves.toEqual(['other-signature', SIGNATURE]);
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when the read succeeded but nothing matched', async () => {
    installBridge(() => Promise.resolve([]));
    await expect(
      bridgeChatReadPort.recentMessageSignatures({ sender: SENDER, recipient: RECIPIENT }),
    ).resolves.toEqual([]);
  });

  it('returns null (unprovable) for a malformed response or a read failure', async () => {
    installBridge(() => Promise.resolve({ unexpected: 'shape' }));
    await expect(
      bridgeChatReadPort.recentMessageSignatures({ sender: SENDER, recipient: RECIPIENT }),
    ).resolves.toBeNull();

    installBridge(() => Promise.reject({ error: 'boom' }));
    await expect(
      bridgeChatReadPort.recentMessageSignatures({ sender: SENDER, recipient: RECIPIENT }),
    ).resolves.toBeNull();
  });
});

describe('startup graph boundary', () => {
  it('is not re-exported from the shared qortal barrel', async () => {
    // The visitor startup graph must not pull the chat transport in. Anything
    // that needs it imports `qortal/chat` directly and lazily.
    const barrel = (await import('./index')) as Record<string, unknown>;
    for (const name of [
      'bridgeChatSendPort',
      'bridgeChatReadPort',
      'CHAT_SEND_TIMEOUT_MS',
      'CHAT_READ_TIMEOUT_MS',
    ]) {
      expect(Object.keys(barrel)).not.toContain(name);
    }
  });

  it('declares no transport other than private chat for this flow', async () => {
    const { WRITE_ACTIONS, PERMISSIONED_ACTIONS, PUBLIC_READ_ACTIONS } = await import('./actions');
    // No public-chat, Q-Mail, group-chat or QDN fallback action exists in this
    // app's vocabulary; a future transport must be a deliberate addition.
    expect(
      Object.values({ ...WRITE_ACTIONS, ...PERMISSIONED_ACTIONS, ...PUBLIC_READ_ACTIONS }),
    ).not.toContain('QMAIL_SEND');
    expect(Object.values(WRITE_ACTIONS)).toEqual([
      'PUBLISH_QDN_RESOURCE',
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      'SEND_CHAT_MESSAGE',
    ]);
  });
});
