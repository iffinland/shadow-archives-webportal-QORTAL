import { useCallback, useEffect, useState } from 'react';

import { usePrefersReducedMotion } from '../../utils/motion';
import { IconChevronUp } from './icons';

/** Vertical scroll distance (px) after which the control appears. */
const VISIBILITY_THRESHOLD_PX = 400;

/**
 * Reusable "Back to top" control.
 *
 * Hidden near the page top, appears after a meaningful downward scroll and is
 * fixed near the lower edge. It is a real button with an accessible name and
 * skips smooth scrolling when the user prefers reduced motion.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const update = () => {
      const scrolled = window.scrollY || document.documentElement.scrollTop || 0;
      setVisible(scrolled > VISIBILITY_THRESHOLD_PX);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    const main = document.getElementById('sa-main');
    if (main) main.focus({ preventScroll: true });
  }, [reducedMotion]);

  return (
    <button
      type="button"
      className="sa-back-to-top"
      data-visible={visible ? 'true' : 'false'}
      tabIndex={visible ? 0 : -1}
      aria-label="Back to top"
      title="Back to top"
      onClick={scrollToTop}
    >
      <IconChevronUp width={22} height={22} />
    </button>
  );
}
