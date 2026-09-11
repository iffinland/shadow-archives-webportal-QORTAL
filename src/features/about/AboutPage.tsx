import { siteConfig } from '../../app/config/siteConfig';

export default function AboutPage() {
  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">About Shadow Archives</h1>
        <p className="sa-route__lead">
          {siteConfig.name} is a Qortal Q-App for publishing and reading an archive of posts, videos
          and gallery media stored on QDN.
        </p>
      </header>

      <div className="sa-route__prose">
        <h2>Where the content lives</h2>
        <p>
          Content is published to QDN under the <code>{siteConfig.qdnService}</code> service. The
          application holds no server, database or account of its own: it reads what the connected
          Qortal host makes available and asks the host to sign anything that is written.
        </p>

        <h2>Who can publish</h2>
        <p>
          Publishing authority belongs to the current owner of the app&rsquo;s publishing name, and
          is resolved at runtime. Owner controls are never derived from a name or address hardcoded
          into this application, and payload fields claiming authorship are not trusted.
        </p>

        <h2>Phase status</h2>
        <p>
          This build is the {siteConfig.phaseLabel.toLowerCase()}: the responsive application shell
          plus read-only QDN content discovery, runtime validation and rendering. Every payload is
          validated before it is trusted, and the archive states distinguish an empty archive from
          an unavailable, partial or stale index.
        </p>
        <p>
          Publishing, editing, likes, comments, tips, sharing and owner studio functionality are
          deliberately not implemented in this phase. Browsing the archive never asks for a Qortal
          account or triggers an authentication prompt.
        </p>

        <h2>Privacy and dependencies</h2>
        <p>
          The shell loads only assets bundled with the app. There are no third-party fonts, image
          CDNs, analytics or external runtime APIs, in line with the QDN content security policy.
        </p>
      </div>
    </div>
  );
}
