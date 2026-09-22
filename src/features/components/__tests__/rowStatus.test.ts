/**
 * What a history row's badge means.
 *
 * The reported bug: readings brought in by "Get my latest readings" showed
 * "Waiting to sync" for ever, while the Sync tab showed an empty queue. Both
 * screens were telling the truth about what they looked at — the badge asked
 * `server_seq IS NULL`, and an import has no server sequence and never gets
 * one, because `importMeasurements` queues nothing. The Sync tab reads the
 * outbox, which had nothing in it. The badge was asking the wrong question.
 */

import type { Measurement } from '../../../domain/types';
import { rowStatus } from '../rowStatus';

const row = (over: Partial<Measurement> = {}): Measurement => ({
  id: 'm1', lineageId: 'm1', laneKey: 'weight:2026-09-22', metric: 'weight',
  value: 72.6, unit: 'kg', recordedAt: 0, updatedAt: 0,
  source: 'manual', externalId: null, serverSeq: null, localSeq: 1,
  deletedAt: null,
  ...over,
});

describe('rowStatus', () => {
  it('is pending only while the outbox still holds work for it', () => {
    expect(rowStatus(row(), new Set(['m1']))).toBe('pending');
  });

  it('is synced once the server has acknowledged it', () => {
    expect(rowStatus(row({ serverSeq: 7 }), new Set())).toBe('synced');
  });

  /**
   * The reported case. An imported reading has no server sequence and nothing
   * queued, so it is neither pending nor synced — it is simply here.
   */
  it('is stored, not pending, for a reading that was never queued', () => {
    const imported = row({
      source: 'health_connect',
      externalId: 'hc-w-1',
      serverSeq: null,
    });
    expect(rowStatus(imported, new Set())).toBe('stored');
  });

  /**
   * Editing an imported reading does create upload work, so it goes back to
   * pending — which is why the source alone cannot decide this.
   */
  it('is pending again once an imported reading is edited', () => {
    const edited = row({ source: 'health_connect', externalId: 'hc-w-1' });
    expect(rowStatus(edited, new Set(['m1']))).toBe('pending');
  });

  /** The queue is keyed by lineage, so a correction matches its original. */
  it('matches on lineage rather than row id', () => {
    const correction = row({ id: 'm1-v2', lineageId: 'm1' });
    expect(rowStatus(correction, new Set(['m1']))).toBe('pending');
    expect(rowStatus(correction, new Set(['m1-v2']))).toBe('stored');
  });
});
