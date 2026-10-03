import { siteConfig } from '../../app/config/siteConfig';
import { buildInfo } from '../../build/buildInfo';
import { buildQortalResourceUrl } from '../../qortal/navigation';

/** Builder credit target: a QDN `WEBSITE` resource, never an http(s) link. */
const CREDIT_HREF = buildQortalResourceUrl('WEBSITE', 'Qortal Web Builders', '/');

/**
 * Minimal footer: brand/tagline plus text-only provenance, with one Qortal
 * QDN deep link (the builder credit). It intentionally contains NO route
 * navigation, NO Web2/http(s) links and NO repository URL.
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
          <a className="sa-site-footer__credit" href={CREDIT_HREF}>
            Web Design &amp; Build
          </a>
          <p className="sa-site-footer__text sa-site-footer__build">
            Build v{buildInfo.version} · <code>{buildInfo.commitShort}</code>
          </p>
        </div>
      </div>
    </footer>
  );
}
