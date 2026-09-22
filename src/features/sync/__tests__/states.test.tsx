import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import syncReducer, { syncStateChanged } from '../../../app/store/syncSlice';
import type { LaneState, SyncState } from '../../../sync/engine';
import { SyncScreen } from '../SyncScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../../../data/measurementRepo', () => ({
  openConflicts: jest.fn().mockResolvedValue([]),
}));

const repo = () => jest.requireMock('../../../data/measurementRepo');

beforeEach(() => repo().openConflicts.mockReset().mockResolvedValue([]));

const lane = (over: Partial<LaneState> = {}): LaneState => ({
  laneKey: 'weight:2026-09-21',
  status: 'sending',
  queued: 1,
  attempts: 0,
  nextAttemptAt: null,
  ...over,
});

const SAFE_FRAME = { x: 0, y: 0, width: 390, height: 844 };
const SAFE_INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

function mount(state: Partial<SyncState>, props = {}) {
  const store = configureStore({ reducer: { sync: syncReducer } });
  store.dispatch(
    syncStateChanged({
      online: true, running: false, lanes: [], conflicts: [],
      lastSyncedAt: null, sessionExpired: false, ...state,
    }),
  );
  return render(
    <SafeAreaProvider initialMetrics={{ frame: SAFE_FRAME, insets: SAFE_INSETS }}>
    <Provider store={store}>
      <SyncScreen {...props} />
    </Provider>
    </SafeAreaProvider>,
  );
}

describe('nothing queued', () => {
  it('says so rather than showing an empty list', async () => {
    await mount({ lanes: [] });
    expect(screen.getByText('Everything is up to date')).toBeTruthy();
  });
});

describe('waiting for a connection', () => {
  it('reports offline and when it last worked', async () => {
    await mount({ online: false, lastSyncedAt: Date.UTC(2026, 8, 21, 9, 47) });
    expect(screen.getByText('Waiting for a connection')).toBeTruthy();
    expect(screen.getByText(/Last successful sync/)).toBeTruthy();
  });

  it('admits when nothing has ever synced', async () => {
    await mount({ online: false, lastSyncedAt: null });
    expect(screen.getByText('Nothing has synced yet')).toBeTruthy();
  });
});

describe('a lane that gave up', () => {
  const state = {
    lanes: [
      lane({ status: 'dead', queued: 2, attempts: 6 }),
      lane({ laneKey: 'water:2026-09-21', status: 'sending', queued: 1 }),
    ],
  };

  it('names what failed and how many tries it took', async () => {
    await mount(state);
    expect(screen.getByText(/Couldn’t upload Weight · 21 Sep/)).toBeTruthy();
    expect(screen.getByText(/Gave up after 6 tries/)).toBeTruthy();
  });

  /** "Nothing was lost" is the point — the user needs to know the data is safe. */
  it('says the changes are still on the device', async () => {
    await mount(state);
    expect(screen.getByText(/2 changes are still on this device/)).toBeTruthy();
  });

  it('offers a retry that reaches the engine', async () => {
    const onRetryAll = jest.fn();
    await mount(state, { onRetryAll });
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetryAll).toHaveBeenCalled();
  });

  it('lists every group, so a good one is visibly unaffected', async () => {
    await mount(state);
    expect(screen.getByText('WHAT IS WAITING')).toBeTruthy();
    // The failed group says what is held; the healthy one still reads as sending.
    expect(screen.getByText('2 not sent')).toBeTruthy();
    expect(screen.getAllByText('Sending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Water · 21 Sep').length).toBeGreaterThan(0);
  });

  it('shows no failure banner when every lane is healthy', async () => {
    await mount({ lanes: [lane()] });
    expect(screen.queryByText('WHAT IS WAITING')).toBeNull();
    expect(screen.queryByText(/Gave up after/)).toBeNull();
  });
});

/**
 * These come from the `conflicts` table, not from the engine. The engine only
 * learns about conflicts the *server* reports; one detected locally — a typed
 * reading disagreeing with an imported one — is a row, and reading the store
 * here made every local conflict invisible.
 */
describe('a lane needing a decision', () => {
  const openConflict = {
    id: 'cf-1',
    laneKey: 'weight:2026-09-21',
    candidateIds: ['a', 'b'],
    suggestedId: 'a',
    resolvedAt: null,
  };

  it('surfaces a locally detected conflict with a way into it', async () => {
    repo().openConflicts.mockResolvedValue([openConflict]);
    await mount({ lanes: [] });

    expect(await screen.findByText('NEEDS YOUR ATTENTION')).toBeTruthy();
    expect(screen.getByText(/Weight · 21 Sep has two different values/)).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
  });

  /** The queue having drained is exactly when a local conflict is left over. */
  it('shows it even when everything has already synced', async () => {
    repo().openConflicts.mockResolvedValue([openConflict]);
    await mount({ lanes: [] });

    expect(await screen.findByText('Everything is up to date')).toBeTruthy();
    expect(screen.getByText('NEEDS YOUR ATTENTION')).toBeTruthy();
  });

  it('shows nothing to decide when the table is empty', async () => {
    await mount({ lanes: [] });
    expect(screen.queryByText('NEEDS YOUR ATTENTION')).toBeNull();
  });
});
