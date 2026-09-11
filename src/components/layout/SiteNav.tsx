import { NavLink } from 'react-router-dom';

import { navItems } from '../../app/config/navigation';

/** Regular site navigation. `NavLink` sets `aria-current="page"` automatically. */
export function SiteNav() {
  return (
    <nav className="sa-site-nav" aria-label="Site sections">
      <ul className="sa-site-nav__list">
        {navItems.map((item) => (
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
