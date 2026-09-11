import { describe, expect, it } from 'vitest';

import { classifyContentUrl, isAllowedImageSource } from './urlPolicy';

describe('classifyContentUrl', () => {
  it('accepts http(s) links as external-web (never navigated directly by the app)', () => {
    expect(classifyContentUrl('https://example.com/a')).toEqual({
      kind: 'external-web',
      url: 'https://example.com/a',
    });
    expect(classifyContentUrl('http://example.com/')).toEqual({
      kind: 'external-web',
      url: 'http://example.com/',
    });
    // Scheme is case-insensitive and normalised by URL parsing.
    expect(classifyContentUrl('HTTPS://Example.com/X')).toEqual({
      kind: 'external-web',
      url: 'https://example.com/X',
    });
  });

  it('accepts qortal:// links for host interception', () => {
    expect(classifyContentUrl('qortal://APP/Q-Tube')).toEqual({
      kind: 'qortal',
      url: 'qortal://APP/Q-Tube',
    });
  });

  it('rejects dangerous schemes, relative paths, fragments and malformed input', () => {
    for (const value of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/x',
      '/relative/path',
      '//protocol-relative.example',
      '#fragment',
      'example.com/no-scheme',
      'https://exa mple.com',
      '',
      '   ',
    ]) {
      expect(classifyContentUrl(value)).toEqual({ kind: 'reject' });
    }
    expect(classifyContentUrl(null)).toEqual({ kind: 'reject' });
    expect(classifyContentUrl(42)).toEqual({ kind: 'reject' });
    expect(classifyContentUrl(`https://example.com/${'a'.repeat(2100)}`)).toEqual({
      kind: 'reject',
    });
  });

  it('rejects control characters even inside an otherwise valid scheme', () => {
    expect(classifyContentUrl('https://example.com/\u0000javascript:')).toEqual({ kind: 'reject' });
  });
});

describe('isAllowedImageSource', () => {
  it('allows same-origin /arbitrary paths', () => {
    expect(isAllowedImageSource('/arbitrary/IMAGE/Name/id')).toBe(true);
  });

  it('allows only raster image data URLs', () => {
    expect(isAllowedImageSource('data:image/png;base64,AAAA')).toBe(true);
    expect(isAllowedImageSource('data:image/webp;base64,AA==')).toBe(true);
    expect(isAllowedImageSource('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isAllowedImageSource('data:text/html;base64,AAAA')).toBe(false);
  });

  it('rejects external origins, unsafe schemes and non-strings', () => {
    expect(isAllowedImageSource('https://evil.test/x.png')).toBe(false);
    expect(isAllowedImageSource('javascript:alert(1)')).toBe(false);
    expect(isAllowedImageSource('//evil.test/x.png')).toBe(false);
    expect(isAllowedImageSource('  /arbitrary/IMAGE/N/i  ')).toBe(true);
    expect(isAllowedImageSource(null)).toBe(false);
  });
});
