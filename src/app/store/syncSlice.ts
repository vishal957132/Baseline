/**
 * The engine's state, mirrored for the UI.
 *
 * One-way: the engine publishes here through its `onChange`, and screens read
 * selectors. Nothing in the UI calls the engine directly, so a screen cannot
 * start a second drain or mutate queue state behind the engine's back.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { SyncState } from '../../sync/engine';

const initialState: SyncState = {
  online: true,
  running: false,
  lanes: [],
  conflicts: [],
  lastSyncedAt: null,
  sessionExpired: false,
};

const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    /** The engine's whole snapshot. It is the source of truth, not this slice. */
    syncStateChanged: (_state, action: PayloadAction<SyncState>) => action.payload,
  },
});

export const { syncStateChanged } = syncSlice.actions;
export default syncSlice.reducer;

// ── selectors ────────────────────────────────────────────────────────────────

interface WithSync {
  sync: SyncState;
}

export const selectSync = (s: WithSync) => s.sync;
export const selectConflicts = (s: WithSync) => s.sync.conflicts;
export const selectSessionExpired = (s: WithSync) => s.sync.sessionExpired;

/** "Offline · 3 changes waiting to sync" on the dashboard. */
export const selectQueuedCount = (s: WithSync) =>
  s.sync.lanes.reduce((total, lane) => total + lane.queued, 0);

/** Drives the red "NEEDS YOUR ATTENTION" section on the Sync screen. */
export const selectNeedsAttention = (s: WithSync) =>
  s.sync.conflicts.length > 0 || s.sync.lanes.some(l => l.status === 'dead');

/** Sign-out is disabled while unsent changes exist (design page 13). */
export const selectCanSignOut = (s: WithSync) => selectQueuedCount(s) === 0;
