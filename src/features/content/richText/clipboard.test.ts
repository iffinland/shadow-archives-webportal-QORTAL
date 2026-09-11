import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard';

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

describe('copyText cascade', () => {
  it('uses navigator.clipboard.writeText when it succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const result = await copyText('https://example.com/');
    expect(result).toEqual({ ok: true, method: 'clipboard' });
    expect(writeText).toHaveBeenCalledWith('https://example.com/');
  });

  it('falls back to execCommand when the async clipboard is rejected', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });

    const result = await copyText('https://example.com/');
    expect(result).toEqual({ ok: true, method: 'execCommand' });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    // The off-screen textarea must be cleaned up.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a manual fallback when both mechanisms fail', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });

    const result = await copyText('https://example.com/');
    expect(result.ok).toBe(false);
    expect(result.method).toBe('manual');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('uses execCommand when no clipboard API exists at all', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });

    const result = await copyText('text');
    expect(result).toEqual({ ok: true, method: 'execCommand' });
  });

  it('does not throw when no copy mechanism is available', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    const result = await copyText('text');
    expect(result.ok).toBe(false);
    expect(result.method).toBe('manual');
  });
});
