import type { QdnEnvironment } from '../qortal/types';

const BASE: QdnEnvironment = {
  bridgeAvailable: false,
  isHosted: false,
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

/** Synthetic QDN environment for tests. Never a production data source. */
export function makeEnvironment(overrides: Partial<QdnEnvironment> = {}): QdnEnvironment {
  return { ...BASE, ...overrides };
}
