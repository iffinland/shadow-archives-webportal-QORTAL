/**
 * Typed declarations for the subset of `qortalRequest` actions Shadow Archives
 * relies on. These are contract declarations only: Phase 1B does not implement
 * any write path, and nothing here is invoked at visitor startup.
 *
 * Source of truth for each shape is the current Qortal Core / Hub source
 * (`q-apps.js`, `Qortal-Hub/src/qortal/qortal-requests.ts`), not memory.
 */
export const QortalAction = {
  // Public / idempotent node reads
  GET_NAME_DATA: 'GET_NAME_DATA',
  GET_PRIMARY_NAME: 'GET_PRIMARY_NAME',
  GET_ACCOUNT_NAMES: 'GET_ACCOUNT_NAMES',
  SEARCH_QDN_RESOURCES: 'SEARCH_QDN_RESOURCES',
  FETCH_QDN_RESOURCE: 'FETCH_QDN_RESOURCE',
  // Host-mediated, permissioned reads
  GET_USER_ACCOUNT: 'GET_USER_ACCOUNT',
  GET_QDN_RESOURCE_URL: 'GET_QDN_RESOURCE_URL',
  LINK_TO_QDN_RESOURCE: 'LINK_TO_QDN_RESOURCE',
} as const;

export type QortalActionName = (typeof QortalAction)[keyof typeof QortalAction];

/**
 * Write actions are declared for forward compatibility and to make an
 * accidental import visible in review. Phase 1B must not call them.
 */
export type QortalWriteActionName =
  'PUBLISH_QDN_RESOURCE' | 'PUBLISH_MULTIPLE_QDN_RESOURCES' | 'SEND_CHAT_MESSAGE';
