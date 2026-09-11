import { siteConfig, type NavItem } from './siteConfig';

export type { NavItem };

export const navItems: readonly NavItem[] = siteConfig.navItems;

export const externalAppTargets = siteConfig.externalApps;

/** Route paths referenced by more than one module. */
export const routes = {
  home: '/',
  blog: '/blog',
  blogDetail: (id: string) => `/blog/${encodeURIComponent(id)}`,
  videos: '/videos',
  videoDetail: (id: string) => `/videos/${encodeURIComponent(id)}`,
  gallery: '/gallery',
  galleryDetail: (id: string) => `/gallery/${encodeURIComponent(id)}`,
  about: '/about',
  contact: '/contact',
  category: (slug: string) => `/category/${encodeURIComponent(slug)}`,
  tag: (slug: string) => `/tag/${encodeURIComponent(slug)}`,
  search: '/search',
  studio: '/studio',
} as const;
