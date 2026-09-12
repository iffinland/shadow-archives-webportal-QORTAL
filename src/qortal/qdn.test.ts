import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildQdnResourcePath,
  buildSameOriginSearchPath,
  buildSameOriginStatusPath,
  fetchQdnResourceText,
  getQdnResourceStatus,
  getQdnResourceUrl,
  searchQdnResources,
  toBridgeSearchParams,
  toSameOriginSearchQuery,
} from './qdn';

function installBridge(impl: (payload: Record<string, unknown>) => unknown) {
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

describe('toBridgeSearchParams', () => {
  it('emits the exact camelCase bridge field names, not the REST query names', () => {
    const payload = toBridgeSearchParams({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
      prefix: true,
      exactMatchNames: true,
      defaultResource: true,
      mode: 'ALL',
      minLevel: 0,
      includeStatus: true,
      includeMetadata: true,
      nameListFilter: 'blocked',
      followedOnly: false,
      excludeBlocked: true,
      before: 10,
      after: 1,
      limit: 20,
      offset: 40,
      reverse: true,
    });

    expect(payload).toEqual({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
      prefix: true,
      exactMatchNames: true,
      default: true,
      mode: 'ALL',
      minLevel: 0,
      includeStatus: true,
      includeMetadata: true,
      nameListFilter: 'blocked',
      followedOnly: false,
      excludeBlocked: true,
      before: 10,
      after: 1,
      limit: 20,
      offset: 40,
      reverse: true,
    });

    // The lowercase REST spellings must never leak through: passing them to the
    // bridge is silently ignored and would break discovery.
    for (const restName of [
      'exactmatchnames',
      'namelistfilter',
      'includestatus',
      'includemetadata',
      'minlevel',
      'followedonly',
      'excludeblocked',
    ]) {
      expect(payload).not.toHaveProperty(restName);
    }
  });

  it('omits undefined fields instead of sending blanks', () => {
    expect(toBridgeSearchParams({ service: 'DOCUMENT' })).toEqual({ service: 'DOCUMENT' });
    expect(toBridgeSearchParams({})).toEqual({});
  });

  it('renames defaultResource to the bridge `default` field only when supplied', () => {
    expect(toBridgeSearchParams({ defaultResource: false })).toEqual({ default: false });
    expect(toBridgeSearchParams({})).not.toHaveProperty('default');
  });
});

describe('buildQdnResourcePath', () => {
  it('mirrors the verified non-link buildResourceUrl shape', () => {
    expect(
      buildQdnResourcePath({ service: 'IMAGE', name: 'Shadow Archives', identifier: 'x' }),
    ).toBe('/arbitrary/IMAGE/Shadow%20Archives/x');
  });

  it('omits the identifier for default resources and appends a filepath', () => {
    expect(buildQdnResourcePath({ service: 'IMAGE', name: 'Name', identifier: null })).toBe(
      '/arbitrary/IMAGE/Name',
    );
    expect(
      buildQdnResourcePath({ service: 'THUMBNAIL', name: 'Name', identifier: 'i' }, 'sub/dir.png'),
    ).toBe('/arbitrary/THUMBNAIL/Name/i?filepath=sub%2Fdir.png');
  });
});

describe('bridge read primitives', () => {
  it('passes the mapped search fields through the bridge verbatim', async () => {
    const bridge = installBridge(() => []);
    await searchQdnResources({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      prefix: true,
      mode: 'ALL',
      limit: 20,
    });

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledWith({
      action: 'SEARCH_QDN_RESOURCES',
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      prefix: true,
      mode: 'ALL',
      limit: 20,
    });
  });

  it('rejects a non-array search response instead of coercing it', async () => {
    installBridge(() => ({ unexpected: true }));
    await expect(searchQdnResources({ service: 'DOCUMENT' })).rejects.toThrow(/array/i);
  });

  it('fetches a resource as text with service/name/identifier only', async () => {
    const bridge = installBridge(() => '{"ok":true}');
    const text = await fetchQdnResourceText({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
    });
    expect(text).toBe('{"ok":true}');
    expect(bridge).toHaveBeenCalledWith({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
    });
  });

  it('omits a null identifier when fetching a default resource', async () => {
    const bridge = installBridge(() => 'body');
    await fetchQdnResourceText({ service: 'DOCUMENT', name: 'Name', identifier: null });
    expect(bridge).toHaveBeenCalledWith({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name: 'Name',
    });
  });

  it('returns the status object from GET_QDN_RESOURCE_STATUS', async () => {
    const bridge = installBridge(() => ({ status: 'PUBLISHED', id: 1 }));
    const status = await getQdnResourceStatus({ service: 'DOCUMENT', name: 'Name' });
    expect(status).toEqual({ status: 'PUBLISHED', id: 1 });
    expect(bridge).toHaveBeenCalledWith({
      action: 'GET_QDN_RESOURCE_STATUS',
      service: 'DOCUMENT',
      name: 'Name',
    });
  });

  it('returns a non-empty URL and forwards the optional filepath', async () => {
    const bridge = installBridge(() => '/arbitrary/IMAGE/Name/i');
    const url = await getQdnResourceUrl({
      service: 'IMAGE',
      name: 'Name',
      identifier: 'i',
      path: 'thumb.webp',
    });
    expect(url).toBe('/arbitrary/IMAGE/Name/i');
    expect(bridge).toHaveBeenCalledWith({
      action: 'GET_QDN_RESOURCE_URL',
      service: 'IMAGE',
      name: 'Name',
      identifier: 'i',
      path: 'thumb.webp',
    });
  });

  it('rejects an empty URL response', async () => {
    installBridge(() => '');
    await expect(getQdnResourceUrl({ service: 'IMAGE', name: 'Name' })).rejects.toThrow();
  });

  it('never authenticates while performing read actions', async () => {
    const bridge = installBridge(() => []);
    await searchQdnResources({ service: 'DOCUMENT' });
    for (const call of bridge.mock.calls) {
      expect(call[0]).not.toHaveProperty('action', 'GET_USER_ACCOUNT');
    }
  });
});

describe('same-origin REST query mapping', () => {
  it('emits the lowercase REST names, never the camelCase bridge names', () => {
    const query = toSameOriginSearchQuery({
      service: 'DOCUMENT',
      exactMatchNames: true,
      defaultResource: true,
      includeStatus: true,
      includeMetadata: true,
      nameListFilter: 'DEFAULT',
      followedOnly: false,
      excludeBlocked: true,
      minLevel: 1,
    });
    const params = new URLSearchParams(query);

    expect(params.get('exactmatchnames')).toBe('true');
    expect(params.get('default')).toBe('true');
    expect(params.get('includestatus')).toBe('true');
    expect(params.get('includemetadata')).toBe('true');
    expect(params.get('namefilter')).toBe('DEFAULT');
    expect(params.get('followedonly')).toBe('false');
    expect(params.get('excludeblocked')).toBe('true');
    expect(params.get('minlevel')).toBe('1');

    for (const camel of [
      'exactMatchNames',
      'defaultResource',
      'includeStatus',
      'includeMetadata',
      'nameListFilter',
      'followedOnly',
      'excludeBlocked',
      'minLevel',
    ]) {
      expect(params.get(camel)).toBeNull();
    }
  });

  it('builds the verified shim paths', () => {
    expect(buildSameOriginSearchPath({ service: 'DOCUMENT' })).toBe(
      '/arbitrary/resources/search?service=DOCUMENT',
    );
    expect(
      buildSameOriginStatusPath({
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: 'saw_x',
      }),
    ).toBe('/arbitrary/resource/status/DOCUMENT/Shadow%20Archives/saw_x');
    expect(buildSameOriginStatusPath({ service: 'DOCUMENT', name: 'Shadow Archives' })).toBe(
      '/arbitrary/resource/status/DOCUMENT/Shadow%20Archives',
    );
  });
});
