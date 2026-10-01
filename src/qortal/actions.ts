/**
 * Typed declarations for the subset of `qortalRequest` actions Shadow Archives
 * relies on.
 *
 * Source of truth for each shape is the current Qortal Core / Hub source
 * (`qortal/src/main/resources/q-apps/q-apps.js`,
 * `Qortal-Hub/src/hooks/useQortalMessageListener.tsx`,
 * `Qortal-Hub/src/qortal/qortal-requests.ts`), not memory. Verified
 * 2026-09-11 against Core `108bf191` (v6.1.9) and Hub `12a573b`.
 * `SEARCH_CHAT_MESSAGES` and `SEND_CHAT_MESSAGE` reverified 2026-09-14 against
 * Core `108bf191` (v6.1.9) `Q-Apps.md` + `src/main/resources/q-apps/q-apps.js`,
 * Hub `12a573b2` `src/qortal/get.ts` (`sendChatMessage`) and `qapp-core`
 * `0f9d6ac` `src/types/qortalRequests/interfaces.ts`.
 *
 * Classification matters for retry/timeout semantics:
 * - `PUBLIC_READ_ACTIONS` are handled locally by the injected `q-apps.js`
 *   against the node API (no approval, idempotent).
 * - `PERMISSIONED_ACTIONS` are host-mediated and may open an approval dialog;
 *   they must never be retried automatically or triggered merely to read.
 * - `WRITE_ACTIONS` relay or create a transaction. They are host-mediated,
 *   approval-gated and NOT idempotent: an ambiguous result must never be
 *   retried automatically (see `qortal/chat.ts`).
 *
 * Phase 3A adds the Gallery write path. The write actions are declared here and
 * used only by `qortal/publish.ts`; React components still never call the raw
 * bridge. The module stays in the startup graph only as constants.
 */
export const PUBLIC_READ_ACTIONS = {
  GET_NAME_DATA: 'GET_NAME_DATA',
  GET_ACCOUNT_NAMES: 'GET_ACCOUNT_NAMES',
  /** `/addresses/{address}`; used only to confirm the recipient is encryptable. */
  GET_ACCOUNT_DATA: 'GET_ACCOUNT_DATA',
  SEARCH_QDN_RESOURCES: 'SEARCH_QDN_RESOURCES',
  FETCH_QDN_RESOURCE: 'FETCH_QDN_RESOURCE',
  GET_QDN_RESOURCE_STATUS: 'GET_QDN_RESOURCE_STATUS',
  GET_QDN_RESOURCE_URL: 'GET_QDN_RESOURCE_URL',
  /** `/chat/messages`; read-only, idempotent, requires exactly two `involving` addresses. */
  SEARCH_CHAT_MESSAGES: 'SEARCH_CHAT_MESSAGES',
} as const;

export const PERMISSIONED_ACTIONS = {
  /** Host-mediated authentication; opens an approval dialog on first use. */
  GET_USER_ACCOUNT: 'GET_USER_ACCOUNT',
  GET_PRIMARY_NAME: 'GET_PRIMARY_NAME',
  /** Host intercepts the link and opens/keeps the tab. */
  LINK_TO_QDN_RESOURCE: 'LINK_TO_QDN_RESOURCE',
} as const;

export const QortalAction = {
  ...PUBLIC_READ_ACTIONS,
  ...PERMISSIONED_ACTIONS,
} as const;

export type QortalActionName = (typeof QortalAction)[keyof typeof QortalAction];

/**
 * Signed / host-approved write actions.
 *
 * `SEND_CHAT_MESSAGE` relays an encrypted direct CHAT transaction. CHAT is
 * never block-confirmed, so a successful result means "accepted and relayed",
 * not "delivered"; see `qortal/chat.ts` for the result taxonomy.
 */
export const WRITE_ACTIONS = {
  PUBLISH_QDN_RESOURCE: 'PUBLISH_QDN_RESOURCE',
  PUBLISH_MULTIPLE_QDN_RESOURCES: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
  SEND_CHAT_MESSAGE: 'SEND_CHAT_MESSAGE',
} as const;

export type QortalWriteActionName = (typeof WRITE_ACTIONS)[keyof typeof WRITE_ACTIONS];
