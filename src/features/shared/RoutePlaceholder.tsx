import type { ReactNode } from 'react';

import { EmptyState } from '../../components/feedback/EmptyState';

interface Detail {
  readonly label: string;
  readonly value: string;
}

interface RoutePlaceholderProps {
  readonly title: string;
  readonly lead: string;
  readonly note: string;
  readonly icon?: ReactNode;
  /** Honest, non-fabricated context such as the requested reference id. */
  readonly details?: readonly Detail[];
}

/**
 * Shared honest placeholder for routes whose feature lands in a later phase.
 * It renders a real heading/lead (so the route resolves meaningfully and
 * document structure is correct) and an explicit status panel — never fake
 * content or non-functional controls.
 */
export function RoutePlaceholder({ title, lead, note, icon, details }: RoutePlaceholderProps) {
  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">{title}</h1>
        <p className="sa-route__lead">{lead}</p>
      </header>

      {details && details.length > 0 ? (
        <dl className="sa-route__details">
          {details.map((detail) => (
            <div className="sa-route__detail" key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className="sa-route__panel" aria-label={`${title} status`}>
        <EmptyState icon={icon} title="Not available in this phase" description={note} />
      </section>
    </div>
  );
}
