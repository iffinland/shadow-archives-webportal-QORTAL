import { afterEach, describe, expect, it, vi } from 'vitest';

import { bridgePublishPort, type PublishResourceInput } from './publish';

const first: PublishResourceInput = {
  service: 'DOCUMENT',
  name: 'Shadow Archives',
  identifier: 'saw_post_first',
  data64: 'e30=',
};

const second: PublishResourceInput = {
  service: 'DOCUMENT',
  name: 'Shadow Archives',
  identifier: 'subwire_article_first',
  data64: 'e30=',
};

function installBridge(result: unknown): ReturnType<typeof vi.fn> {
  const bridge = vi.fn(async () => result);
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: bridge,
  });
  return bridge;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('bridgePublishPort grouped results', () => {
  it('reports Hub resolved partial failures instead of treating them as success', async () => {
    const bridge = installBridge({
      message: 'Some resources could not be published',
      error: {
        unsuccessfulPublishes: [
          {
            service: second.service,
            identifier: second.identifier,
            name: second.name,
            reason: 'resource rejected',
          },
        ],
      },
    });

    const result = await bridgePublishPort.publishResources([first, second]);

    expect(result).toMatchObject({
      kind: 'partial',
      submissions: [{ identifier: first.identifier, signature: null }],
      failures: [{ identifier: second.identifier, reason: 'resource rejected' }],
    });
    expect(bridge).toHaveBeenCalledWith({
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resources: [first, second],
    });
  });

  it('reports a resolved failure when Hub rejected every grouped resource', async () => {
    installBridge({
      error: {
        unsuccessfulPublishes: [
          { service: first.service, identifier: first.identifier, name: first.name, reason: 'fee' },
          {
            service: second.service,
            identifier: second.identifier,
            name: second.name,
            reason: 'fee',
          },
        ],
      },
    });

    const result = await bridgePublishPort.publishResources([first, second]);

    expect(result).toMatchObject({
      kind: 'failed',
      failures: [
        { identifier: first.identifier, reason: 'fee' },
        { identifier: second.identifier, reason: 'fee' },
      ],
    });
  });
});
