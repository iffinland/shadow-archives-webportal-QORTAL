import { TopListPanel } from './TopListPanel';

/**
 * Top Posts / Top Videos row, rendered in the persistent shell directly below
 * the banner. Side-by-side from the `md` breakpoint; stacked and still compact
 * on narrow viewports.
 */
export function TopLists() {
  return (
    <div className="sa-top-lists">
      <TopListPanel kind="posts" />
      <TopListPanel kind="videos" />
    </div>
  );
}
