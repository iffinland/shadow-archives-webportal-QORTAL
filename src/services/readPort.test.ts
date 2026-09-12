import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEnvironment } from '../test/environment';
import { bridgeQdnReadPort } from './qdnReader';
import { getSameOriginResourceStatus, resolveQdnReadPort, sameOriginQdnReadPort } from './readPort';

const PUBLISHED_RENDER_NO_BRIDGE = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
});

const HOST_WITH_BRIDGE = makeEnvironment({ ...PUBLISHED_RENDER_NO_BRIDGE, bridgeAvailable: true });

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function installFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveQdnReadPort', () => {
  it('uses the bridge when one is reachable', () => {
    expect(resolveQdnReadPort(HOST_WITH_BRIDGE)).toBe(bridgeQdnReadPort);
  });

  it('falls back to same-origin REST in a published render context without a bridge', () => {
    expect(resolveQdnReadPort(PUBLISHED_RENDER_NO_BRIDGE)).toBe(sameOriginQdnReadPort);
  });

  it('does not fall back in a plain browser (fails closed as unavailable)', () => {
    expect(resolveQdnReadPort(makeEnvironment())).toBe(bridgeQdnReadPort);
  });

  it('does not fall back in the dev proxy', () => {
    expect(
      resolveQdnReadPort(makeEnvironment({ context: 'proxy', isProxy: true, service: 'APP' })),
    ).toBe(bridgeQdnReadPort);
  });
});

describe('sameOriginQdnReadPort', () => {
  it('searches the verified shim REST route with lowercase parameters', async () => {
    const fetchMock = installFetch(() =>
      jsonResponse([{ service: 'DOCUMENT', name: 'Shadow Archives' }]),
    );

    const hits = await sameOriginQdnReadPort.search({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      exactMatchNames: true,
      mode: 'ALL',
      reverse: true,
      limit: 5,
      identifier: 'saw_post_abc',
    });

    expect(hits).toHaveLength(1);
    const [rawPath] = fetchMock.mock.calls[0] as unknown as [string];
    const [path, query] = rawPath.split('?');
    expect(path).toBe('/arbitrary/resources/search');
    const params = new URLSearchParams(query);
    expect(params.get('service')).toBe('DOCUMENT');
    expect(params.get('name')).toBe('Shadow Archives');
    expect(params.get('exactmatchnames')).toBe('true');
    expect(params.get('mode')).toBe('ALL');
    expect(params.get('reverse')).toBe('true');
    expect(params.get('limit')).toBe('5');
    expect(params.get('identifier')).toBe('saw_post_abc');
    // CamelCase bridge names must never leak into the REST namespace.
    expect(params.get('exactMatchNames')).toBeNull();
  });

  it('supports the default-resource search and repeated names', async () => {
    const fetchMock = installFetch(() => jsonResponse([]));

    await sameOriginQdnReadPort.search({
      service: 'DOCUMENT',
      names: ['Shadow Archives', 'Other Name'],
      defaultResource: true,
    });

    const [rawPath] = fetchMock.mock.calls[0] as unknown as [string];
    const params = new URLSearchParams(rawPath.split('?')[1]);
    expect(params.get('default')).toBe('true');
    expect(params.getAll('name')).toEqual(['Shadow Archives', 'Other Name']);
  });

  it('fetches a resource over the same-origin arbitrary route', async () => {
    const fetchMock = installFetch(() => jsonResponse('{"schemaVersion":1}'));

    const text = await sameOriginQdnReadPort.fetchText({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
    });

    expect(text).toBe('{"schemaVersion":1}');
    const [rawPath] = fetchMock.mock.calls[0] as unknown as [string];
    expect(rawPath).toBe('/arbitrary/DOCUMENT/Shadow%20Archives/saw_post_abc');
  });

  it('treats an error payload as a failure instead of empty content', async () => {
    installFetch(() => jsonResponse({ error: 'Resource does not exist' }));
    await expect(sameOriginQdnReadPort.search({ service: 'DOCUMENT' })).rejects.toMatchObject({
      kind: 'error',
      message: 'Resource does not exist',
    });
  });

  it('treats an empty body as malformed, never as valid empty content', async () => {
    installFetch(() => jsonResponse(''));
    await expect(
      sameOriginQdnReadPort.fetchText({ service: 'DOCUMENT', name: 'Shadow Archives' }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('classifies a non-OK response as a network error', async () => {
    installFetch(() => jsonResponse({ error: 'nope' }, 503));
    await expect(sameOriginQdnReadPort.search({ service: 'DOCUMENT' })).rejects.toMatchObject({
      kind: 'error',
    });
  });

  it('classifies a non-array search body as malformed', async () => {
    installFetch(() => jsonResponse({ not: 'an array' }));
    await expect(sameOriginQdnReadPort.search({ service: 'DOCUMENT' })).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('honours the bounded deadline as a timeout', async () => {
    installFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(
      sameOriginQdnReadPort.search({ service: 'DOCUMENT' }, { timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('fails closed when the runtime provides no fetch', async () => {
    vi.stubGlobal('fetch', undefined);
    await expect(sameOriginQdnReadPort.search({ service: 'DOCUMENT' })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('reads resource status over the verified status route', async () => {
    const fetchMock = installFetch(() => jsonResponse({ status: 'READY' }));
    const status = await getSameOriginResourceStatus({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
    });
    expect(status).toEqual({ status: 'READY' });
    const [rawPath] = fetchMock.mock.calls[0] as unknown as [string];
    expect(rawPath).toBe('/arbitrary/resource/status/DOCUMENT/Shadow%20Archives/saw_post_abc');
  });
});
