import { hasQortalBridge } from './environment';
import type { QortalBridgeErrorKind } from './types';

/** Default timeout for public, non-interactive node reads performed via the bridge. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * `GET_USER_ACCOUNT` is dispatched by the host and may open an approval dialog.
 * Core gives the action a one-hour default timeout (`q-apps.js`) because the
 * user may be deciding the popup, so the wrapper must not cut it short.
 */
export const PERMISSION_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Structured bridge failure. The `kind` is part of the app's error taxonomy.
 *
 * `detail` retains the raw rejection value. A grouped write can reject with a
 * structured partial-failure payload (`unsuccessfulPublishes`), and the write
 * layer must be able to report exactly which resources failed; collapsing that
 * into a message string would lose the truthful per-resource result.
 */
export class QortalBridgeError extends Error {
  readonly kind: QortalBridgeErrorKind;
  readonly action: string;
  readonly detail: unknown;

  constructor(kind: QortalBridgeErrorKind, message: string, action: string, detail?: unknown) {
    super(message);
    this.name = 'QortalBridgeError';
    this.kind = kind;
    this.action = action;
    this.detail = detail;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function classify(error: unknown, action: string): QortalBridgeError {
  if (error instanceof QortalBridgeError) return error;

  const detail = error;

  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return new QortalBridgeError('timeout', message || 'The request timed out', action, detail);
  }
  if (
    normalized.includes('denied') ||
    normalized.includes('rejected') ||
    normalized.includes('user declined') ||
    normalized.includes('cancel')
  ) {
    return new QortalBridgeError('rejected', message || 'The request was rejected', action, detail);
  }
  if (
    normalized.includes('empty response') ||
    normalized.includes('invalid') ||
    normalized.includes('unexpected token')
  ) {
    return new QortalBridgeError('malformed', message || 'Malformed response', action, detail);
  }
  return new QortalBridgeError('error', message || 'Bridge request failed', action, detail);
}

export interface RequestOptions {
  /** Override the default action timeout. */
  readonly timeoutMs?: number;
  /** Provide an AbortSignal to stop waiting (the bridge call itself cannot be cancelled). */
  readonly signal?: AbortSignal;
  /** The window to use; defaults to the global one. Primarily for tests. */
  readonly target?: Window;
}

/**
 * The only place in the application that may call `window.qortalRequest`.
 * Feature code must import this wrapper instead of touching the global.
 */
export async function request<T>(
  action: string,
  params: Record<string, unknown> = {},
  options: RequestOptions = {},
): Promise<T> {
  const target = options.target ?? window;

  if (!hasQortalBridge(target)) {
    throw new QortalBridgeError('unavailable', 'Qortal bridge is not available', action);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const bridgeRequest = target.qortalRequest;

  if (typeof bridgeRequest !== 'function') {
    throw new QortalBridgeError('unavailable', 'Qortal bridge is not available', action);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const call = bridgeRequest({ action, ...params }) as Promise<T>;
    // If the race settles first, the loser may reject later; keep that from
    // surfacing as an unhandled rejection.
    void Promise.resolve(call).catch(() => undefined);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new QortalBridgeError('timeout', `Request timed out: ${action}`, action));
      }, timeoutMs);
    });

    const abort = new Promise<never>((_resolve, reject) => {
      if (!options.signal) return;
      if (options.signal.aborted) {
        reject(new QortalBridgeError('error', 'Request aborted', action));
        return;
      }
      options.signal.addEventListener(
        'abort',
        () => reject(new QortalBridgeError('error', 'Request aborted', action)),
        { once: true },
      );
    });

    const result = await Promise.race([call, timeout, abort]);
    if (result === undefined || result === null) {
      throw new QortalBridgeError('malformed', `Empty response: ${action}`, action);
    }
    return result;
  } catch (error) {
    throw classify(error, action);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Narrowing helper: true when the failure is an environment/permission absence. */
export function isBridgeUnavailable(error: unknown): boolean {
  return error instanceof QortalBridgeError && error.kind === 'unavailable';
}
