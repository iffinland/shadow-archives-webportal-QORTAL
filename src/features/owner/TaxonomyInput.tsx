import { useId, useState, type KeyboardEvent } from 'react';

import { IconClose } from '../../components/common';
import { LIMITS } from '../../domain/constants';
import { dedupeTaxonomy, toTaxonomyReference } from '../../domain/taxonomy';
import type { TaxonomyReference } from '../../domain/types';

/**
 * Categories/tags editor.
 *
 * Suggestions come from the already-loaded catalog taxonomy (`useArchive()`),
 * so there is never a QDN request per keypress. Normalisation reuses the existing
 * taxonomy utilities — this component must not invent a second implementation.
 */
export interface TaxonomyInputProps {
  readonly label: string;
  readonly values: readonly string[];
  readonly suggestions: readonly TaxonomyReference[];
  readonly onChange: (next: string[]) => void;
  readonly hint?: string;
}

export function TaxonomyInput({ label, values, suggestions, onChange, hint }: TaxonomyInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const commit = () => {
    const raw = draft.trim();
    if (raw.length === 0) return;
    const reference = toTaxonomyReference(raw);
    if (!reference) {
      setError('Use letters, numbers, spaces or dashes (max 120 characters).');
      return;
    }
    const next = dedupeTaxonomy([
      ...values
        .map((value) => toTaxonomyReference(value))
        .filter((v): v is TaxonomyReference => v !== null),
      reference,
    ]).map((entry) => entry.label);
    if (next.length > LIMITS.taxonomyArray) {
      setError(`At most ${LIMITS.taxonomyArray} entries.`);
      return;
    }
    setError(null);
    setDraft('');
    onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="sa-field">
      <label className="sa-field__label" htmlFor={listId}>
        {label}
      </label>
      {hint ? <p className="sa-field__hint">{hint}</p> : null}
      {values.length > 0 ? (
        <ul className="sa-taxonomy-edit">
          {values.map((value) => (
            <li className="sa-taxonomy-edit__item" key={value}>
              <span>{value}</span>
              <button
                type="button"
                className="sa-taxonomy-edit__remove"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
              >
                <IconClose width={12} height={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sa-field__row">
        <input
          id={listId}
          className="sa-input"
          type="text"
          list={`${listId}-suggestions`}
          value={draft}
          maxLength={120}
          placeholder="Type and press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <datalist id={`${listId}-suggestions`}>
          {suggestions.slice(0, 200).map((suggestion) => (
            <option key={suggestion.slug} value={suggestion.label} />
          ))}
        </datalist>
        <button
          type="button"
          className="sa-button sa-button--secondary sa-button--sm"
          onClick={commit}
        >
          Add
        </button>
      </div>
      {error ? (
        <p className="sa-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
