import { GalleryStrip } from './components/GalleryStrip';
import { LatestPostsSection } from './components/LatestPostsSection';
import { LatestVideosSection } from './components/LatestVideosSection';

/**
 * Home route: Latest Posts / Latest Videos columns plus the gallery strip.
 *
 * Regions read the shared, already-loaded archive snapshot (catalog listings
 * only), so the home page issues no per-card QDN request and never downloads a
 * full post body, video bytes or a gallery original.
 */
export default function HomePage() {
  return (
    <div className="sa-home">
      <h1 className="sa-visually-hidden">Shadow Archives</h1>
      <div className="sa-home__columns">
        <LatestPostsSection />
        <LatestVideosSection />
      </div>
      <GalleryStrip />
    </div>
  );
}
