import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { RouteErrorBoundary } from '../../components/feedback/RouteErrorBoundary';
import { AppShell } from '../../components/layout/AppShell';
import HomePage from '../../features/home/HomePage';

/*
 * Route boundaries (Phase 1A §4).
 *
 * Only the home route ships in the startup graph. Every other route is a lazy
 * dynamic import, so its module (and any heavy dependency it later gains) is a
 * separate chunk that a visitor pays for only when they navigate there.
 *
 * Owner/studio routes stay entirely outside the visitor startup path and are
 * intentionally not linked from public navigation.
 */
const BlogPage = lazy(() => import('../../features/blog/BlogPage'));
const BlogPostPage = lazy(() => import('../../features/blog/BlogPostPage'));
const VideosPage = lazy(() => import('../../features/videos/VideosPage'));
const VideoDetailPage = lazy(() => import('../../features/videos/VideoDetailPage'));
const GalleryPage = lazy(() => import('../../features/gallery/GalleryPage'));
const GalleryDetailPage = lazy(() => import('../../features/gallery/GalleryDetailPage'));
const AboutPage = lazy(() => import('../../features/about/AboutPage'));
const ContactPage = lazy(() => import('../../features/contact/ContactPage'));
const CategoryPage = lazy(() => import('../../features/taxonomy/CategoryPage'));
const TagPage = lazy(() => import('../../features/taxonomy/TagPage'));
const SearchPage = lazy(() => import('../../features/search/SearchPage'));
const NotFoundPage = lazy(() => import('../../features/not-found/NotFoundPage'));
const StudioPage = lazy(() => import('../../features/owner/StudioPage'));

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'blog', element: <BlogPage /> },
      { path: 'blog/:id', element: <BlogPostPage /> },
      { path: 'videos', element: <VideosPage /> },
      { path: 'videos/:id', element: <VideoDetailPage /> },
      { path: 'gallery', element: <GalleryPage /> },
      { path: 'gallery/:id', element: <GalleryDetailPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: 'category/:slug', element: <CategoryPage /> },
      { path: 'tag/:slug', element: <TagPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'studio', element: <StudioPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
