/**
 * Contact recipient (current Shadow Archives owner) resolution.
 *
 * The recipient is NEVER hardcoded. It is derived at runtime from the app's own
 * injected publishing identity (`_qdnName` → the registered name that owns this
 * published `APP` resource) and the node-reported current owner of that name.
 * Payload or document fields claiming an owner are never consulted.
 *
 * Every failure closes the flow: an unresolved recipient means no send attempt is
 * made at all, and the reason is reported truthfully instead of a generic error.
 */

import { QortalAction } from '../qortal/actions';
import { getNameData } from '../qortal/auth';
import { QortalBridgeError, request } from '../qortal/bridge';
import type { QdnEnvironment } from '../qortal/types';
import { isRecord } from '../domain/validation';

export interface ContactRecipient {
  /** The publishing name the recipient was derived from. */
  readonly publisherName: string;
  /** Current owner address of that name, resolved fresh from the node. */
  readonly address: string;
  /**
   * The owner's on-chain public key. Required because Core/Hub encryption of a
   * direct chat message needs the recipient's key; the host would otherwise
   * refuse the send after an approval prompt.
   */
  readonly publicKey: string;
}

export type ContactRecipientFailureCode =
  | 'not-a-qortal-frame'
  | 'proxy-context'
  | 'no-host-bridge'
  | 'no-publisher-name'
  | 'name-unresolved'
  | 'recipient-not-encryptable';

export type ContactRecipientResult =
  | { readonly kind: 'resolved'; readonly recipient: ContactRecipient }
  | {
      readonly kind: 'unresolved';
      readonly code: ContactRecipientFailureCode;
      readonly message: string;
    };

/** Injectable reads; tests supply fakes, production uses the bridge. */
export interface ContactRecipientPorts {
  /** Current owner of a registered name, or null when it cannot be established. */
  resolveNameOwner(name: string): Promise<string | null>;
  /** On-chain public key for an address, or null when it has none. */
  resolvePublicKey(address: string): Promise<string | null>;
}

/**
 * `GET_NAME_DATA` (`/names/{name}`) and `GET_ACCOUNT_DATA` (`/addresses/{address}`)
 * are public, idempotent bridge reads: no approval dialog, safe to run on mount.
 */
export const bridgeContactRecipientPorts: ContactRecipientPorts = {
  async resolveNameOwner(name) {
    try {
      const data = await getNameData(name);
      return data?.owner ?? null;
    } catch {
      return null;
    }
  },

  async resolvePublicKey(address) {
    try {
      const raw = await request<unknown>(QortalAction.GET_ACCOUNT_DATA, { address });
      if (!isRecord(raw)) return null;
      const publicKey = raw.publicKey;
      return typeof publicKey === 'string' && publicKey.length > 0 ? publicKey : null;
    } catch (error) {
      if (error instanceof QortalBridgeError) return null;
      return null;
    }
  },
};

export const CONTACT_RECIPIENT_MESSAGES: Record<ContactRecipientFailureCode, string> = {
  'not-a-qortal-frame':
    'This page is not running inside a Qortal app frame, so the current Shadow Archives recipient cannot be resolved. Open the published app inside the Qortal Hub to send a private message.',
  'proxy-context':
    'The Qortal node development proxy does not carry the deployed publishing identity, so the recipient cannot be resolved and no message can be sent from here.',
  'no-host-bridge':
    'Qortal served this frame but no host bridge is reachable, so the app cannot ask your Qortal account to sign a message. Open the app inside the Qortal Hub to send a private message.',
  'no-publisher-name':
    'Qortal served this frame but injected no publishing name, so the current Shadow Archives owner cannot be established. No message was sent.',
  'name-unresolved':
    'The current owner of the Shadow Archives publishing name could not be resolved from the node, so no message was sent. This is usually a temporary node or network problem; try again.',
  'recipient-not-encryptable':
    'The resolved owner has no public key on chain yet, so an encrypted private chat message cannot be addressed to them. No message was sent.',
};

export function unresolvedRecipient(
  code: ContactRecipientFailureCode,
): Extract<ContactRecipientResult, { kind: 'unresolved' }> {
  return { kind: 'unresolved', code, message: CONTACT_RECIPIENT_MESSAGES[code] };
}

/**
 * Resolve the current owner of the app's publishing name, and confirm the owner
 * can actually receive an encrypted message.
 *
 * The name lookup runs on every call, so a name transfer between page load and
 * send is picked up instead of silently messaging the previous owner.
 */
export async function resolveContactRecipient(
  environment: QdnEnvironment,
  ports: ContactRecipientPorts = bridgeContactRecipientPorts,
): Promise<ContactRecipientResult> {
  if (environment.isProxy) return unresolvedRecipient('proxy-context');
  if (!environment.isHosted) return unresolvedRecipient('not-a-qortal-frame');
  // Sending is host-mediated and signed by the host account, so a reachable
  // bridge is a precondition of the whole flow, not only of the name read.
  if (!environment.bridgeAvailable) return unresolvedRecipient('no-host-bridge');

  const publisherName = environment.publisherName?.trim();
  if (!publisherName) return unresolvedRecipient('no-publisher-name');

  const address = await ports.resolveNameOwner(publisherName);
  if (!address) return unresolvedRecipient('name-unresolved');

  const publicKey = await ports.resolvePublicKey(address);
  if (!publicKey) return unresolvedRecipient('recipient-not-encryptable');

  return { kind: 'resolved', recipient: { publisherName, address, publicKey } };
}
