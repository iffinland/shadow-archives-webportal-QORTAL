import vm from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';

import { hasQortalBridge, resolveQortalRequest } from './bridgeGlobal';
import { readQdnEnvironment } from './environment';
import { request } from './bridge';

/**
 * The published-runtime defect this file protects against.
 *
 * Core `108bf191` (v6.1.9) `src/main/resources/q-apps/q-apps.js` declares the
 * bridge as a top-level `const` inside a **classic** script:
 *
 *     const qortalRequest = (request) => { ... };
 *
 * A top-level `const` in a classic script lands in the realm's global
 * *declarative* environment record. It is reachable as the bare identifier
 * `qortalRequest`, but it is NOT a property of `window`. Core never assigns
 * `window.qortalRequest` anywhere under `qortal/src/main/**`.
 *
 * `vm.runInThisContext` reproduces exactly those semantics in this realm, so a
 * detection that only checked `window.qortalRequest` would report "no bridge"
 * here — which is what the owner observed on the published APP.
 */

const CALLS_KEY = '__shadowArchivesBridgeGlobalCalls';
const calls: Record<string, unknown>[] = [];
(globalThis as unknown as Record<string, unknown>)[CALLS_KEY] = calls;

vm.runInThisContext(
  [
    'const qortalRequest = (request) => {',
    `  globalThis.${CALLS_KEY}.push(request);`,
    "  return Promise.resolve('ok');",
    '};',
  ].join('\n'),
);

function attachInjectedQdnContext(): () => void {
  const definitions: ReadonlyArray<readonly [string, string]> = [
    ['_qdnContext', 'render'],
    ['_qdnService', 'APP'],
    ['_qdnName', 'Shadow%20Archives'],
    ['_qdnBase', '/render/APP/Shadow%20Archives'],
    ['_qdnBaseWithPath', '/render/APP/Shadow%20Archives'],
    ['_qdnIdentifier', ''],
  ];
  for (const [key, value] of definitions) {
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key] of definitions) Reflect.deleteProperty(window, key);
  };
}

afterAll(() => {
  Reflect.deleteProperty(globalThis, CALLS_KEY);
});

describe('bridge resolution against the verified Core injection', () => {
  it('is not a window property, exactly as Core injects it', () => {
    expect((window as unknown as { qortalRequest?: unknown }).qortalRequest).toBeUndefined();
  });

  it('still resolves the global binding as a callable bridge', () => {
    const bridge = resolveQortalRequest(window);
    expect(typeof bridge).toBe('function');
    expect(hasQortalBridge(window)).toBe(true);
  });

  it('routes bridge requests through the global binding', async () => {
    calls.length = 0;
    const result = await request('SEARCH_QDN_RESOURCES', { service: 'DOCUMENT' });
    expect(result).toBe('ok');
    expect(calls).toEqual([{ action: 'SEARCH_QDN_RESOURCES', service: 'DOCUMENT' }]);
  });

  it('classifies the observed published render runtime as a bridge-capable host', () => {
    const detach = attachInjectedQdnContext();
    try {
      const environment = readQdnEnvironment(window);
      expect(environment.bridgeAvailable).toBe(true);
      expect(environment.isHosted).toBe(true);
      expect(environment.publisherName).toBe('Shadow Archives');
      expect(environment.runtimeState).toBe('qortal-host');
    } finally {
      detach();
    }
  });

  it('does not pick the global up for a synthetic window object', () => {
    const fake = {} as unknown as Window;
    expect(hasQortalBridge(fake)).toBe(false);
    expect(resolveQortalRequest(fake)).toBeNull();
  });
});
