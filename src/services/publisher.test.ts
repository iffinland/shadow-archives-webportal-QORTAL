import { describe, expect, it } from 'vitest';

import { makeEnvironment } from '../test/environment';
import { UNSCOPED_MESSAGES, resolvePublisherScope, unscopedMessage } from './publisher';

/** The exact `_qdn*` values observed in the owner's published runtime. */
const PUBLISHED_RENDER_NO_BRIDGE = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
  baseWithPath: '/render/APP/Shadow%20Archives',
});

const PUBLISHED_RENDER_WITH_BRIDGE = makeEnvironment({
  ...PUBLISHED_RENDER_NO_BRIDGE,
  bridgeAvailable: true,
});

describe('resolvePublisherScope', () => {
  it('establishes the publishing identity from _qdnName without any bridge', () => {
    expect(PUBLISHED_RENDER_NO_BRIDGE.bridgeAvailable).toBe(false);
    expect(resolvePublisherScope(PUBLISHED_RENDER_NO_BRIDGE)).toEqual({
      scoped: true,
      name: 'Shadow Archives',
      service: 'APP',
    });
  });

  it('scopes identically with and without the bridge', () => {
    expect(resolvePublisherScope(PUBLISHED_RENDER_NO_BRIDGE)).toEqual(
      resolvePublisherScope(PUBLISHED_RENDER_WITH_BRIDGE),
    );
  });

  it('does not scope a plain browser and says so distinctly', () => {
    expect(resolvePublisherScope(makeEnvironment())).toEqual({
      scoped: false,
      reason: 'no-qortal-context',
    });
  });

  it('does not scope the node development proxy', () => {
    expect(
      resolvePublisherScope(
        makeEnvironment({ bridgeAvailable: true, isProxy: true, context: 'proxy', service: 'APP' }),
      ),
    ).toEqual({ scoped: false, reason: 'proxy-context' });
  });

  it('reports a Qortal frame that injected no name separately from a plain browser', () => {
    expect(resolvePublisherScope(makeEnvironment({ context: 'render', service: 'APP' }))).toEqual({
      scoped: false,
      reason: 'no-publisher-name',
    });
  });

  it('never treats an anonymous bridge as a publisher identity', () => {
    expect(resolvePublisherScope(makeEnvironment({ bridgeAvailable: true }))).toEqual({
      scoped: false,
      reason: 'no-publisher-name',
    });
  });
});

describe('unscoped messaging', () => {
  it('never claims a missing publisher identity for a published render context', () => {
    // The published runtime is scoped, so no unscoped message is ever shown; the
    // remaining reasons must still be truthful and distinct.
    expect(unscopedMessage('no-qortal-context')).toMatch(/not running inside a Qortal runtime/i);
    expect(unscopedMessage('proxy-context')).toMatch(/development proxy/i);
    expect(unscopedMessage('no-publisher-name')).toMatch(/no publishing name was injected/i);
  });

  it('no longer contains the misleading single message', () => {
    for (const message of Object.values(UNSCOPED_MESSAGES)) {
      expect(message).not.toContain('No production Qortal publisher identity is available');
    }
  });
});
