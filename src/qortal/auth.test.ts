import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  encodeNameForLookup,
  getAccountNames,
  getNameData,
  getPrimaryName,
  getSessionAccount,
  requestAccount,
  resetAuthSession,
  resolvePublisherOwnership,
  retryAccount,
} from './auth';

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

beforeEach(() => {
  resetAuthSession();
});

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('requestAccount', () => {
  it('shares one in-flight GET_USER_ACCOUNT between concurrent callers', async () => {
    let resolveBridge: ((value: unknown) => void) | undefined;
    const bridge = installBridge(
      () =>
        new Promise((resolve) => {
          resolveBridge = resolve;
        }),
    );

    const first = requestAccount();
    const second = requestAccount();

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge.mock.calls[0][0]).toEqual({ action: 'GET_USER_ACCOUNT' });

    resolveBridge?.({ address: 'QAddress', publicKey: 'PublicKey' });

    await expect(first).resolves.toEqual({ address: 'QAddress', publicKey: 'PublicKey' });
    await expect(second).resolves.toEqual({ address: 'QAddress', publicKey: 'PublicKey' });
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it('caches the granted account for the session', async () => {
    const bridge = installBridge(() => Promise.resolve({ address: 'QAddress', publicKey: 'K' }));

    await requestAccount();
    await requestAccount();

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(getSessionAccount()).toEqual({ address: 'QAddress', publicKey: 'K' });
  });

  it('caches a rejection for the session and never retries automatically', async () => {
    const bridge = installBridge(() => Promise.reject(new Error('user declined request')));

    await expect(requestAccount()).rejects.toMatchObject({ kind: 'rejected' });
    await expect(requestAccount()).rejects.toMatchObject({ kind: 'rejected' });

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(getSessionAccount()).toBeNull();
  });

  it('supports an explicit later retry after a rejection', async () => {
    let attempt = 0;
    const bridge = installBridge(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('user declined request'))
        : Promise.resolve({ address: 'QAddress', publicKey: 'K' });
    });

    await expect(requestAccount()).rejects.toMatchObject({ kind: 'rejected' });
    await expect(retryAccount()).resolves.toEqual({ address: 'QAddress', publicKey: 'K' });

    expect(bridge).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a malformed account response and keeps it cached', async () => {
    const bridge = installBridge(() => Promise.resolve({ address: 'QAddress' }));

    await expect(requestAccount()).rejects.toMatchObject({ kind: 'malformed' });
    await expect(requestAccount()).rejects.toMatchObject({ kind: 'malformed' });

    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it('reports a missing bridge as unavailable', async () => {
    await expect(requestAccount()).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('getAccountNames', () => {
  it('parses the verified NameSummary[] shape and keeps every name separate', async () => {
    const bridge = installBridge(() =>
      Promise.resolve([
        { name: 'Shadow Archives', owner: 'QOwner' },
        { name: 'Second Name', owner: 'QOwner' },
      ]),
    );

    await expect(getAccountNames('QAddress')).resolves.toEqual([
      { name: 'Shadow Archives', owner: 'QOwner' },
      { name: 'Second Name', owner: 'QOwner' },
    ]);
    expect(bridge.mock.calls[0][0]).toEqual({
      action: 'GET_ACCOUNT_NAMES',
      address: 'QAddress',
    });
  });

  it('treats a valid empty list as "no names"', async () => {
    installBridge(() => Promise.resolve([]));
    await expect(getAccountNames('QAddress')).resolves.toEqual([]);
  });

  it('tolerates a bare string entry without inventing an owner', async () => {
    installBridge(() => Promise.resolve(['Shadow Archives']));
    await expect(getAccountNames('QAddress')).resolves.toEqual([
      { name: 'Shadow Archives', owner: '' },
    ]);
  });

  it('fails closed on non-array or malformed entries', async () => {
    installBridge(() => Promise.resolve({ name: 'Shadow Archives' }));
    await expect(getAccountNames('QAddress')).rejects.toMatchObject({ kind: 'malformed' });

    resetAuthSession();
    installBridge(() => Promise.resolve([{ name: 42 }]));
    await expect(getAccountNames('QAddress')).rejects.toMatchObject({ kind: 'malformed' });
  });
});

describe('getNameData', () => {
  it('re-encodes the name for the node path and returns the current owner', async () => {
    const bridge = installBridge(() =>
      Promise.resolve({ name: 'Shadow Archives', owner: 'QOwner' }),
    );

    await expect(getNameData('Shadow Archives')).resolves.toEqual({
      name: 'Shadow Archives',
      owner: 'QOwner',
    });
    expect(bridge.mock.calls[0][0]).toEqual({
      action: 'GET_NAME_DATA',
      name: 'Shadow%20Archives',
    });
  });

  it('returns null when the owner claim is missing or malformed', async () => {
    installBridge(() => Promise.resolve({ name: 'Shadow Archives' }));
    await expect(getNameData('Shadow Archives')).resolves.toBeNull();
  });

  it('encodes reserved characters once', () => {
    expect(encodeNameForLookup('Shadow Archives')).toBe('Shadow%20Archives');
    expect(encodeNameForLookup('ShadowArchives')).toBe('ShadowArchives');
  });
});

describe('getPrimaryName', () => {
  it('reads the string shape returned by the host', async () => {
    installBridge(() => Promise.resolve('Shadow Archives'));
    await expect(getPrimaryName('QAddress')).resolves.toBe('Shadow Archives');
  });

  it('treats an empty string as no primary name', async () => {
    installBridge(() => Promise.resolve(''));
    await expect(getPrimaryName('QAddress')).resolves.toBeNull();
  });
});

describe('resolvePublisherOwnership', () => {
  const account = { address: 'QOwner', publicKey: 'K' };

  it('proves ownership when the current owner matches the account address', async () => {
    installBridge(() => Promise.resolve({ name: 'Shadow Archives', owner: 'QOwner' }));
    await expect(resolvePublisherOwnership('Shadow Archives', account)).resolves.toBe(true);
  });

  it('rejects ownership when the current owner differs', async () => {
    installBridge(() => Promise.resolve({ name: 'Shadow Archives', owner: 'QSomeoneElse' }));
    await expect(resolvePublisherOwnership('Shadow Archives', account)).resolves.toBe(false);
  });

  it('stays unknown when the name cannot be resolved', async () => {
    installBridge(() => Promise.reject(new Error('name unknown')));
    await expect(resolvePublisherOwnership('Shadow Archives', account)).resolves.toBeNull();
  });

  it('never becomes owner without a publisher name', async () => {
    const bridge = installBridge(() => Promise.resolve({ owner: 'QOwner' }));
    await expect(resolvePublisherOwnership(null, account)).resolves.toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });
});
