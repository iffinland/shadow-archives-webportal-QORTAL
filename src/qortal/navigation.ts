import { QortalAction } from './actions';
import { request } from './bridge';

/**
 * Qortal URL / app-navigation helpers.
 *
 * VERIFIED mechanism (Phase 1A §9.2): a real anchor `href="qortal://APP/<name>"`
 * is intercepted by Core's `q-apps.js` (`interceptClickEvent`), which issues
 * `LINK_TO_QDN_RESOURCE`; the host opens a new tab when the target app differs
 * from the current one. A real anchor is preferred over a programmatic call
 * because it keeps middle-click and keyboard behaviour.
 */

const QORTAL_SCHEME_PREFIX = 'qortal://';

/** Build the verified app-navigation URL for a published Q-App name. */
export function buildQortalAppUrl(appName: string, path = ''): string {
  const base = `${QORTAL_SCHEME_PREFIX}APP/${encodeURIComponent(appName)}`;
  if (!path) return base;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** True for any `qortal://` (or `qortal:`) link — app navigation or QDN resource. */
export function isQortalUrl(href: string): boolean {
  return href.startsWith(QORTAL_SCHEME_PREFIX) || href.startsWith('qortal:');
}

/** Web2 links cannot navigate inside a Q-App; the platform blocks them (copy instead). */
export function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('//');
}

/**
 * Normalized, non-authoritative key for a published app name
 * (`Q-Tube` -> `qtube`). Used for stable DOM ids/analytics only; the published
 * name itself always comes from owner-editable configuration.
 */
export function qortalAppIdFromName(appName: string): string {
  return appName.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Programmatic fallback for opening another Q-App. Only call from an explicit
 * user action; the visitor shell uses real anchors instead.
 */
export async function openQortalApp(appName: string, service = 'APP'): Promise<boolean> {
  const result = await request<unknown>(QortalAction.LINK_TO_QDN_RESOURCE, {
    name: appName,
    service,
  });
  return result !== false && result !== null;
}
