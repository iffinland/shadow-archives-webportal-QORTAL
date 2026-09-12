import { describe, expect, it } from 'vitest';

import {
  decodeQdnName,
  deriveRuntimeState,
  getRouterBasename,
  hasQortalBridge,
  readQdnEnvironment,
} from './environment';

function fakeWindow(values: Record<string, unknown>): Window {
  return values as unknown as Window;
}

describe('decodeQdnName', () => {
  it('decodes Core percent-encoding for names containing spaces', () => {
    expect(decodeQdnName('Shadow%20Archives')).toBe('Shadow Archives');
  });

  it('leaves a malformed escape sequence unchanged instead of throwing', () => {
    expect(decodeQdnName('Shadow%2')).toBe('Shadow%2');
  });

  it('returns null for empty input', () => {
    expect(decodeQdnName('')).toBeNull();
    expect(decodeQdnName(null)).toBeNull();
  });
});

/**
 * The exact injected values reported by the owner's published APP, with no
 * reachable bridge. This is a real published read-only runtime: it must not be
 * classified as a plain browser, and `_qdnName` must still yield the publisher.
 */
function observedPublishedRenderWithoutBridge(): Window {
  return fakeWindow({
    _qdnContext: 'render',
    _qdnService: 'APP',
    _qdnName: 'Shadow%20Archives',
    _qdnIdentifier: '',
    _qdnBase: '/render/APP/Shadow%20Archives',
    _qdnBaseWithPath: '/render/APP/Shadow%20Archives',
  });
}

describe('readQdnEnvironment', () => {
  it('reports an unhosted plain browser as bridge-less', () => {
    const environment = readQdnEnvironment(fakeWindow({}));
    expect(environment.bridgeAvailable).toBe(false);
    expect(environment.isHosted).toBe(false);
    expect(environment.publisherName).toBeNull();
    expect(environment.base).toBe('');
  });

  it('reads a hosted APP context and keeps both raw and decoded names', () => {
    const environment = readQdnEnvironment(
      fakeWindow({
        qortalRequest: () => Promise.resolve(),
        _qdnContext: 'app',
        _qdnService: 'APP',
        _qdnName: 'Shadow%20Archives',
        _qdnIdentifier: 'shadow-archives',
        _qdnBase: '/render/APP/Shadow%20Archives',
        _qdnLang: 'en',
      }),
    );

    expect(environment.bridgeAvailable).toBe(true);
    expect(environment.isHosted).toBe(true);
    expect(environment.name).toBe('Shadow%20Archives');
    expect(environment.publisherName).toBe('Shadow Archives');
    expect(environment.service).toBe('APP');
    expect(environment.base).toBe('/render/APP/Shadow%20Archives');
  });

  it('flags the node dev-proxy context (and therefore unknown capability)', () => {
    const environment = readQdnEnvironment(
      fakeWindow({ qortalRequest: () => Promise.resolve(), _qdnContext: 'proxy' }),
    );
    expect(environment.isProxy).toBe(true);
    expect(environment.publisherName).toBeNull();
  });
});

describe('hasQortalBridge / getRouterBasename', () => {
  it('detects a bridge function only when one is actually callable', () => {
    expect(hasQortalBridge(fakeWindow({}))).toBe(false);
    expect(hasQortalBridge(fakeWindow({ qortalRequest: 'nope' }))).toBe(false);
    expect(hasQortalBridge(fakeWindow({ qortalRequest: () => undefined }))).toBe(true);
  });

  it('uses _qdnBase as the router basename and empty string outside a host', () => {
    expect(getRouterBasename(fakeWindow({ _qdnBase: '/render/APP/Shadow%20Archives' }))).toBe(
      '/render/APP/Shadow%20Archives',
    );
    expect(getRouterBasename(fakeWindow({}))).toBe('');
  });
});

describe('explicit runtime state', () => {
  it('A. plain browser — no injected _qdn* and no bridge', () => {
    const environment = readQdnEnvironment(fakeWindow({}));
    expect(environment.runtimeState).toBe('plain-browser');
    expect(environment.isHosted).toBe(false);
    expect(environment.hasQdnIdentity).toBe(false);
  });

  it('B. published render context without a bridge stays a Qortal runtime', () => {
    const environment = readQdnEnvironment(observedPublishedRenderWithoutBridge());
    expect(environment.runtimeState).toBe('qortal-render-readonly');
    expect(environment.bridgeAvailable).toBe(false);
    expect(environment.isHosted).toBe(true);
    expect(environment.hasQdnIdentity).toBe(true);
    expect(environment.service).toBe('APP');
    expect(environment.context).toBe('render');
    expect(environment.name).toBe('Shadow%20Archives');
    expect(environment.publisherName).toBe('Shadow Archives');
    expect(environment.base).toBe('/render/APP/Shadow%20Archives');
    // The injected `_qdnIdentifier=""` means the default resource, not a gap.
    expect(environment.identifier).toBeNull();
  });

  it('C. render context with a bridge is bridge-capable', () => {
    const environment = readQdnEnvironment(
      fakeWindow({
        qortalRequest: () => Promise.resolve(),
        _qdnContext: 'render',
        _qdnService: 'APP',
        _qdnName: 'Shadow%20Archives',
        _qdnBase: '/render/APP/Shadow%20Archives',
      }),
    );
    expect(environment.runtimeState).toBe('qortal-host');
    expect(environment.bridgeAvailable).toBe(true);
  });

  it('never collapses B into A', () => {
    const plain = readQdnEnvironment(fakeWindow({}));
    const published = readQdnEnvironment(observedPublishedRenderWithoutBridge());
    expect(plain.runtimeState).not.toBe(published.runtimeState);
    expect(plain.isHosted).not.toBe(published.isHosted);
    expect(published.publisherName).not.toBeNull();
    expect(plain.publisherName).toBeNull();
  });

  it('keeps a bridge without injected identity separate from a published host', () => {
    const environment = readQdnEnvironment(fakeWindow({ qortalRequest: () => Promise.resolve() }));
    expect(environment.runtimeState).toBe('qortal-bridge-unidentified');
    expect(environment.hasQdnIdentity).toBe(false);
  });

  it('reports the dev proxy state even with a bridge', () => {
    const environment = readQdnEnvironment(
      fakeWindow({
        qortalRequest: () => Promise.resolve(),
        _qdnContext: 'proxy',
        _qdnService: 'APP',
      }),
    );
    expect(environment.runtimeState).toBe('qortal-dev-proxy');
  });
});

describe('deriveRuntimeState', () => {
  it('is a total function over the four inputs', () => {
    expect(
      deriveRuntimeState({ bridgeAvailable: false, isQortalFrame: false, isProxy: false }),
    ).toBe('plain-browser');
    expect(
      deriveRuntimeState({ bridgeAvailable: false, isQortalFrame: true, isProxy: false }),
    ).toBe('qortal-render-readonly');
    expect(deriveRuntimeState({ bridgeAvailable: true, isQortalFrame: true, isProxy: false })).toBe(
      'qortal-host',
    );
    expect(
      deriveRuntimeState({ bridgeAvailable: true, isQortalFrame: false, isProxy: false }),
    ).toBe('qortal-bridge-unidentified');
    expect(deriveRuntimeState({ bridgeAvailable: true, isQortalFrame: true, isProxy: true })).toBe(
      'qortal-dev-proxy',
    );
  });
});
