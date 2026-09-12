import { NavLink } from 'react-router-dom';

import { navItems, ownerNavItems } from '../../app/config/navigation';
import { useCapability } from '../../app/providers/CapabilityProvider';

/**
 * Regular site navigation. `NavLink` sets `aria-current="page"` automatically.
 *
 * Studio is appended after Contact ONLY for a positively verified owner
 * capability. The capability is consumed from the session state that the
 * explicit `/studio` owner flow establishes; rendering navigation never
 * requests an account or permission, so ordinary visitors stay permission-free.
 */
export function SiteNav() {
  const { capability } = useCapability();
  const items = capability === 'owner' ? [...navItems, ...ownerNavItems] : navItems;
  return (
    <nav className="sa-site-nav" aria-label="Site sections">
      <ul className="sa-site-nav__list">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                ['sa-site-nav__link', isActive ? 'sa-site-nav__link--active' : '']
                  .filter(Boolean)
                  .join(' ')
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
