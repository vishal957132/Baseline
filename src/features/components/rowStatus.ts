/**
 * What a history row's badge should say.
 *
 * One function, used by History and the metric screen, because they showed the
 * same row and derived its state separately — and both derived it from
 * `serverSeq === null`, which is not the same question as "is anything still
 * waiting to upload".
 */

import type { Measurement } from '../../domain/types';
import type { RowStatus } from './MeasurementRow';

export function rowStatus(m: Measurement, pending: Set<string>): RowStatus {
  // Outstanding upload work is the only thing that makes a row pending, and
  // the outbox is the only place that knows.
  if (pending.has(m.lineageId)) return 'pending';
  if (m.serverSeq !== null) return 'synced';
  // No queue entry and no server sequence: it arrived from a health app and
  // this app was never going to upload it.
  return 'stored';
}
