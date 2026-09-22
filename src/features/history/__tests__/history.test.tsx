import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import authReducer from '../../../app/store/authSlice';
import syncReducer from '../../../app/store/syncSlice';
import { notifyDataChanged } from '../../../data/changes';
import { HistoryScreen } from '../HistoryScreen';

jest.mock('../../../data/measurementRepo', () => ({
  historyPage: jest.fn().mockResolvedValue([]),
  pendingLineageIds: jest.fn().mockResolvedValue(new Set()),
  removeMeasurement: jest.fn().mockResolvedValue(undefined),
  takeLastDeletion: jest.fn().mockReturnValue(null),
  undoDelete: jest.fn().mockResolvedValue(undefined),
  UNDO_WINDOW_MS: 5000,
}));

// `jest.mock` is hoisted above the file, so the factory may only close over
// variables whose names start with `mock`.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

/**
 * The op-sqlite stub answers with no rows, so History is legitimately empty —
 * which is the state this bug lived in. `findBy*` rather than `getBy*`, because
 * the first page loads asynchronously and the empty state only appears after.
 */
const SAFE_FRAME = { x: 0, y: 0, width: 390, height: 844 };
const SAFE_INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: SAFE_FRAME, insets: SAFE_INSETS }}>
    <Provider store={configureStore({ reducer: { auth: authReducer, sync: syncReducer } })}>
      <HistoryScreen />
    </Provider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockNavigate.mockClear();
  const repo = jest.requireMock('../../../data/measurementRepo');
  repo.historyPage.mockReset().mockResolvedValue([]);
  repo.pendingLineageIds.mockReset().mockResolvedValue(new Set());
  repo.takeLastDeletion.mockReset().mockReturnValue(null);
});

/**
 * Opening the log sheet from a filtered History used to land on Weight
 * whatever you were looking at, because the filter was not passed along.
 */
describe('adding from a filtered History', () => {
  it('opens the sheet on the metric being filtered', async () => {
    await mount();
    await fireEvent.press(screen.getByText('Water'));
    await fireEvent.press(await screen.findByText('Add your first entry'));

    expect(mockNavigate).toHaveBeenCalledWith('LogEntry', { metricId: 'water' });
  });

  it('does the same from the header button', async () => {
    await mount();
    await fireEvent.press(screen.getByText('Sleep'));
    await fireEvent.press(await screen.findByLabelText('Add measurement'));

    expect(mockNavigate).toHaveBeenCalledWith('LogEntry', { metricId: 'sleep' });
  });

  it('leaves the metric unset on the All tab, so the sheet keeps its default', async () => {
    await mount();
    await fireEvent.press(screen.getByText('All'));
    await fireEvent.press(await screen.findByText('Add your first entry'));

    expect(mockNavigate).toHaveBeenCalledWith('LogEntry', { metricId: undefined });
  });

  it('names the metric in the empty state rather than claiming the app is empty', async () => {
    await mount();
    await fireEvent.press(screen.getByText('Water'));
    expect(await screen.findByText('No water yet')).toBeTruthy();

    await fireEvent.press(screen.getByText('All'));
    expect(await screen.findByText('Nothing recorded yet')).toBeTruthy();
  });
});

/**
 * `historyPage` throws when the database is not open. Without a `finally` the
 * screen sat on its loading state for ever — no rows, no empty state, no error,
 * and no way back.
 */
describe('when the read fails', () => {
  it('says so instead of loading for ever, and offers a retry', async () => {
    const { historyPage } = jest.requireMock('../../../data/measurementRepo');
    historyPage.mockRejectedValueOnce(new Error('Database not open'));

    await mount();

    expect(await screen.findByText('Could not read your history')).toBeTruthy();
    expect(screen.getByText('Database not open')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('recovers on retry', async () => {
    const { historyPage } = jest.requireMock('../../../data/measurementRepo');
    historyPage.mockRejectedValueOnce(new Error('Database not open'));

    await mount();
    await fireEvent.press(await screen.findByText('Try again'));

    expect(screen.queryByText('Could not read your history')).toBeNull();
    // History opens on the Weight filter, so the empty state names it.
    expect(await screen.findByText('No weight yet')).toBeTruthy();
  });
});

/*
 * Not covered here: the list's own configuration — getItemType, drawDistance,
 * the end-reached threshold and the footer placeholder. React Native Testing
 * Library 14 exposes only a host-element tree, and FlashList is a composite,
 * so its props are not reachable without reading internals. Asserting them
 * through contortions would test the contortion rather than the behaviour, so
 * the blank-cell fix is verified by scrolling the seeded account on a device.
 */

/**
 * Switching metric is a new list, not a new page of the old one.
 *
 * The scroll offset used to survive the change, so scrolling a few hundred
 * rows into weight and tapping Water parked the list well past the end of a
 * much shorter dataset and drew nothing. The previous metric's rows also
 * stayed on screen under the new chip until the query returned.
 */
describe('switching metric', () => {
  const reading = (id: string, metricId: 'weight' | 'water', value: number) => ({
    id, lineageId: id, laneKey: `${metricId}:2026-09-21`, metric: metricId,
    value, unit: metricId === 'weight' ? 'kg' : 'ml',
    recordedAt: Date.UTC(2026, 8, 21, 9, 0), updatedAt: 0,
    source: 'manual' as const, externalId: null, serverSeq: 1,
    localSeq: 1, deletedAt: null,
  });

  it('clears the previous metric rather than showing it under the new chip', async () => {
    const repo = jest.requireMock('../../../data/measurementRepo');
    repo.historyPage.mockResolvedValue([reading('w1', 'weight', 72.6)]);
    await mount();
    expect(await screen.findByText('72.6 kg')).toBeTruthy();

    // The next query is slow; the weight row must not linger meanwhile.
    let release: (v: unknown) => void = () => {};
    repo.historyPage.mockReturnValue(new Promise(r => { release = r; }));
    await fireEvent.press(screen.getByText('Water'));

    expect(screen.queryByText('72.6 kg')).toBeNull();

    await act(async () => {
      release([reading('a1', 'water', 250)]);
    });
    expect(await screen.findByText('250 ml')).toBeTruthy();
  });

  /*
   * Not covered: the one-frame flash of the empty state between clearing the
   * list and the next page arriving. `await fireEvent` flushes the effect that
   * sets `loading`, so RTL never observes the intermediate render — a test
   * here passes with or without the fix, which is worse than no test. The
   * guard is `setLoading(true)` in `chooseFilter`, verified on a device.
   */
  /**
   * Returning to a metric should be free.
   *
   * Switching used to discard the loaded pages and re-query from the first,
   * which defeats keyset paging: three pages deep into weight, a glance at
   * water, and coming back meant re-fetching all of it from the top.
   */
  it('restores a metric from cache instead of re-querying it', async () => {
    const repo = jest.requireMock('../../../data/measurementRepo');
    repo.historyPage.mockResolvedValue([reading('w1', 'weight', 72.6)]);
    await mount();
    await screen.findByText('72.6 kg');

    repo.historyPage.mockResolvedValue([reading('a1', 'water', 250)]);
    await fireEvent.press(screen.getByText('Water'));
    await screen.findByText('250 ml');

    repo.historyPage.mockClear();
    await fireEvent.press(screen.getByText('Weight'));

    // The weight rows come back without touching the database.
    expect(await screen.findByText('72.6 kg')).toBeTruthy();
    expect(repo.historyPage).not.toHaveBeenCalled();
  });

  /** A write invalidates it — the other metric's rows may have changed too. */
  it('drops the cache when the data changes', async () => {
    const repo = jest.requireMock('../../../data/measurementRepo');
    repo.historyPage.mockResolvedValue([reading('w1', 'weight', 72.6)]);
    await mount();
    await screen.findByText('72.6 kg');

    repo.historyPage.mockResolvedValue([reading('a1', 'water', 250)]);
    await fireEvent.press(screen.getByText('Water'));
    await screen.findByText('250 ml');

    await act(async () => { notifyDataChanged(); });
    await act(async () => { await new Promise<void>(r => { setTimeout(r, 80); }); });

    repo.historyPage.mockClear();
    repo.historyPage.mockResolvedValue([reading('w1', 'weight', 72.6)]);
    await fireEvent.press(screen.getByText('Weight'));

    expect(repo.historyPage).toHaveBeenCalled();
  });

  it('ignores a tap on the metric already selected', async () => {
    const repo = jest.requireMock('../../../data/measurementRepo');
    repo.historyPage.mockResolvedValue([reading('w1', 'weight', 72.6)]);
    await mount();
    await screen.findByText('72.6 kg');
    repo.historyPage.mockClear();

    await fireEvent.press(screen.getByText('Weight'));
    expect(repo.historyPage).not.toHaveBeenCalled();
  });
});
