import { describe, expect, it } from 'vitest';

import { deriveCapability, isOwner } from './capability';
import type { CapabilityInput } from './types';
import { makeEnvironment } from '../test/environment';

const account = { address: 'QAddress123', publicKey: 'pubkey' };

function input(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    environment: makeEnvironment({ bridgeAvailable: true, isHosted: true, context: 'app' }),
    permission: 'idle',
    account: null,
    ownsPublisherName: null,
    ownsAnyName: null,
    ...overrides,
  };
}

describe('deriveCapability', () => {
  it('is unknown without a bridge (plain browser)', () => {
    expect(deriveCapability(input({ environment: makeEnvironment() }))).toBe('unknown');
  });

  it('is unknown in the dev proxy even though a bridge exists', () => {
    expect(
      deriveCapability(
        input({
          environment: makeEnvironment({ bridgeAvailable: true, context: 'proxy', isProxy: true }),
        }),
      ),
    ).toBe('unknown');
  });

  it('is unknown while auth is idle or pending — layout never guesses', () => {
    expect(deriveCapability(input({ permission: 'idle' }))).toBe('unknown');
    expect(deriveCapability(input({ permission: 'pending' }))).toBe('unknown');
  });

  it('is visitor when permission was rejected, even with an account present', () => {
    expect(deriveCapability(input({ permission: 'rejected', account }))).toBe('visitor');
  });

  it('is visitor when permission was granted but no account came back', () => {
    expect(deriveCapability(input({ permission: 'granted', account: null }))).toBe('visitor');
  });

  it('is owner only when the connected address provably owns the publisher name', () => {
    expect(
      deriveCapability(input({ permission: 'granted', account, ownsPublisherName: true })),
    ).toBe('owner');
  });

  it('is authenticated-non-owner when the ownership check fails', () => {
    expect(
      deriveCapability(input({ permission: 'granted', account, ownsPublisherName: false })),
    ).toBe('authenticated-non-owner');
  });

  it('is authenticated-no-name when the account owns no registered name', () => {
    expect(
      deriveCapability(
        input({ permission: 'granted', account, ownsPublisherName: null, ownsAnyName: false }),
      ),
    ).toBe('authenticated-no-name');
  });

  it('never reports owner optimistically', () => {
    expect(isOwner(deriveCapability(input()))).toBe(false);
    expect(isOwner(deriveCapability(input({ permission: 'granted', account })))).toBe(false);
  });
});
