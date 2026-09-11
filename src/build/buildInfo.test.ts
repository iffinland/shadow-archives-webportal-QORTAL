import { describe, expect, it } from 'vitest';

import { buildInfo, buildLabel } from './buildInfo';

describe('build identity', () => {
  it('exposes a semantic version and a commit identity', () => {
    expect(buildInfo.app).toBe('shadow-archives-webportal');
    expect(buildInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(buildInfo.commit.length).toBeGreaterThan(0);
    expect(buildInfo.commitShort.length).toBeGreaterThan(0);
  });

  it('shortens the commit consistently', () => {
    if (buildInfo.commit === 'unknown') {
      expect(buildInfo.commitShort).toBe('unknown');
    } else {
      expect(buildInfo.commitShort).toBe(buildInfo.commit.slice(0, 7));
    }
  });

  it('derives a stable version+commit label', () => {
    expect(buildLabel).toBe(`${buildInfo.version}+${buildInfo.commitShort}`);
  });

  it('is immutable so a served build cannot be mutated at runtime', () => {
    expect(Object.isFrozen(buildInfo)).toBe(true);
  });
});
