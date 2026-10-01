import { describe, expect, it, vi } from 'vitest';

import {
  publishComment,
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
      publishResource: vi.fn(async () => ({ kind: 'submitted', submissions: [] })),
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

  it('rejects an invalid amount before resolving a recipient or requesting payment', async () => {
    const service = deps();
    await expect(sendTip(target, 0, service)).resolves.toMatchObject({ kind: 'failed' });
    expect(service.getNameOwner).not.toHaveBeenCalled();
    expect(service.sendCoin).not.toHaveBeenCalled();
  });
});
