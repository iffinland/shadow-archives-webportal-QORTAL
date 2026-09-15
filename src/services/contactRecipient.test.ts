import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEnvironment } from '../test/environment';
import {
  bridgeContactRecipientPorts,
  resolveContactRecipient,
  type ContactRecipientPorts,
} from './contactRecipient';

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const OWNER_PUBLIC_KEY = '2q9PKM4yBmqiZhx6q54wEFGJHUvfmddpbBQ8J6UXfDfv';
const PUBLISHER = 'Shadow Archives';

/** A hosted frame with the bridge reachable is the only send-capable context. */
const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: PUBLISHER,
});

function ports(overrides: Partial<ContactRecipientPorts> = {}): ContactRecipientPorts {
  return {
    resolveNameOwner: vi.fn(async () => OWNER),
    resolvePublicKey: vi.fn(async () => OWNER_PUBLIC_KEY),
    ...overrides,
  };
}

describe('resolveContactRecipient', () => {
  it('resolves the current owner of the injected publishing name and its public key', async () => {
    const fake = ports();
    const result = await resolveContactRecipient(HOSTED, fake);

    expect(result).toEqual({
      kind: 'resolved',
      recipient: { publisherName: PUBLISHER, address: OWNER, publicKey: OWNER_PUBLIC_KEY },
    });
    expect(fake.resolveNameOwner).toHaveBeenCalledWith(PUBLISHER);
    expect(fake.resolvePublicKey).toHaveBeenCalledWith(OWNER);
  });

  it('re-reads the name owner on every call so a name transfer is honoured', async () => {
    const resolveNameOwner = vi
      .fn<ContactRecipientPorts['resolveNameOwner']>()
      .mockResolvedValueOnce(OWNER)
      .mockResolvedValueOnce('QNewOwnerAddress000000000000000000000000');
    const fake = ports({ resolveNameOwner });

    const first = await resolveContactRecipient(HOSTED, fake);
    const second = await resolveContactRecipient(HOSTED, fake);

    expect(first.kind === 'resolved' && first.recipient.address).toBe(OWNER);
    expect(second.kind === 'resolved' && second.recipient.address).toBe(
      'QNewOwnerAddress000000000000000000000000',
    );
    expect(resolveNameOwner).toHaveBeenCalledTimes(2);
  });

  it('fails closed outside a Qortal frame', async () => {
    const fake = ports();
    const result = await resolveContactRecipient(makeEnvironment(), fake);

    expect(result.kind).toBe('unresolved');
    expect(result.kind === 'unresolved' && result.code).toBe('not-a-qortal-frame');
    expect(fake.resolveNameOwner).not.toHaveBeenCalled();
  });

  it('fails closed in the node development proxy', async () => {
    const result = await resolveContactRecipient(
      makeEnvironment({ isProxy: true, context: 'proxy', service: 'APP' }),
      ports(),
    );
    expect(result.kind === 'unresolved' && result.code).toBe('proxy-context');
  });

  it('fails closed when a published frame has no reachable host bridge', async () => {
    const result = await resolveContactRecipient(
      makeEnvironment({
        isHosted: true,
        context: 'render',
        service: 'APP',
        name: 'Shadow%20Archives',
        publisherName: PUBLISHER,
      }),
      ports(),
    );
    expect(result.kind === 'unresolved' && result.code).toBe('no-host-bridge');
  });

  it('fails closed when no publishing name was injected', async () => {
    const result = await resolveContactRecipient(
      makeEnvironment({ isHosted: true, bridgeAvailable: true, context: 'render', service: 'APP' }),
      ports(),
    );
    expect(result.kind === 'unresolved' && result.code).toBe('no-publisher-name');
  });

  it('reports a name lookup failure separately from a missing owner', async () => {
    const result = await resolveContactRecipient(
      HOSTED,
      ports({ resolveNameOwner: vi.fn(async () => null) }),
    );
    expect(result.kind === 'unresolved' && result.code).toBe('name-unresolved');
  });

  it('refuses to send when the resolved owner has no on-chain public key', async () => {
    const result = await resolveContactRecipient(
      HOSTED,
      ports({ resolvePublicKey: vi.fn(async () => null) }),
    );
    expect(result.kind === 'unresolved' && result.code).toBe('recipient-not-encryptable');
  });

  it('never resolves an owner from a hardcoded address when the name is missing', async () => {
    const fake = ports();
    await resolveContactRecipient(
      makeEnvironment({ isHosted: true, bridgeAvailable: true, context: 'render', service: 'APP' }),
      fake,
    );
    expect(fake.resolveNameOwner).not.toHaveBeenCalled();
    expect(fake.resolvePublicKey).not.toHaveBeenCalled();
  });
});

describe('bridgeContactRecipientPorts', () => {
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

  it('reads the name owner through GET_NAME_DATA with a URL-safe name', async () => {
    const bridge = installBridge((payload) => {
      expect(payload).toEqual({ action: 'GET_NAME_DATA', name: 'Shadow%20Archives' });
      return Promise.resolve({ name: PUBLISHER, owner: OWNER });
    });

    await expect(bridgeContactRecipientPorts.resolveNameOwner(PUBLISHER)).resolves.toBe(OWNER);
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it('reads the public key through GET_ACCOUNT_DATA', async () => {
    const bridge = installBridge((payload) => {
      expect(payload).toEqual({ action: 'GET_ACCOUNT_DATA', address: OWNER });
      return Promise.resolve({ address: OWNER, publicKey: OWNER_PUBLIC_KEY });
    });

    await expect(bridgeContactRecipientPorts.resolvePublicKey(OWNER)).resolves.toBe(
      OWNER_PUBLIC_KEY,
    );
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it('reports an absent public key (not a malformed value) as null', async () => {
    installBridge(() => Promise.resolve({ address: OWNER, publicKey: null }));
    await expect(bridgeContactRecipientPorts.resolvePublicKey(OWNER)).resolves.toBeNull();
  });

  it('returns null instead of throwing when the bridge is unavailable', async () => {
    await expect(bridgeContactRecipientPorts.resolveNameOwner(PUBLISHER)).resolves.toBeNull();
    await expect(bridgeContactRecipientPorts.resolvePublicKey(OWNER)).resolves.toBeNull();
  });
});
