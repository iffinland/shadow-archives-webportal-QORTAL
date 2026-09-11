import type { ReactNode } from 'react';

import { Button } from '../common/Button';

interface ErrorStateProps {
  readonly title: string;
  readonly description: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly icon?: ReactNode;
  readonly className?: string;
}

/**
 * Retry-ready error presentation. The retry control is only rendered when a
 * real retry handler exists — no decorative buttons.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Try again',
  icon,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={['sa-error', className].filter(Boolean).join(' ')}
      role="alert"
      aria-live="assertive"
    >
      {icon ? <span className="sa-error__icon">{icon}</span> : null}
      <p className="sa-error__title">{title}</p>
      <p className="sa-error__description">{description}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
