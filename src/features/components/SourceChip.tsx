import React from 'react';

import type { SourceId } from '../../domain/types';
import { Chip } from '../../ui';

/** Short names, because the card is narrow. Android says "HC" (design page 14). */
const LABELS: Record<SourceId, string> = {
  manual: 'Manual',
  apple_health: 'Health',
  health_connect: 'HC',
  json_feed: 'Feed',
  withings: 'Withings',
};

/** Where a reading came from. Manual reads neutral; imports read green. */
export function SourceChip({ source }: { source: SourceId }) {
  return (
    <Chip label={LABELS[source]} tone={source === 'manual' ? 'neutral' : 'provider'} />
  );
}
