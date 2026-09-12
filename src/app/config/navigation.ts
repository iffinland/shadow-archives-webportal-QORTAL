import { siteConfig, type NavItem } from './siteConfig';

export type { NavItem };

export const navItems: readonly NavItem[] = siteConfig.navItems;

/** Owner-only navigation items, appended after the public items. */
export const ownerNavItems: readonly NavItem[] = siteConfig.ownerNavItems;

export const externalAppTargets = siteConfig.externalApps;

/** Route paths referenced by more than one module. */
export const routes = {
  home: '/',
  blog: '/blog',
  blogDetail: (id: string) => `/blog/${encodeURIComponent(id)}`,
  videos: '/videos',
  videoDetail: (id: string) => `/videos/${encodeURIComponent(id)}`,
  gallery: '/gallery',
  galleryAlbum: (id: string) => `/gallery/album/${encodeURIComponent(id)}`,
  galleryItem: (id: string) => `/gallery/item/${encodeURIComponent(id)}`,
  /** Legacy Phase 1B generic gallery path; resolves to an item. */
  galleryLegacy: (id: string) => `/gallery/${encodeURIComponent(id)}`,
  about: '/about',
  contact: '/contact',
  category: (slug: string) => `/category/${encodeURIComponent(slug)}`,
  tag: (slug: string) => `/tag/${encodeURIComponent(slug)}`,
  search: '/search',
  studio: '/studio',
} as const;
