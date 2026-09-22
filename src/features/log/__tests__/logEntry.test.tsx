import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';

import authReducer from '../../../app/store/authSlice';
import syncReducer from '../../../app/store/syncSlice';
import { LogEntryScreen } from '../LogEntryScreen';

const mockGoBack = jest.fn();
let mockParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

jest.mock('../../../data/measurementRepo', () => ({
  addMeasurement: jest.fn().mockResolvedValue(undefined),
  editMeasurement: jest.fn().mockResolvedValue(undefined),
  removeMeasurement: jest.fn().mockResolvedValue(undefined),
  measurementById: jest.fn().mockResolvedValue(null),
}));

const repo = () => jest.requireMock('../../../data/measurementRepo');

const mount = () =>
  render(
    <Provider store={configureStore({ reducer: { auth: authReducer, sync: syncReducer } })}>
      <LogEntryScreen />
    </Provider>,
  );

beforeEach(() => {
  mockParams = {};
  mockGoBack.mockClear();
  Object.values(repo()).forEach(fn => (fn as jest.Mock).mockClear());
  repo().measurementById.mockResolvedValue(null);
});

describe('a new entry', () => {
  it('opens on today and now', async () => {
    await mount();
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);
    expect(screen.getByPlaceholderText('2026-09-22').props.value).toBe(today);
  });

  /** The whole point: a reading can be recorded for a day that is not today. */
  it('records the date and time the user typed, not the moment they saved', async () => {
    await mount();
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '72.6');
    await fireEvent.changeText(screen.getByPlaceholderText('2026-09-22'), '2026-09-20');
    await fireEvent.changeText(screen.getByPlaceholderText('08:43'), '07:15');
    await fireEvent.press(screen.getByText('Save measurement'));

    const [args] = repo().addMeasurement.mock.calls[0];
    const local = new Date(args.recordedAt + args.tzOffsetMs).toISOString();
    expect(local.slice(0, 10)).toBe('2026-09-20');
    expect(local.slice(11, 16)).toBe('07:15');
  });

  it('refuses a date that does not exist', async () => {
    await mount();
    await fireEvent.changeText(screen.getByPlaceholderText('2026-09-22'), '2026-02-31');
    expect(await screen.findByText('That is not a real date and time')).toBeTruthy();
  });

  it('refuses a reading taken in the future', async () => {
    await mount();
    await fireEvent.changeText(screen.getByPlaceholderText('2026-09-22'), '2099-01-01');
    expect(await screen.findByText('That is in the future')).toBeTruthy();
  });

  it('does not save while the date is unusable', async () => {
    await mount();
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '72.6');
    await fireEvent.changeText(screen.getByPlaceholderText('2026-09-22'), 'nonsense');
    await fireEvent.press(screen.getByText('Save measurement'));
    expect(repo().addMeasurement).not.toHaveBeenCalled();
  });
});

describe('editing an existing reading', () => {
  const at = Date.UTC(2026, 8, 20, 6, 30);

  beforeEach(() => {
    mockParams = { measurementId: 'm-1', metricId: 'weight' };
    repo().measurementById.mockResolvedValue({
      id: 'm-1', lineageId: 'm-1', laneKey: 'weight:2026-09-20',
      metric: 'weight', value: 73.4, unit: 'kg', recordedAt: at, updatedAt: at,
      source: 'manual', externalId: null, serverSeq: 12, localSeq: 3,
      deletedAt: null,
    });
  });

  it('fills the form from the reading', async () => {
    await mount();
    expect(await screen.findByDisplayValue('73.4')).toBeTruthy();
  });

  /** It used to stamp `now`, quietly moving an old reading to today. */
  it('keeps the original date unless the user changes it', async () => {
    await mount();
    await screen.findByDisplayValue('73.4');
    await fireEvent.press(screen.getByText('Save changes'));

    const [args] = repo().editMeasurement.mock.calls[0];
    expect(args.recordedAt).toBe(at);
  });

  it('deletes from the reading’s own lane, not today’s', async () => {
    await mount();
    await screen.findByDisplayValue('73.4');
    await fireEvent.press(screen.getByText('Delete this entry'));

    const [args] = repo().removeMeasurement.mock.calls[0];
    expect(args.laneKey).toBe('weight:2026-09-20');
  });
});
