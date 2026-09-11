import { EmptyState } from '../../components/feedback';
import { ErrorState } from '../../components/feedback';
import type { ReactNode } from 'react';
import type { DetailStatus } from '../../services/types';

interface EntityStatePanelProps {
  readonly status: DetailStatus | 'loading';
  readonly subject: string;
  readonly message?: string | null;
  readonly onRetry?: () => void;
  readonly icon?: ReactNode;
}

const TITLES: Record<string, string> = {
  missing: 'Not found in the archive',
  invalid: 'This resource failed validation',
  withdrawn: 'Withdrawn by the publisher',
  error: 'This resource could not be loaded',
  unavailable: 'Archive not available here',
};

/** Honest per-resource state panel; never fabricates content for a failure. */
export function EntityStatePanel({
  status,
  subject,
  message,
  onRetry,
  icon,
}: EntityStatePanelProps) {
  if (status === 'ready') return null;

  const title = TITLES[status] ?? `${subject} unavailable`;
  const description =
    message ??
    (status === 'missing'
      ? 'No resource with that reference exists under the verified publisher scope.'
      : 'The requested resource could not be shown.');

  if (status === 'error') {
    return <ErrorState icon={icon} title={title} description={description} onRetry={onRetry} />;
  }
  return <EmptyState icon={icon} title={title} description={description} />;
}
