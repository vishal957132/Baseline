/**
 * Which unit each metric is displayed in.
 *
 * In Redux rather than read straight from MMKV at each call site, for the same
 * reason the sync status is: it is UI state that several unrelated screens
 * render from, and MMKV is not reactive — changing the unit in Settings has to
 * redraw the dashboard, the chart axes and the history rows at once.
 *
 * It holds a preference, not data. The readings themselves stay in SQLite in
 * canonical units; this only decides how they are read back.
 *
 * Hydrated at launch by `unitsRestored`, the same shape as `sessionRestored`,
 * so the slice itself imports no storage and stays testable.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { MetricId } from '../../domain/types';
import type { UnitId, UnitPrefs } from '../../domain/units';

const initialState: UnitPrefs = {};

const unitsSlice = createSlice({
  name: 'units',
  initialState,
  reducers: {
    unitsRestored: (_state, action: PayloadAction<UnitPrefs>) => action.payload,

    unitChanged: (state, action: PayloadAction<{ metric: MetricId; unit: UnitId }>) => {
      state[action.payload.metric] = action.payload.unit;
    },
  },
});

export const { unitsRestored, unitChanged } = unitsSlice.actions;
export default unitsSlice.reducer;

interface WithUnits {
  units: UnitPrefs;
}

export const selectUnits = (state: WithUnits): UnitPrefs => state.units;
