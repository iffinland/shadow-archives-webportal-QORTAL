/**
 * Owner-editable site configuration.
 *
 * The published external-app names below are REVISION-SCOPED evidence, not
 * timeless platform constants: they were verified read-only on 2026-09-11
 * against QDN `APP` resources (see Phase 1A architecture §9.1). They are
 * defaults; a future `saw_cfg` resource will let the owner correct them without
 * an app redeploy. Do not spread these strings through components.
 */

export interface ExternalAppTarget {
  /** Stable local id (DOM ids, analytics). */
  readonly id: string;
  /** Visible label. */
  readonly label: string;
  /** Published Q-App name used to build `qortal://APP/<name>`. */
  readonly appName: string;
}

export interface NavItem {
  readonly to: string;
  readonly label: string;
  /** `true` for the index route so `NavLink` `end` matching is applied. */
  readonly end?: boolean;
}

export const siteConfig = {
  /** Human-readable canonical identity. Runtime truth still comes from `_qdnName`. */
  name: 'Shadow Archives',
  shortName: 'Shadow Archives',
  description: 'A Qortal Q-App archive for blog posts, videos and gallery media published to QDN.',
  /** QDN service this APP is published under. */
  qdnService: 'APP',
  repositoryUrl: 'https://github.com/iffinland/shadow-archives-webportal-QORTAL',
  version: '0.1.0',
  phaseLabel: 'Phase 2C-A publication-readiness build',

  /**
   * Primary actions. The published names were verified on 2026-09-11; `verifiedOn`
   * records that scope so it is clear the values need re-verification later.
   */
  verifiedOn: '2026-09-11',
  externalApps: [
    { id: 'qtube', label: 'Q-Tube', appName: 'Q-Tube' },
    { id: 'subwire', label: 'SubWire', appName: 'SubWire' },
    { id: 'quitter', label: 'Quitter', appName: 'Quitter' },
  ] satisfies readonly ExternalAppTarget[],

  navItems: [
    { to: '/', label: 'Home', end: true },
    { to: '/blog', label: 'Blog' },
    { to: '/videos', label: 'Videos' },
    { to: '/gallery', label: 'Gallery' },
    { to: '/about', label: 'About' },
    { to: '/contact', label: 'Contact' },
  ] satisfies readonly NavItem[],

  /** Top Posts / Top Videos panel capacity (owner decision: max 10 listed). */
  topList: {
    maxItems: 10,
    /** Minimum rendered items before auto-scroll is allowed to engage. */
    minItemsForScroll: 5,
  },

  /** Listing card geometry is driven by validated catalog listings. */
  pageSizes: {
    blog: 10,
    videos: 20,
  },
} as const;

export type SiteConfig = typeof siteConfig;
