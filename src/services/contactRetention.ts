/**
 * Verified private-chat retention policy for the Contact page notice.
 *
 * EVIDENCE (read 2026-09-14; no live send was performed):
 *
 * - A private chat message is an unconfirmed `CHAT` transaction.
 *   `qortal` `108bf191` (v6.1.9) `src/main/java/org/qortal/transaction/ChatTransaction.java`
 *   overrides `isConfirmable()` to `false`, so a chat message is never included
 *   in a block and never becomes part of the settled chain data.
 * - Nodes drop unconfirmed transactions once `now >= timestamp +
 *   BlockChain.getTransactionExpiryPeriod()`
 *   (`Controller.deleteExpiredTransactions`, every 5 minutes).
 * - The chat delegate keeps the same horizon and prunes every hour:
 *   `ChatTransactionDelegate.cleanup()` uses
 *   `now - BlockChain.getInstance().getTransactionExpiryPeriod()`
 *   (`src/main/java/org/qortal/controller/ChatTransactionDelegate.java`).
 * - `transactionExpiryPeriod` is `86400000` ms (24 hours) in
 *   `qortal/src/main/resources/blockchain.json` (mainnet) and
 *   `qortal/testchain.json` (testnet) at revision `108bf191`. Both owner
 *   development nodes report `buildVersion: "qortal-6.1.9-108bf19"` for the same
 *   revision.
 * - The period is CHAIN-CONFIGURED, not a universal constant: Core loads the
 *   chain config from the packaged resource, but `Settings.blockchainConfig` can
 *   point a node at a different config file
 *   (`Settings.java` field `blockchainConfig`), and only "positive" is validated
 *   (`BlockChain.java`).
 * - Therefore the previous "about one month" product wording is NOT accurate for
 *   private chat sent through `SEND_CHAT_MESSAGE`. (The one-month figure and the
 *   current Hub notice "DMs expire after 1 month by default" belong to the Hub's
 *   separate Reticulum DM store — `Qortal-Hub` `12a573b2`
 *   `electron/src/reticulum-chat-db.ts`: `RETICULUM_DM_DEFAULT_EXPIRY_MS = 30 ×
 *   24 h`. A Q-App cannot send through that transport; the injected bridge has no
 *   Reticulum action. See the implementation report.)
 * - READ-ONLY RUNTIME CONFIRMATION (2026-09-14, `127.0.0.1:24991` and `:24992`,
 *   both `buildVersion: qortal-6.1.9-108bf19`): `GET /admin/settings` is
 *   readable without an API key on these nodes and reports the chat settings
 *   `maxRecentChatMessagesPerAccount: 250` and `recentChatMessagesMaxAge:
 *   3600000` (1 h). Those two are the per-account **rate limit** for pending
 *   unconfirmed CHAT transactions (`ChatTransaction.isValid` →
 *   `TOO_MANY_UNCONFIRMED`); they are NOT message retention, and reading them as
 *   retention would be wrong. Message retention is the chain-wide
 *   `transactionExpiryPeriod` (24 h) described above. No read-only endpoint
 *   exposes the chain config, so the 24 h value is established from the packaged
 *   `blockchain.json` at the revision both nodes report, not from the node API.
 */

export interface PrivateChatRetentionPolicy {
  /** Verified chain-wide expiry period in the current Core chain configuration. */
  readonly windowMs: number;
  /** True when the window is chain/node configuration rather than a universal constant. */
  readonly networkConfigured: boolean;
  /** Exact source revision the value was read from. */
  readonly verifiedRevision: string;
  /** Short human-readable window used in the notice. */
  readonly windowLabel: string;
}

export const PRIVATE_CHAT_RETENTION: PrivateChatRetentionPolicy = {
  windowMs: 24 * 60 * 60 * 1000,
  networkConfigured: true,
  verifiedRevision: 'qortal 108bf191 (v6.1.9) blockchain.json transactionExpiryPeriod',
  windowLabel: 'about 24 hours',
};

/**
 * Concise, truthful retention notice rendered next to the form.
 *
 * It states the verified window, names the dependency on the network/node
 * configuration instead of promising a fixed period, and repeats the Q-Mail
 * fallback the product asked for without offering an unimplemented Q-Mail send.
 */
export function contactRetentionNotice(
  policy: PrivateChatRetentionPolicy = PRIVATE_CHAT_RETENTION,
): string {
  return (
    `Messages are delivered through Qortal private chat and are not stored permanently: ` +
    `nodes relay them for a limited period — ${policy.windowLabel} ` +
    `in the current Qortal Core chain configuration, and the exact period depends on the ` +
    `network and node settings. Treat private chat as short-lived contact only: if the owner ` +
    `has not replied, or you need a durable record of your message, contact them through ` +
    `Q-Mail instead.`
  );
}
