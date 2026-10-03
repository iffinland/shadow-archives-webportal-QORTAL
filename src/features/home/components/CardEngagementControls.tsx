import { useMemo } from 'react';

import type { ContentCardModel } from '../../../types/content';
import { EngagementControls } from '../../engagement/EngagementControls';
import { engagementItemFromCard } from '../../engagement/engagementItem';

/**
 * Card adapter over the shared engagement quick actions.
 *
 * Cards already carry the full entity identifier and in-app href, so they map
 * straight onto the shared descriptor used by the detail views.
 */
export function CardEngagementControls({ item }: { readonly item: ContentCardModel }) {
  const engagementItem = useMemo(() => engagementItemFromCard(item), [item]);
  return <EngagementControls item={engagementItem} />;
}
