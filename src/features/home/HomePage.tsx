import { GalleryStrip } from './components/GalleryStrip';
import { LatestPostsSection } from './components/LatestPostsSection';
import { LatestVideosSection } from './components/LatestVideosSection';

/**
 * Home route: Latest Posts / Latest Videos columns plus the gallery strip.
 * All regions render honest empty/loading states; nothing is fetched yet.
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
