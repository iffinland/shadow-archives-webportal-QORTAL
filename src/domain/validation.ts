/**
 * Small explicit validation primitives.
 *
 * The schemas are bounded and known, so hand-written validators are smaller,
 * faster and easier to audit than a generic schema dependency. They deliberately
 * fail closed: an unrecognized value is rejected rather than coerced.
 */

export type ValidationErrorCode =
  | 'not-an-object'
  | 'missing-field'
  | 'invalid-type'
  | 'invalid-value'
  | 'too-long'
  | 'too-large'
  | 'unsupported-schema'
  | 'unsupported-format';

export interface ValidationFailure {
  readonly ok: false;
  readonly code: ValidationErrorCode;
  readonly message: string;
}

export interface ValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function ok<T>(value: T): ValidationSuccess<T> {
  return { ok: true, value };
}

export function fail<T>(code: ValidationErrorCode, message: string): ValidationResult<T> {
  return { ok: false, code, message };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Required non-empty string, bounded. */
export function requireString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > maxLength) return null;
  return value;
}

/** Required string that may be empty, bounded. */
export function requireStringAllowEmpty(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > maxLength) return null;
  return value;
}

/** Optional string; absent/null/invalid/oversized becomes null (presentation field). */
export function optionalString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, maxLength);
}

/** Finite non-negative number. */
export function nonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Non-negative integer (timestamps, counts). */
export function nonNegativeInteger(value: unknown): number | null {
  const num = nonNegativeNumber(value);
  if (num === null || !Number.isInteger(num)) return null;
  return num;
}

/** Bounded array of unknown items. */
export function boundedArray(value: unknown, maxLength: number): unknown[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > maxLength) return null;
  return value;
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** URL-safe QDN resource identifier: non-empty, ≤64, no whitespace/slashes. */
export function validResourceIdentifier(value: unknown, maxLength = 64): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > maxLength) return null;
  if (/[\s/\\]/.test(value)) return null;
  return value;
}

export function validServiceName(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Z0-9_]{2,32}$/.test(value)) return null;
  return value;
}

/** True when the string contains a C0/C1 control character. */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Bounded character count; used for payload caps before `JSON.parse`. */
export function exceedsCharacterCap(value: string, cap: number): boolean {
  return value.length > cap;
}
