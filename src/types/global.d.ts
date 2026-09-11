/**
 * Globals injected by Qortal Core's `HTMLParser` when a Q-App is rendered
 * through `/render/<service>/<name>`.
 *
 * VERIFIED (Phase 1A): Core injects `_qdnContext`, `_qdnTheme`, `_qdnLang`,
 * `_qdnService`, `_qdnName`, `_qdnIdentifier`, `_qdnPath`, `_qdnBase` and
 * `_qdnBaseWithPath`, plus `<base href=".../">` and `q-apps.js` which defines
 * `qortalRequest()`. Values are absent in a plain browser and empty in the
 * node dev-proxy context.
 *
 * These declarations intentionally stay permissive (`unknown`/optional) so the
 * integration layer, not the type system, decides what a value means.
 */
interface Window {
  qortalRequest?: (request: Record<string, unknown>) => Promise<unknown>;
  readonly _qdnContext?: string;
  readonly _qdnTheme?: unknown;
  readonly _qdnLang?: string;
  readonly _qdnService?: string;
  readonly _qdnName?: string;
  readonly _qdnIdentifier?: string;
  readonly _qdnPath?: string;
  readonly _qdnBase?: string;
  readonly _qdnBaseWithPath?: string;
}

/** Core also exposes the raw declaration style (`var qortalRequest = ...`). */
declare const qortalRequest: ((request: Record<string, unknown>) => Promise<unknown>) | undefined;
