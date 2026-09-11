import { Link } from 'react-router-dom';

interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly hrefFor: (page: number) => string;
  readonly label: string;
}

/** Accessible prev/next pagination; every control is a real link. */
export function Pagination({ page, pageCount, hrefFor, label }: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <nav className="sa-listing__pagination" aria-label={`${label} pages`}>
      {page > 1 ? (
        <Link
          className="sa-button sa-button--secondary sa-button--md"
          to={hrefFor(page - 1)}
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <span
          className="sa-button sa-button--secondary sa-button--md sa-button--disabled"
          aria-hidden="true"
        >
          Previous
        </span>
      )}
      <span className="sa-listing__page-status" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link
          className="sa-button sa-button--secondary sa-button--md"
          to={hrefFor(page + 1)}
          rel="next"
        >
          Next
        </Link>
      ) : (
        <span
          className="sa-button sa-button--secondary sa-button--md sa-button--disabled"
          aria-hidden="true"
        >
          Next
        </span>
      )}
    </nav>
  );
}
