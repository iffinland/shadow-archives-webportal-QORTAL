import type { ReactNode } from 'react';

interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly icon?: ReactNode;
  /** Compact variant for the header side panels. */
  readonly compact?: boolean;
  readonly className?: string;
}

/**
 * Honest empty state. Never renders placeholder content that could be mistaken
 * for published QDN data, and never reports a fake zero engagement count.
 */
export function EmptyState({ title, description, icon, compact, className }: EmptyStateProps) {
  return (
    <div
      className={['sa-empty', compact ? 'sa-empty--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {icon ? <span className="sa-empty__icon">{icon}</span> : null}
      <p className="sa-empty__title">{title}</p>
      <p className="sa-empty__description">{description}</p>
    </div>
  );
}
