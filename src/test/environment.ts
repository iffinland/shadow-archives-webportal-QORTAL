import { deriveRuntimeState } from '../qortal/environment';
import type { QdnEnvironment } from '../qortal/types';

const BASE: QdnEnvironment = {
  bridgeAvailable: false,
  isHosted: false,
  hasQdnIdentity: false,
  runtimeState: 'plain-browser',
  context: null,
  isProxy: false,
  service: null,
  name: null,
  publisherName: null,
  identifier: null,
  path: null,
  lang: null,
  base: '',
  baseWithPath: null,
};

/**
 * Synthetic QDN environment for tests. Never a production data source.
 *
 * `runtimeState` and `isHosted` are derived from the other fields by default so
 * a fixture cannot accidentally claim a state that contradicts its own injected
 * values (for example a bridge-capable state with no `_qdn*` context). Pass them
 * explicitly only to test the state machine itself.
 */
export function makeEnvironment(overrides: Partial<QdnEnvironment> = {}): QdnEnvironment {
  const merged = { ...BASE, ...overrides };
  const isQortalFrame = merged.context !== null || merged.name !== null || merged.service !== null;
  return {
    ...merged,
    isHosted: overrides.isHosted ?? isQortalFrame,
    hasQdnIdentity: overrides.hasQdnIdentity ?? merged.publisherName !== null,
    runtimeState:
      overrides.runtimeState ??
      deriveRuntimeState({
        bridgeAvailable: merged.bridgeAvailable,
        isQortalFrame,
        isProxy: merged.isProxy,
      }),
  };
}
