import { Link } from 'react-router-dom';

import { routes } from '../../app/config/navigation';

export default function NotFoundPage() {
  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Page not found</h1>
        <p className="sa-route__lead">
          That address does not match any section of the archive. It may be a mistyped or outdated
          link.
        </p>
      </header>
      <p className="sa-route__actions">
        <Link className="sa-button sa-button--primary sa-button--md" to={routes.home}>
          Back to the front page
        </Link>
      </p>
    </div>
  );
}
