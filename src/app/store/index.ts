import { configureStore } from '@reduxjs/toolkit';

import authReducer from './authSlice';
import syncReducer from './syncSlice';
import unitsReducer from './unitsSlice';

/**
 * Redux holds UI state only — sync status and preferences. Measurements live
 * in SQLite and are read through `useQuery`, so there is one source of truth
 * for data and no cache to invalidate.
 */
export const store = configureStore({
  reducer: { auth: authReducer, sync: syncReducer, units: unitsReducer },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
