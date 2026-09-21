/**
 * The sync engine. Drains the outbox lane by lane.
 *
 * Order holds inside a lane, never across them. Up to three lanes run at once,
 * so a lane stuck on its sixth retry cannot delay an unrelated one.
 *
 * Everything it depends on is injected — the queue, the API, the clock, the
 * network — so tests drive failure and time without waiting for either. Note
 * it takes an `outbox`, not a database: the engine's only business is the
 * queue, and handing it a raw connection would let it reach past that.
 */

import { ApiError, type PushResult, type ServerRow } from './mockApi';
import type { Op, Outbox } from './outbox';

export const MAX_ATTEMPTS = 6;
export const MAX_LANES = 3;
const BACKOFF_BASE_MS = 1_000;

/** 1s, 2s, 4s, 8s, 16s, 32s. */
export function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** attempts;
}

export interface LaneState {
  laneKey: string;
  status: 'sending' | 'retrying' | 'dead' | 'conflict';
  queued: number;
  attempts: number;
  nextAttemptAt: number | null;
}

export interface SyncState {
  online: boolean;
  running: boolean;
  lanes: LaneState[];
  conflicts: Array<{ laneKey: string; server: ServerRow }>;
  lastSyncedAt: number | null;
  /** A 401 — the Session Ended modal listens for this. */
  sessionExpired: boolean;
}

export interface EngineDeps {
  outbox: Outbox;
  api: {
    push(op: {
      id: string;
      laneKey: string;
      kind: Op['kind'];
      payload: string;
    }): Promise<PushResult>;
  };
  clock: () => number;
  netInfo: { isOnline(): boolean };
  /** Where state goes. The UI reads the store, never this class. */
  onChange?: (state: SyncState) => void;
}

export class SyncEngine {
  private conflicts = new Map<string, ServerRow>();
  private busy = new Set<string>();
  private lastSyncedAt: number | null = null;
  private sessionExpired = false;
  private running = false;

  constructor(private deps: EngineDeps) {}

  /**
   * Drain until nothing is sendable.
   *
   * Re-entrant calls are ignored rather than queued — a second trigger while a
   * run is in flight would send the same op twice.
   */
  async run(): Promise<SyncState> {
    if (this.running) return this.snapshot();
    if (this.sessionExpired || !this.deps.netInfo.isOnline()) return this.publish();

    this.running = true;
    await this.publish();
    try {
      let lanes = await this.readyLanes();
      while (lanes.length > 0 && !this.sessionExpired) {
        await Promise.all(lanes.map(lane => this.drainLane(lane)));
        lanes = await this.readyLanes();
      }
      this.lastSyncedAt = this.deps.clock();
    } finally {
      this.running = false;
    }
    return this.publish();
  }

  /** Cancel un-sent work for a lineage. Backs undo and cancel-vs-delete. */
  async cancel(lineageId: string): Promise<string[]> {
    const cancelled = await this.deps.outbox.cancelPendingOp(lineageId);
    await this.publish();
    return cancelled;
  }

  /**
   * The user picked a winner, or pressed "Retry this lane".
   *
   * Clearing the in-memory conflict is not enough: the op itself is parked in a
   * terminal state, so the queue has to put the lane back in play too.
   */
  async retryLane(laneKey: string): Promise<SyncState> {
    this.conflicts.delete(laneKey);
    await this.deps.outbox.retryLane(laneKey);
    return this.publish();
  }

  /** Free lanes, capped at MAX_LANES concurrent. */
  private async readyLanes(): Promise<string[]> {
    const ready = await this.deps.outbox.readyLanes(this.deps.clock());
    return ready.filter(lane => !this.busy.has(lane)).slice(0, MAX_LANES);
  }

  /** Send a lane's ops in localSeq order until it stalls or empties. */
  private async drainLane(laneKey: string): Promise<void> {
    this.busy.add(laneKey);
    try {
      for (;;) {
        const op = await this.deps.outbox.claimNext(laneKey, this.deps.clock());
        if (!op) return;
        const keepGoing = await this.send(op);
        if (!keepGoing) return;
      }
    } finally {
      this.busy.delete(laneKey);
    }
  }

  /** @returns whether the lane may continue. */
  private async send(op: Op): Promise<boolean> {
    const { outbox, api, clock } = this.deps;
    try {
      const result = await api.push({
        id: op.id,
        laneKey: op.laneKey,
        kind: op.kind,
        payload: op.payload,
      });

      if (result.status === 'conflict') {
        this.conflicts.set(op.laneKey, result.server);
        await outbox.markConflict(op.id);
        await this.publish();
        return false; // the lane waits for the user
      }

      // `duplicate: true` means the server had already applied it — a replay
      // after a lost acknowledgement. Success, not an error.
      await outbox.complete(op.id);
      return true;
    } catch (error) {
      return this.onFailure(op, error, clock());
    }
  }

  private async onFailure(op: Op, error: unknown, now: number): Promise<boolean> {
    const apiError = error instanceof ApiError ? error : null;

    // A 401 cannot be retried into success. Stop everything.
    if (apiError?.status === 401) {
      this.sessionExpired = true;
      await this.deps.outbox.fail(op.id, now + backoffMs(op.attempts));
      await this.publish();
      return false;
    }

    const attempts = op.attempts + 1;
    const giveUp = !apiError?.retryable || attempts >= MAX_ATTEMPTS;
    await this.deps.outbox.fail(op.id, giveUp ? null : now + backoffMs(op.attempts));
    await this.publish();
    return false; // the lane's head is blocked either way
  }

  /** The current state. `all()` is ordered by localSeq, so a lane's first op
   *  is its head — and the head is what the lane is waiting on. */
  async snapshot(): Promise<SyncState> {
    const lanes = new Map<string, LaneState>();

    for (const op of await this.deps.outbox.all()) {
      const lane = lanes.get(op.laneKey);
      if (lane) {
        lane.queued += 1;
      } else {
        lanes.set(op.laneKey, {
          laneKey: op.laneKey,
          status: laneStatus(op.status),
          queued: 1,
          attempts: op.attempts,
          nextAttemptAt: op.nextAttemptAt,
        });
      }
    }

    return {
      online: this.deps.netInfo.isOnline(),
      running: this.running,
      lanes: [...lanes.values()],
      conflicts: [...this.conflicts].map(([laneKey, server]) => ({ laneKey, server })),
      lastSyncedAt: this.lastSyncedAt,
      sessionExpired: this.sessionExpired,
    };
  }

  private async publish(): Promise<SyncState> {
    const next = await this.snapshot();
    this.deps.onChange?.(next);
    return next;
  }
}

function laneStatus(status: Op['status']): LaneState['status'] {
  if (status === 'dead') return 'dead';
  if (status === 'conflict') return 'conflict';
  if (status === 'failed') return 'retrying';
  return 'sending';
}
