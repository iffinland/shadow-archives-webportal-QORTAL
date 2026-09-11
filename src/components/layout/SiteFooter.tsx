import { Link } from 'react-router-dom';

import { routes } from '../../app/config/navigation';
import { siteConfig } from '../../app/config/siteConfig';
import { buildInfo } from '../../build/buildInfo';

/**
 * Elevated footer: archive metadata, a small link group and the provenance
 * line. Web2 URLs are shown as text because the platform blocks navigating to
 * them from inside a Q-App.
 */
export function SiteFooter() {
  return (
    <footer className="sa-site-footer">
      <div className="sa-site-footer__inner">
        <div className="sa-site-footer__group">
          <p className="sa-site-footer__name">{siteConfig.name}</p>
          <p className="sa-site-footer__text">{siteConfig.description}</p>
        </div>

        <nav className="sa-site-footer__group" aria-label="Footer">
          <h2 className="sa-site-footer__heading">Sections</h2>
          <ul className="sa-site-footer__list">
            <li>
              <Link to={routes.home}>Home</Link>
            </li>
            <li>
              <Link to={routes.blog}>Blog</Link>
            </li>
            <li>
              <Link to={routes.videos}>Videos</Link>
            </li>
            <li>
              <Link to={routes.gallery}>Gallery</Link>
            </li>
            <li>
              <Link to={routes.about}>About</Link>
            </li>
            <li>
              <Link to={routes.contact}>Contact</Link>
            </li>
          </ul>
        </nav>

        <div className="sa-site-footer__group">
          <h2 className="sa-site-footer__heading">Provenance</h2>
          <p className="sa-site-footer__text">
            QDN service <code>{siteConfig.qdnService}</code>
          </p>
          <p className="sa-site-footer__text">
            Build v{buildInfo.version} · <code>{buildInfo.commitShort}</code>
          </p>
          <p className="sa-site-footer__text sa-site-footer__repo">{siteConfig.repositoryUrl}</p>
        </div>
      </div>
    </footer>
  );
}
