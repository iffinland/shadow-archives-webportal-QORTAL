/**
 * Clipboard write cascade (architecture §10).
 *
 * Clipboard access inside the Q-App iframe is NOT VERIFIED, so the product
 * requires an explicit cascade with visible success/failure:
 *   1. `navigator.clipboard.writeText`
 *   2. off-screen selected text node + `document.execCommand('copy')`
 *   3. manual: reveal a selectable input containing the URL
 */
export type CopyMethod = 'clipboard' | 'execCommand' | 'manual';

export interface CopyResult {
  readonly ok: boolean;
  readonly method: CopyMethod;
  readonly error?: unknown;
}

function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.tabIndex = -1;
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function copyText(text: string): Promise<CopyResult> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return { ok: true, method: 'clipboard' };
    } catch (error) {
      // Fall through to the selection-based fallback.
      if (copyViaExecCommand(text)) return { ok: true, method: 'execCommand' };
      return { ok: false, method: 'manual', error };
    }
  }
  if (copyViaExecCommand(text)) return { ok: true, method: 'execCommand' };
  return { ok: false, method: 'manual' };
}
