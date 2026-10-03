import { useMemo, type MouseEvent } from 'react';

import { typeKindLabel } from '../content/format';
import type { CatalogListing } from '../../domain';
import { highlightSegments } from './highlight';

interface HighlightedTextProps {
  readonly text: string;
  readonly query: string;
}

/** Renders matched query text as <mark> nodes; never builds HTML. */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  const segments = useMemo(() => highlightSegments(text, query), [text, query]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark className="sa-search__match" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export interface SearchSuggestionsProps {
  readonly items: readonly CatalogListing[];
  readonly query: string;
  readonly activeIndex: number;
  readonly listId: string;
  readonly optionId: (index: number) => string;
  readonly onSelect: (listing: CatalogListing) => void;
  readonly onActiveIndexChange: (index: number) => void;
}

/**
 * Compact suggestion listbox for the header search.
 *
 * Follows the combobox pattern: options are not focusable and never take focus
 * away from the input. Keyboard navigation is handled by the input through
 * `aria-activedescendant`; pointer selection is handled here. `onMouseDown` is
 * prevented so a click keeps the input focused and cannot close the listbox
 * before the click is delivered.
 */
export function SearchSuggestions({
  items,
  query,
  activeIndex,
  listId,
  optionId,
  onSelect,
  onActiveIndexChange,
}: SearchSuggestionsProps) {
  const keepFocus = (event: MouseEvent<HTMLUListElement>) => event.preventDefault();

  return (
    <ul
      id={listId}
      role="listbox"
      aria-label="Search suggestions"
      className="sa-search__suggestions"
      onMouseDown={keepFocus}
    >
      {items.map((listing, index) => {
        const title = listing.title || 'Untitled';
        return (
          <li
            key={listing.identifier}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            className={`sa-search__suggestion${
              index === activeIndex ? ' sa-search__suggestion--active' : ''
            }`}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onSelect(listing)}
          >
            <span className="sa-search__suggestion-type">{typeKindLabel(listing.type)}</span>
            <span className="sa-search__suggestion-title">
              <HighlightedText text={title} query={query} />
            </span>
            {listing.excerpt ? (
              <span className="sa-search__suggestion-excerpt">
                <HighlightedText text={listing.excerpt} query={query} />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
