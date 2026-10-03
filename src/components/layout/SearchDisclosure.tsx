import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { routes } from '../../app/config/navigation';
import { listingHref } from '../../features/content/listing/listingModel';
import type { CatalogListing } from '../../domain';
import { SearchSuggestions } from '../../features/search/SearchSuggestions';
import { useSearchSuggestions } from '../../features/search/useSearchSuggestions';
import { Button, IconClose, IconSearch } from '../common';

const FORM_ID = 'sa-search-form';
const INPUT_ID = 'sa-search-input';
const LIST_ID = 'sa-search-suggestions';

function optionId(index: number): string {
  return `${LIST_ID}-option-${index}`;
}

/**
 * Header search control with live suggestions.
 *
 * Suggestions are filtered from the already-loaded, validated catalog snapshot
 * (no QDN request per keystroke) and follow the combobox pattern: the input
 * keeps focus, Up/Down move `aria-activedescendant`, Enter opens the active
 * result (or falls back to the full search page), and Escape dismisses the list
 * before closing the control. Selecting a result navigates through the shared
 * in-app detail routes.
 */
export function SearchDisclosure() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  // The route the suggestion list belongs to; a later route change hides it.
  const [suggestionsPath, setSuggestionsPath] = useState(location.pathname);

  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { items, loading } = useSearchSuggestions(query);
  const trimmed = query.trim();
  const onSuggestionsRoute = suggestionsPath === location.pathname;
  const showSuggestions = open && !dismissed && onSuggestionsRoute && trimmed.length > 0;
  const hasItems = items.length > 0;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Outside pointer interaction (mouse/touch) dismisses suggestions but leaves
  // the input open so typed text is never lost.
  useEffect(() => {
    if (!showSuggestions) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setDismissed(true);
      setActiveIndex(-1);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showSuggestions]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setDismissed(true);
    setActiveIndex(-1);
    toggleRef.current?.focus();
  }, []);

  const selectListing = useCallback(
    (listing: CatalogListing) => {
      navigate(listingHref(listing));
      setOpen(false);
      setQuery('');
      setDismissed(true);
      setActiveIndex(-1);
    },
    [navigate],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const active = activeIndex >= 0 ? items[activeIndex] : undefined;
    if (showSuggestions && active) {
      selectListing(active);
      return;
    }
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    navigate(`${routes.search}?q=${encodeURIComponent(trimmed)}`);
    setOpen(false);
    setQuery('');
    setDismissed(true);
    setActiveIndex(-1);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (trimmed.length === 0 || !hasItems) return;
      event.preventDefault();
      if (dismissed || !onSuggestionsRoute) {
        setDismissed(false);
        setSuggestionsPath(location.pathname);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((previous) => Math.min(items.length - 1, previous + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!showSuggestions || !hasItems) return;
      event.preventDefault();
      setActiveIndex((previous) => Math.max(-1, previous - 1));
    }
  };

  const onWrapperKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    // First Escape dismisses the suggestion list; a second one closes the control.
    if (showSuggestions) {
      setDismissed(true);
      setActiveIndex(-1);
      return;
    }
    close();
  };

  return (
    <div
      className="sa-search"
      data-open={open ? 'true' : 'false'}
      ref={rootRef}
      onKeyDown={onWrapperKeyDown}
    >
      <button
        ref={toggleRef}
        type="button"
        className="sa-button sa-button--ghost sa-button--icon sa-search__toggle"
        aria-expanded={open}
        aria-controls={FORM_ID}
        aria-label={open ? 'Close search' : 'Search the archive'}
        onClick={() => {
          setOpen((previous) => !previous);
          setDismissed(false);
          setActiveIndex(-1);
          setSuggestionsPath(location.pathname);
        }}
      >
        {open ? <IconClose /> : <IconSearch />}
      </button>

      <div className="sa-search__panel">
        <form
          id={FORM_ID}
          className="sa-search__form"
          role="search"
          hidden={!open}
          onSubmit={onSubmit}
        >
          <label className="sa-visually-hidden" htmlFor={INPUT_ID}>
            Search Shadow Archives
          </label>
          <input
            ref={inputRef}
            id={INPUT_ID}
            className="sa-search__input"
            type="search"
            name="q"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls={showSuggestions ? LIST_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              showSuggestions && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            value={query}
            autoComplete="off"
            placeholder="Search the archive…"
            onChange={(event) => {
              setQuery(event.target.value);
              setDismissed(false);
              setActiveIndex(-1);
              setSuggestionsPath(location.pathname);
            }}
            onKeyDown={onInputKeyDown}
          />
          <Button type="submit" variant="primary" size="sm">
            Search
          </Button>
        </form>

        {showSuggestions && hasItems ? (
          <SearchSuggestions
            items={items}
            query={trimmed}
            activeIndex={activeIndex}
            listId={LIST_ID}
            optionId={optionId}
            onSelect={selectListing}
            onActiveIndexChange={setActiveIndex}
          />
        ) : null}

        {showSuggestions && !hasItems && !loading ? (
          <p className="sa-search__no-results" role="status">
            No matching content
          </p>
        ) : null}
      </div>
    </div>
  );
}
