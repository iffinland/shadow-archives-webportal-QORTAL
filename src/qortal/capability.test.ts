import { describe, expect, it } from 'vitest';

import { deriveCapability, isOwner } from './capability';
import type { CapabilityInput } from './types';
import { makeEnvironment } from '../test/environment';

const account = { address: 'QAddress123', publicKey: 'pubkey' };
const hosted = { bridgeAvailable: true, isHosted: true, context: 'app' };

function input(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    environment: makeEnvironment(hosted),
    permission: 'idle',
    account: null,
    ownsPublisherName: null,
    ownsAnyName: null,
    ownershipResolved: false,
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

  it('is unknown while idle, before any explicit owner action', () => {
    expect(deriveCapability(input({ permission: 'idle' }))).toBe('unknown');
  });

  it('reports the requested transient states rather than guessing', () => {
    expect(deriveCapability(input({ permission: 'pending' }))).toBe('requesting-permission');
    expect(
      deriveCapability(input({ permission: 'granted', account, ownershipResolved: false })),
    ).toBe('resolving-ownership');
  });

  it('keeps a declined permission distinct from an unauthenticated visitor', () => {
    expect(deriveCapability(input({ permission: 'rejected', account }))).toBe('permission-denied');
  });

  it('reports a host/bridge failure as error, never as visitor', () => {
    expect(deriveCapability(input({ permission: 'unavailable' }))).toBe('error');
  });

  it('is visitor when permission was granted but no account came back', () => {
    expect(
      deriveCapability(input({ permission: 'granted', account: null, ownershipResolved: true })),
    ).toBe('visitor');
  });

  it('is owner only when the connected address provably owns the publisher name', () => {
    expect(
      deriveCapability(
        input({
          permission: 'granted',
          account,
          ownsPublisherName: true,
          ownsAnyName: true,
          ownershipResolved: true,
        }),
      ),
    ).toBe('owner');
  });

  it('is authenticated-non-owner when the account owns names but not the publisher name', () => {
    expect(
      deriveCapability(
        input({
          permission: 'granted',
          account,
          ownsPublisherName: false,
          ownsAnyName: true,
          ownershipResolved: true,
        }),
      ),
    ).toBe('authenticated-non-owner');
  });

  it('is authenticated-no-name when the account owns no registered name', () => {
    expect(
      deriveCapability(
        input({
          permission: 'granted',
          account,
          ownsPublisherName: false,
          ownsAnyName: false,
          ownershipResolved: true,
        }),
      ),
    ).toBe('authenticated-no-name');
  });

  it('never reports owner when ownership is unknown after resolution', () => {
    const state = deriveCapability(
      input({
        permission: 'granted',
        account,
        ownsPublisherName: null,
        ownsAnyName: true,
        ownershipResolved: true,
      }),
    );
    expect(state).toBe('unknown');
    expect(isOwner(state)).toBe(false);
  });

  it('never reports owner when the publisher name is missing', () => {
    const environment = makeEnvironment({ ...hosted, publisherName: null, name: null });
    expect(
      isOwner(
        deriveCapability(
          input({
            environment,
            permission: 'granted',
            account,
            ownsPublisherName: null,
            ownsAnyName: true,
            ownershipResolved: true,
          }),
        ),
      ),
    ).toBe(false);
  });

  it('never reports owner optimistically', () => {
    expect(isOwner(deriveCapability(input()))).toBe(false);
    expect(
      isOwner(deriveCapability(input({ permission: 'granted', account, ownershipResolved: true }))),
    ).toBe(false);
  });
});
