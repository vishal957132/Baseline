import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';

import authReducer from '../../../app/store/authSlice';
import syncReducer from '../../../app/store/syncSlice';
import { HistoryScreen } from '../HistoryScreen';

jest.mock('../../../data/measurementRepo', () => ({
  historyPage: jest.fn().mockResolvedValue([]),
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
const mount = () =>
  render(
    <Provider store={configureStore({ reducer: { auth: authReducer, sync: syncReducer } })}>
      <HistoryScreen />
    </Provider>,
  );

beforeEach(() => {
  mockNavigate.mockClear();
  const repo = jest.requireMock('../../../data/measurementRepo');
  repo.historyPage.mockReset().mockResolvedValue([]);
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
