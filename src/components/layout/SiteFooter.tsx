import { siteConfig } from '../../app/config/siteConfig';
import { buildInfo } from '../../build/buildInfo';

/**
 * Minimal footer: brand/description plus text-only provenance.
 *
 * It intentionally contains NO navigation links, NO external/Web2 links and NO
 * repository URL. The site sections live in the primary navigation above; the
 * footer only states identity, where the app runs and which build is displayed.
 */
export function SiteFooter() {
  return (
    <footer className="sa-site-footer">
      <div className="sa-site-footer__inner">
        <div className="sa-site-footer__brand">
          <p className="sa-site-footer__name">{siteConfig.name}</p>
          <p className="sa-site-footer__text">{siteConfig.description}</p>
        </div>

        <div className="sa-site-footer__meta">
          <p className="sa-site-footer__text">Decentralized on Qortal</p>
          <p className="sa-site-footer__text">
            Build v{buildInfo.version} · <code>{buildInfo.commitShort}</code>
          </p>
        </div>
      </div>
    </footer>
  );
}
