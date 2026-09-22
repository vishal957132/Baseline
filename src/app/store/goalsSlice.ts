/**
 * The targets each metric is measured against.
 *
 * In Redux for the same reason the units are: it is a preference several
 * unrelated screens render from, and MMKV is not reactive. Saving a goal has
 * to redraw the dashboard ring, the Settings summary and the metric screen at
 * once — before this, only the metric screen looked right, and only because
 * navigating to it remounts it. The dashboard and Settings sit in tabs that
 * stay mounted, so they kept showing the old target until the app restarted.
 *
 * It holds a setting, not data. Readings stay in SQLite; a goal only decides
 * what progress is measured against, and changing one never rewrites history.
 *
 * Hydrated at launch by `goalsRestored`, the same shape as `unitsRestored`, so
 * the slice imports no storage and stays testable.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { Goals } from '../../data/prefs';

const initialState: Goals = {};

const goalsSlice = createSlice({
  name: 'goals',
  initialState,
  reducers: {
    goalsRestored: (_state, action: PayloadAction<Goals>) => action.payload,

    /**
     * Merged, not replaced — mirroring `setGoals`, so a caller may send one
     * goal without dropping the others, and may clear one by sending it as
     * undefined.
     */
    goalsChanged: (state, action: PayloadAction<Goals>) => ({
      ...state,
      ...action.payload,
    }),
  },
});

export const { goalsRestored, goalsChanged } = goalsSlice.actions;
export default goalsSlice.reducer;

interface WithGoals {
  goals: Goals;
}

export const selectGoals = (state: WithGoals): Goals => state.goals;
