import { describe, expect, it } from 'vitest';

import {
  buildQortalAppUrl,
  isExternalHttpUrl,
  isQortalUrl,
  qortalAppIdFromName,
} from './navigation';

describe('buildQortalAppUrl', () => {
  it('builds the verified qortal://APP/<name> navigation URL', () => {
    expect(buildQortalAppUrl('Q-Tube')).toBe('qortal://APP/Q-Tube');
    expect(buildQortalAppUrl('SubWire')).toBe('qortal://APP/SubWire');
    expect(buildQortalAppUrl('Quitter')).toBe('qortal://APP/Quitter');
  });

  it('percent-encodes names that need it and supports an optional path', () => {
    expect(buildQortalAppUrl('Some App')).toBe('qortal://APP/Some%20App');
    expect(buildQortalAppUrl('Q-Tube', '/watch/abc')).toBe('qortal://APP/Q-Tube/watch/abc');
  });
});

describe('url classification', () => {
  it('recognises qortal:// links', () => {
    expect(isQortalUrl('qortal://APP/Q-Tube')).toBe(true);
    expect(isQortalUrl('/blog')).toBe(false);
    expect(isQortalUrl('https://example.org')).toBe(false);
  });

  it('recognises the Web2 links the platform blocks from inside a Q-App', () => {
    expect(isExternalHttpUrl('https://example.org/x')).toBe(true);
    expect(isExternalHttpUrl('//example.org/x')).toBe(true);
    expect(isExternalHttpUrl('/gallery')).toBe(false);
  });
});

describe('qortalAppIdFromName', () => {
  it('produces a stable, non-authoritative key from a published name', () => {
    expect(qortalAppIdFromName('Q-Tube')).toBe('qtube');
    expect(qortalAppIdFromName('SubWire')).toBe('subwire');
    expect(qortalAppIdFromName('Quitter')).toBe('quitter');
  });
});
