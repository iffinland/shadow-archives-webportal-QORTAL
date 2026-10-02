import { describe, expect, it, vi } from 'vitest';

import {
  publishComment,
  readEngagementCounts,
  sendTip,
  setLike,
  type EngagementDeps,
  type EngagementTarget,
} from './engagementService';

const target: EngagementTarget = {
  kind: 'post',
  entityIdentifier: 'saw_post_abc123def456',
  publisherName: 'Shadow Archives',
  title: 'Archive note',
};

function deps(): EngagementDeps {
  return {
    publish: {
      publishResource: vi.fn(async () => ({ kind: 'submitted' as const, submissions: [] })),
      publishResources: vi.fn(),
    },
    getNameOwner: vi.fn(async () => ({ name: 'Shadow Archives', owner: 'Qabc' })),
    sendCoin: vi.fn(async () => ({ signature: 'tip-signature' })),
  };
}

describe('engagement service', () => {
  it('writes one name-scoped active-like record with the exact content target', async () => {
    const service = deps();
    await setLike(target, 'Reader Name', true, service);

    expect(service.publish.publishResource).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'DOCUMENT',
        name: 'Reader Name',
        identifier: 'saw_lk_post_abc123def456',
        tags: ['saw_active'],
      }),
    );
  });

  it('writes comments as independent, non-empty QDN records', async () => {
    const service = deps();
    await publishComment(target, 'Reader Name', 'A useful note.', service);

    expect(service.publish.publishResource).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'DOCUMENT',
        name: 'Reader Name',
        identifier: expect.stringMatching(/^saw_cmt_post_abc123def456_[a-z0-9]{8}$/),
        description: 'A useful note.',
      }),
    );
  });

  it('sends a user-entered QORT amount to the current publisher-name owner', async () => {
    const service = deps();
    await expect(sendTip(target, 0.25, service)).resolves.toMatchObject({
      kind: 'submitted',
      recipient: 'Qabc',
      amount: 0.25,
    });
    expect(service.sendCoin).toHaveBeenCalledWith({
      coin: 'QORT',
      recipient: 'Qabc',
      amount: 0.25,
    });
  });

  it('does not claim a tip was sent when Hub returns no transaction signature', async () => {
    const service: EngagementDeps = { ...deps(), sendCoin: vi.fn(async () => ({})) };
    await expect(sendTip(target, 0.25, service)).resolves.toMatchObject({ kind: 'failed' });
  });

  it('counts active likes and QDN comments from their canonical resource namespaces', async () => {
    const reader = {
      search: vi.fn(async (request: { identifier?: string }) =>
        request.identifier?.startsWith('saw_lk_')
          ? [
              { service: 'DOCUMENT', name: 'Reader One', identifier: 'saw_lk_post_abc123def456' },
              { service: 'DOCUMENT', name: 'Reader Two', identifier: 'saw_lk_post_abc123def456' },
            ]
          : [
              {
                service: 'DOCUMENT',
                name: 'Reader One',
                identifier: 'saw_cmt_post_abc123def456_a1b2c3d4',
              },
              {
                service: 'DOCUMENT',
                name: 'Reader Two',
                identifier: 'saw_cmt_post_abc123def456_e5f6g7h8',
              },
            ],
      ),
      fetchText: vi.fn(async (ref: { name: string }) =>
        JSON.stringify({
          kind: 'like-state',
          state: ref.name === 'Reader One' ? 'active' : 'inactive',
          target: { name: 'Shadow Archives', identifier: 'saw_post_abc123def456' },
        }),
      ),
    };

    await expect(readEngagementCounts(target, { reader })).resolves.toEqual({
      likes: 1,
      comments: 2,
    });
  });

  it('rejects an invalid amount before resolving a recipient or requesting payment', async () => {
    const service = deps();
    await expect(sendTip(target, 0, service)).resolves.toMatchObject({ kind: 'failed' });
    expect(service.getNameOwner).not.toHaveBeenCalled();
    expect(service.sendCoin).not.toHaveBeenCalled();
  });
});
