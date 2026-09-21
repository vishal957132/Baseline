export type MetricId = 'weight' | 'steps' | 'sleep' | 'water' | 'energy';

export type SourceId =
  | 'manual'
  | 'apple_health'
  | 'health_connect'
  | 'json_feed'
  | 'withings';

export type EventKind = 'create' | 'update' | 'delete' | 'import';

/**
 * A single reading.
 *
 * Three time fields, each with one job:
 *  - recordedAt: phone clock. What the reading is about. Shown to the user,
 *    never used to order anything.
 *  - serverSeq:  assigned by the server on upload. The ordering authority.
 *  - localSeq:   local counter. Orders rows with no serverSeq yet, which
 *    always sort after rows that have one.
 */
export interface Measurement {
  id: string;
  /** Groups a create with its later edits. Defaults to `id`. */
  lineageId: string;
  /** `weight:2026-09-21` — the unit of both ordering and conflict. */
  laneKey: string;
  metric: MetricId;
  value: number;
  unit: string;
  recordedAt: number;
  updatedAt: number;
  source: SourceId;
  /** Provider id. Null for manual entries. */
  externalId: string | null;
  serverSeq: number | null;
  localSeq: number;
  deletedAt: number | null;
}

export interface Conflict {
  id: string;
  laneKey: string;
  candidateIds: string[];
  suggestedId: string;
  resolvedAt: number | null;
}

/** One chart point. `day` is a local day index. */
export interface DayBucket {
  day: number;
  value: number;
  count: number;
}
