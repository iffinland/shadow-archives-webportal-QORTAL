import { lazy, Suspense } from 'react';

import { siteConfig } from '../../app/config/siteConfig';
import { useCapability } from '../../app/providers/CapabilityProvider';
import { SafeRichText } from '../content/richText/SafeRichText';
import { defaultAboutDocument } from './defaultAboutContent';
import { useAboutPage } from './useAboutPage';

/**
 * Owner editing lives behind a dynamic import, so the TipTap editor and the
 * About publish service are fetched only for a verified owner and never ship in
 * the visitor startup graph.
 */
const AboutOwnerPanel = lazy(() => import('./owner/AboutOwnerPanel'));

/**
 * About page.
 *
 * Visitors see the owner-published rich-text document when one exists and is
 * valid, and the built-in default otherwise — both through the same allowlisted
 * renderer + DOMPurify boundary as blog bodies. The owner-only edit control is
 * rendered only for a positively verified owner.
 */
export default function AboutPage() {
  const { isOwner } = useCapability();
  const about = useAboutPage();

  const document = about.document?.data.body ?? defaultAboutDocument();
  const readFailed =
    about.status === 'invalid' || about.status === 'error' || about.status === 'unavailable';

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">About Shadow Archives</h1>
        <p className="sa-route__lead">
          {siteConfig.name} is a Qortal Q-App for publishing and reading an archive of posts, videos
          and gallery media stored on QDN.
        </p>
      </header>

      {isOwner && about.status !== 'loading' ? (
        <Suspense fallback={null}>
          <AboutOwnerPanel initialDoc={document.doc} onPublished={about.reload} />
        </Suspense>
      ) : null}

      {isOwner && readFailed ? (
        <p className="sa-detail__meta" role="status">
          The published About page could not be read from this scope, so the built-in text is shown.
          Saving replaces it.
        </p>
      ) : null}

      <div className="sa-route__prose">
        <SafeRichText doc={document} />
      </div>
    </div>
  );
}
