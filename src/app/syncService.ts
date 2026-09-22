/**
 * Starts the sync engine and keeps it fed.
 *
 * Everything the engine needs is assembled here — the queue, the mock server,
 * the clock, the network — and its state is pushed into the store. This is the
 * only place that owns an engine instance, so there is never a second one
 * draining the same queue.
 *
 * Four things wake it: a local write, launch, the network coming back, and the
 * app returning to the foreground. The write is the one that matters day to
 * day — pressing Save should start the upload, not leave it for whenever the
 * app is next backgrounded.
 */

import type { Dispatch } from '@reduxjs/toolkit';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { subscribeToData } from '../data/changes';
import { getDb } from '../data/db';
import { markSynced } from '../data/measurementRepo';
import { SyncEngine, type SyncState } from '../sync/engine';
import { MockApi } from '../sync/mockApi';
import { sqliteOutbox } from '../sync/outbox';
import { syncStateChanged } from './store/syncSlice';

/** Latency and a small failure rate, so retry and backoff are observable. */
export const api = new MockApi({
  latencyMs: [250, 700],
  failureRate: 0.15,
  seed: 20260921,
});

let engine: SyncEngine | null = null;
let online = true;
/** Wakes the engine when the soonest backoff expires. */
let wakeup: ReturnType<typeof setTimeout> | null = null;
/** NetInfo returns a plain unsubscribe function, AppState an object with
 *  `remove()`, so both are normalised to one shape. */
let unsubscribes: Array<() => void> = [];

export function startSync(dispatch: Dispatch): void {
  if (engine) return;

  engine = new SyncEngine({
    outbox: sqliteOutbox(getDb()),
    api,
    clock: Date.now,
    netInfo: { isOnline: () => online },
    onChange: state => {
      dispatch(syncStateChanged(state));
      scheduleWakeup(state);
    },
    // The server's number is what clears the "Pending" badge.
    onSynced: (op, serverSeq) => markSynced(op.lineageId, serverSeq),
  });

  // Saving a reading writes an op into the queue; this is what notices.
  // Already coalesced to one call per 50ms, and `run()` ignores overlapping
  // calls, so a burst of writes still means one drain.
  const stopWatchingWrites = subscribeToData(drain);

  const stopWatchingNetwork = NetInfo.addEventListener(state => {
    const wasOffline = !online;
    online = state.isConnected === true;
    // Only on the transition back, so a flapping connection does not trigger
    // a drain per event.
    if (online && wasOffline) drain();
  });

  const appStateSub = AppState.addEventListener('change', status => {
    if (status === 'active') drain();
  });

  unsubscribes = [
    stopWatchingWrites,
    stopWatchingNetwork,
    () => appStateSub.remove(),
  ];

  NetInfo.fetch()
    .then(state => {
      online = state.isConnected === true;
      // Anything left mid-flight by a kill is reset before the first drain,
      // otherwise its lane would be blocked by an op that can never be sent.
      return engine?.recover();
    })
    .catch(() => undefined)
    .finally(drain);
}

/** Drain now. Safe to call repeatedly — the engine ignores overlapping runs. */
export function syncNow(): void {
  drain();
}

/** Put a dead or conflicted lane back in play, then send it. */
export function retryLane(laneKey: string): void {
  engine
    ?.retryLane(laneKey)
    .then(() => drain())
    .catch(() => undefined);
}

/** Cancel un-sent work for a record. Backs undo and cancel-vs-delete. */
export async function cancelPending(lineageId: string): Promise<string[]> {
  return (await engine?.cancel(lineageId)) ?? [];
}

export function stopSync(): void {
  unsubscribes.forEach(stop => stop());
  unsubscribes = [];
  if (wakeup) clearTimeout(wakeup);
  wakeup = null;
  engine = null;
}

/**
 * Schedule one drain for when the earliest backoff runs out.
 *
 * Without this a failed op waits for the app to be backgrounded or a button to
 * be pressed — it looks stuck, because nothing is coming back for it. One
 * timer, not a poll: the engine already knows when it next wants to try.
 */
function scheduleWakeup(state: SyncState): void {
  if (wakeup) clearTimeout(wakeup);
  wakeup = null;

  const due = state.lanes
    .map(lane => lane.nextAttemptAt)
    .filter((at): at is number => at !== null);
  if (due.length === 0) return;

  const soonest = Math.min(...due);
  // A floor, so a backoff already in the past cannot spin.
  const delay = Math.max(250, soonest - Date.now());
  wakeup = setTimeout(drain, delay);
}

function drain(): void {
  // Failures are already recorded on the ops themselves and published into the
  // store, so there is nothing useful to do with a rejection here.
  engine?.run().catch(() => undefined);
}
