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

import goalsReducer from '../../../app/store/goalsSlice';
import syncReducer, { syncStateChanged } from '../../../app/store/syncSlice';
import unitsReducer from '../../../app/store/unitsSlice';
import { deviceTzOffsetMs, localDayIndex } from '../../../domain/time';
import type { UnitPrefs } from '../../../domain/units';
import { DashboardScreen } from '../DashboardScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

// Goals now come from the store, which is what makes a saved goal reach a
// screen that never remounts.
const GOALS = { steps: 6_000, water: 2_000, weight: 70 };

/** Each card owns one query; the stub answers them all with the same series. */
jest.mock('../../../data/measurementRepo', () => ({
  bucketByDay: jest.fn(),
}));

const repo = () => jest.requireMock('../../../data/measurementRepo');
const TODAY = localDayIndex(Date.now(), deviceTzOffsetMs());
const bucket = (day: number, value: number) => ({ day, value, count: 1 });

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

function mount(queued: number, units: UnitPrefs = {}) {
  const store = configureStore({
    reducer: { goals: goalsReducer, sync: syncReducer, units: unitsReducer },
    preloadedState: { goals: GOALS, units },
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

beforeEach(() => {
  mockNavigate.mockClear();
  repo().bucketByDay.mockResolvedValue([
    bucket(TODAY - 1, 4_000),
    bucket(TODAY, 4_500),
  ]);
});

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

/**
 * The reported bug: a reading eight days old left every card showing "—", as
 * though saving it had failed. The card asked a 7-day window; the reading sat
 * one day outside it. Cards now read the widest window and show the most
 * recent day that has data, stamped with the day it belongs to.
 */
describe('a reading older than the last week', () => {
  beforeEach(() => {
    repo().bucketByDay.mockResolvedValue([bucket(TODAY - 8, 72.6)]);
  });

  it('is still shown rather than reading as missing', async () => {
    await mount(0);
    expect(await screen.findByText('72.6')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });

  /**
   * Asserted on the call, not the render: the repository is mocked, so every
   * other test here passes whatever window the screen asks for. Without this
   * one, narrowing the window back to a week would go unnoticed.
   */
  it('asks for the widest window, which is what makes it findable', async () => {
    await mount(0);
    const [, from, to] = repo().bucketByDay.mock.calls[0];
    expect(Math.round((to - from) / 86_400_000)).toBe(90);
  });

  it('is stamped with the day it was taken', async () => {
    await mount(0);
    // Not "no change recently" — that would be a quietly wrong claim about a
    // figure measured over a week ago.
    expect(await screen.findAllByText(/^as of \d+ \w{3}$/)).toBeTruthy();
    expect(screen.queryByText(/recently/)).toBeNull();
  });
});

describe('with no readings at all', () => {
  beforeEach(() => repo().bucketByDay.mockResolvedValue([]));

  it('shows a dash and says the ring has nothing yet', async () => {
    await mount(0);
    expect(await screen.findByText('no steps recorded yet')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('units', () => {
  it('labels the cards in the chosen unit', async () => {
    await mount(0, { weight: 'lb', sleep: 'hr' });
    expect(await screen.findByText('lb')).toBeTruthy();
    expect(screen.getByText('hr')).toBeTruthy();
  });
});
