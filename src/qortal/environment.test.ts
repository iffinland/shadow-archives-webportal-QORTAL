import { describe, expect, it } from 'vitest';

import {
  decodeQdnName,
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
