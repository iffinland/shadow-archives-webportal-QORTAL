import { parseEntityIdentifier } from '../domain/identifiers';
import { WRITE_ACTIONS } from '../qortal/actions';
import { getNameData } from '../qortal/auth';
import { QortalBridgeError, request } from '../qortal/bridge';
import { bridgePublishPort, type PublishAttempt, type PublishPort } from '../qortal/publish';
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';

export type EngagementKind = 'post' | 'video' | 'gallery';

export interface EngagementTarget {
  readonly kind: EngagementKind;
  readonly entityIdentifier: string;
  readonly publisherName: string;
  readonly title: string;
}

export interface EngagementDeps {
  readonly publish: PublishPort;
  readonly getNameOwner: typeof getNameData;
  readonly sendCoin: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface EngagementReadDeps {
  readonly reader: QdnReadPort;
}

export interface EngagementCounts {
  readonly likes: number;
  readonly comments: number;
}

export interface EngagementComment {
  readonly id: string;
  readonly authorName: string;
  readonly bodyText: string;
  readonly createdAt: number;
}

const textEncoder = new TextEncoder();

function toBase64(value: unknown): string {
  const bytes = textEncoder.encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function targetToken(target: EngagementTarget): string {
  const parsed = parseEntityIdentifier(target.entityIdentifier);
  if (!parsed) throw new Error('This card does not identify a canonical Shadow Archives item.');
  const kind =
    parsed.kind === 'blog-post' ? 'post' : parsed.kind === 'gallery-item' ? 'img' : 'vid';
  return `${kind}_${parsed.id}`;
}

function assertName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error('Choose a registered Qortal name first.');
  return value;
}

export const bridgeEngagementDeps: EngagementDeps = {
  publish: bridgePublishPort,
  getNameOwner: getNameData,
  sendCoin: (params) =>
    request<unknown>(WRITE_ACTIONS.SEND_COIN, params, { timeoutMs: 60 * 60 * 1000 }),
};

export const bridgeEngagementReadDeps: EngagementReadDeps = { reader: bridgeQdnReadPort };

/** One name-scoped QDN record is overwritten for like/unlike; no duplicate active likes exist. */
export async function setLike(
  target: EngagementTarget,
  actingName: string,
  active: boolean,
  deps: EngagementDeps = bridgeEngagementDeps,
): Promise<PublishAttempt> {
  const name = assertName(actingName);
  const token = targetToken(target);
  const now = Date.now();
  return deps.publish.publishResource({
    service: 'DOCUMENT',
    name,
    identifier: `saw_lk_${token}`,
    filename: 'like.json',
    title: `${active ? 'Like' : 'Unlike'} on ${target.title}`.slice(0, 200),
    description: active ? 'Shadow Archives like' : 'Shadow Archives unlike',
    tags: [active ? 'saw_active' : 'saw_inactive'],
    data64: toBase64({
      schemaVersion: 1,
      kind: 'like-state',
      target: {
        service: 'DOCUMENT',
        name: target.publisherName,
        identifier: target.entityIdentifier,
      },
      state: active ? 'active' : 'inactive',
      createdAt: now,
      inactiveAt: active ? null : now,
    }),
  });
}

export async function publishComment(
  target: EngagementTarget,
  actingName: string,
  bodyText: string,
  deps: EngagementDeps = bridgeEngagementDeps,
): Promise<PublishAttempt> {
  const name = assertName(actingName);
  const body = bodyText.trim();
  if (!body) throw new Error('Write a comment before publishing it.');
  if (body.length > 4096) throw new Error('A comment can contain at most 4096 characters.');
  const token = targetToken(target);
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  const now = Date.now();
  return deps.publish.publishResource({
    service: 'DOCUMENT',
    name,
    identifier: `saw_cmt_${token}_${suffix}`,
    filename: 'comment.json',
    title: `Comment on ${target.title}`.slice(0, 200),
    description: body.slice(0, 2000),
    data64: toBase64({
      schemaVersion: 1,
      kind: 'comment',
      target: {
        service: 'DOCUMENT',
        name: target.publisherName,
        identifier: target.entityIdentifier,
      },
      parentCommentRef: null,
      bodyText: body,
      displayName: name,
      createdAt: now,
      editedAt: null,
      state: 'active',
    }),
  });
}

function isActiveLikePayload(value: unknown, target: EngagementTarget): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (payload.kind !== 'like-state' || payload.state !== 'active') return false;
  const reference = payload.target;
  return (
    typeof reference === 'object' &&
    reference !== null &&
    (reference as Record<string, unknown>).name === target.publisherName &&
    (reference as Record<string, unknown>).identifier === target.entityIdentifier
  );
}

/**
 * Counts the actual QDN engagement resources for one canonical item. Likes are
 * read back because a name can later overwrite its one like resource as
 * inactive; comments are append-only resources under the item's namespace.
 */
export async function readEngagementCounts(
  target: EngagementTarget,
  deps: EngagementReadDeps = bridgeEngagementReadDeps,
): Promise<EngagementCounts> {
  const token = targetToken(target);
  const [rawLikes, rawComments] = await Promise.all([
    deps.reader.search({
      service: 'DOCUMENT',
      identifier: `saw_lk_${token}`,
      prefix: true,
      mode: 'LATEST',
      limit: 100,
      excludeBlocked: true,
    }),
    deps.reader.search({
      service: 'DOCUMENT',
      identifier: `saw_cmt_${token}_`,
      prefix: true,
      mode: 'LATEST',
      limit: 100,
      excludeBlocked: true,
    }),
  ]);

  const activeLikes = await Promise.all(
    rawLikes.map(async (raw) => {
      if (typeof raw !== 'object' || raw === null) return false;
      const ref = raw as { service?: unknown; name?: unknown; identifier?: unknown };
      if (
        ref.service !== 'DOCUMENT' ||
        typeof ref.name !== 'string' ||
        typeof ref.identifier !== 'string'
      )
        return false;
      try {
        const payload = parseJsonPayload(
          await deps.reader.fetchText({
            service: 'DOCUMENT',
            name: ref.name,
            identifier: ref.identifier,
          }),
          16_384,
        );
        return payload.ok && isActiveLikePayload(payload.value, target);
      } catch {
        return false;
      }
    }),
  );

  return {
    likes: activeLikes.filter(Boolean).length,
    comments: rawComments.filter((raw) => {
      if (typeof raw !== 'object' || raw === null) return false;
      const identifier = (raw as { identifier?: unknown }).identifier;
      return typeof identifier === 'string' && identifier.startsWith(`saw_cmt_${token}_`);
    }).length,
  };
}

/** Read the newest valid comments for an item from their public QDN namespace. */
export async function readEngagementComments(
  target: EngagementTarget,
  deps: EngagementReadDeps = bridgeEngagementReadDeps,
): Promise<readonly EngagementComment[]> {
  const token = targetToken(target);
  const rawComments = await deps.reader.search({
    service: 'DOCUMENT',
    identifier: `saw_cmt_${token}_`,
    prefix: true,
    mode: 'LATEST',
    limit: 50,
    reverse: true,
    excludeBlocked: true,
  });
  const comments = await Promise.all(
    rawComments.map(async (raw): Promise<EngagementComment | null> => {
      if (typeof raw !== 'object' || raw === null) return null;
      const ref = raw as { service?: unknown; name?: unknown; identifier?: unknown };
      if (
        ref.service !== 'DOCUMENT' ||
        typeof ref.name !== 'string' ||
        typeof ref.identifier !== 'string' ||
        !ref.identifier.startsWith(`saw_cmt_${token}_`)
      )
        return null;
      try {
        const parsed = parseJsonPayload(
          await deps.reader.fetchText({
            service: 'DOCUMENT',
            name: ref.name,
            identifier: ref.identifier,
          }),
          16_384,
        );
        if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return null;
        const payload = parsed.value as Record<string, unknown>;
        const reference =
          typeof payload.target === 'object' && payload.target !== null
            ? (payload.target as Record<string, unknown>)
            : null;
        if (
          payload.kind !== 'comment' ||
          payload.state !== 'active' ||
          !reference ||
          reference.name !== target.publisherName ||
          reference.identifier !== target.entityIdentifier ||
          typeof payload.bodyText !== 'string' ||
          !payload.bodyText.trim()
        )
          return null;
        return {
          id: ref.identifier,
          authorName: typeof payload.displayName === 'string' ? payload.displayName : ref.name,
          bodyText: payload.bodyText,
          createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : 0,
        };
      } catch {
        return null;
      }
    }),
  );
  return comments
    .filter((comment): comment is EngagementComment => comment !== null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export type TipAttempt =
  | {
      readonly kind: 'submitted';
      readonly recipient: string;
      readonly amount: number;
      readonly signature: string | null;
    }
  | {
      readonly kind: 'ambiguous';
      readonly recipient: string;
      readonly amount: number;
      readonly message: string;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** A tip is a direct, Hub-approved QORT payment to the current owner of the content name. */
export async function sendTip(
  target: EngagementTarget,
  amount: number,
  deps: EngagementDeps = bridgeEngagementDeps,
): Promise<TipAttempt> {
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 1e8) !== amount * 1e8) {
    return {
      kind: 'failed',
      message: 'Enter a positive QORT amount with at most 8 decimal places.',
    };
  }
  const recipient = await deps.getNameOwner(target.publisherName);
  if (!recipient?.owner)
    return { kind: 'failed', message: 'The content publisher address could not be resolved.' };
  try {
    const raw = await deps.sendCoin({ coin: 'QORT', recipient: recipient.owner, amount });
    const signature =
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { signature?: unknown }).signature === 'string'
        ? (raw as { signature: string }).signature
        : null;
    if (!signature) {
      return {
        kind: 'failed',
        message:
          'The Hub did not return a transaction signature, so no tip was confirmed as submitted.',
      };
    }
    return { kind: 'submitted', recipient: recipient.owner, amount, signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The QORT tip could not be submitted.';
    if (error instanceof QortalBridgeError && error.kind === 'timeout') {
      return { kind: 'ambiguous', recipient: recipient.owner, amount, message };
    }
    return { kind: 'failed', message };
  }
}
