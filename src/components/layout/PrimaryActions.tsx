import { externalAppTargets } from '../../app/config/navigation';
import { buildQortalAppUrl } from '../../qortal/navigation';
import { IconExternalApp } from '../common';
import { SearchDisclosure } from './SearchDisclosure';

/**
 * Primary action row: the verified external Qortal apps plus search. Visually
 * stronger than the regular site navigation (owner decision) and reachable by
 * keyboard as real links.
 */
export function PrimaryActions() {
  return (
    <nav className="sa-primary-actions" aria-label="Qortal apps and search">
      <ul className="sa-primary-actions__list">
        {externalAppTargets.map((app) => (
          <li key={app.id}>
            <a className="sa-action-button" href={buildQortalAppUrl(app.appName)}>
              <span className="sa-action-button__label">{app.label}</span>
              <IconExternalApp className="sa-action-button__icon" />
              <span className="sa-visually-hidden">(opens the Qortal app in a new tab)</span>
            </a>
          </li>
        ))}
        <li className="sa-primary-actions__search">
          <SearchDisclosure />
        </li>
      </ul>
    </nav>
  );
}
