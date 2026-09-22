/**
 * The dashboard's wiring, not its arithmetic.
 *
 * Both of these were shipped broken and neither could fail a test that only
 * looked at the domain layer: a banner whose button navigated to the navigator
 * it was already inside, and a goal ring measuring against a constant rather
 * than the goal the user set during onboarding. They are the wiring class of
 * defect — built, verified in isolation, connected to the wrong thing.
 */

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import syncReducer, { syncStateChanged } from '../../../app/store/syncSlice';
import unitsReducer from '../../../app/store/unitsSlice';
import type { UnitPrefs } from '../../../domain/units';
import { DashboardScreen } from '../DashboardScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock('../../../data/prefs', () => ({
  getGoals: jest.fn(() => ({ steps: 6000, water: 2000, weight: 70 })),
}));

/** Each card owns one query; the stub answers them all with the same series. */
jest.mock('../../../data/measurementRepo', () => ({
  bucketByDay: jest.fn().mockResolvedValue([
    { day: 20_700, value: 4_000, count: 1 },
    { day: 20_701, value: 4_500, count: 1 },
  ]),
}));

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

function mount(queued: number, units: UnitPrefs = {}) {
  const store = configureStore({
    reducer: { sync: syncReducer, units: unitsReducer },
    preloadedState: { units },
  });
  store.dispatch(
    syncStateChanged({
      online: true,
      running: false,
      lanes: queued > 0
        ? [{
            laneKey: 'weight:2026-09-22', status: 'queued' as const,
            queued, attempts: 0, nextAttemptAt: null,
          }]
        : [],
      conflicts: [],
      lastSyncedAt: null,
      sessionExpired: false,
    }),
  );
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <Provider store={store}>
        <DashboardScreen />
      </Provider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => mockNavigate.mockClear());

describe('the catching-up banner', () => {
  it('appears while changes are still queued', async () => {
    await mount(2);
    expect(screen.getByText('Catching up')).toBeTruthy();
    expect(screen.getByText('2 changes waiting to sync')).toBeTruthy();
  });

  it('stays away when there is nothing queued', async () => {
    await mount(0);
    expect(screen.queryByText('Catching up')).toBeNull();
  });

  /**
   * The bug: `navigate('Tabs')` from a screen already inside Tabs resolves to
   * the tabs themselves and moves nowhere, so the button did nothing at all.
   * It has to name the tab.
   */
  it('takes View to the Sync tab, not to the navigator it is already in', async () => {
    await mount(1);
    await fireEvent.press(screen.getByText('View'));
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Sync' });
  });
});

describe('the steps ring', () => {
  /** Onboarding writes a goal; the ring used to measure against a constant. */
  it('measures against the goal the user set, not a hardcoded one', async () => {
    await mount(0);
    expect(await screen.findByText(/of 6,000/)).toBeTruthy();
  });
});

describe('units', () => {
  it('labels the cards in the chosen unit', async () => {
    await mount(0, { weight: 'lb', sleep: 'hr' });
    expect(await screen.findByText('lb')).toBeTruthy();
    expect(screen.getByText('hr')).toBeTruthy();
  });
});
