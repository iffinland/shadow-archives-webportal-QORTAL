import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { routes } from '../../app/config/navigation';
import { Button, IconClose, IconSearch } from '../common';

const FORM_ID = 'sa-search-form';
const INPUT_ID = 'sa-search-input';

/**
 * Compact search control that expands into an input. Phase 1B implements the
 * shell interaction only; submitting navigates to `/search?q=…`, where the deep
 * search engine is explicitly documented as not yet implemented.
 */
export function SearchDisclosure() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    navigate(`${routes.search}?q=${encodeURIComponent(trimmed)}`);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="sa-search" data-open={open ? 'true' : 'false'} onKeyDown={onKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        className="sa-button sa-button--ghost sa-button--icon sa-search__toggle"
        aria-expanded={open}
        aria-controls={FORM_ID}
        aria-label={open ? 'Close search' : 'Search the archive'}
        onClick={() => setOpen((previous) => !previous)}
      >
        {open ? <IconClose /> : <IconSearch />}
      </button>

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
          value={query}
          autoComplete="off"
          placeholder="Search the archive…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="primary" size="sm">
          Search
        </Button>
      </form>
    </div>
  );
}
