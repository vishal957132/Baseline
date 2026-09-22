import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import authReducer from '../../../app/store/authSlice';
import syncReducer from '../../../app/store/syncSlice';
import unitsReducer from '../../../app/store/unitsSlice';
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

/**
 * The sheet reads the bottom inset to keep its buttons clear of the home
 * indicator, so it needs a provider. Frames are supplied rather than measured:
 * without them `useSafeAreaInsets` suspends waiting for a layout pass that
 * never happens under the test renderer.
 */
const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

const mount = (units: Record<string, unknown> = {}) =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <Provider
        store={configureStore({
          reducer: { auth: authReducer, sync: syncReducer, units: unitsReducer },
          preloadedState: { units },
        })}
      >
        <LogEntryScreen />
      </Provider>
    </SafeAreaProvider>,
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

describe('the value field', () => {
  it('refuses anything that is not a number', async () => {
    await mount();
    const field = screen.getByPlaceholderText('0');
    await fireEvent.changeText(field, '7a2.b6');
    expect(field.props.value).toBe('72.6');
  });

  /** Kilograms carry one decimal; typing more is fake precision. */
  it('caps the decimals at the precision of the unit', async () => {
    await mount();
    const field = screen.getByPlaceholderText('0');
    await fireEvent.changeText(field, '72.6789');
    expect(field.props.value).toBe('72.6');
  });

  it('will not save a value outside the plausible range', async () => {
    await mount();
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '900');
    await fireEvent.press(screen.getByText('Save measurement'));
    expect(repo().addMeasurement).not.toHaveBeenCalled();
    expect(screen.getByText('Enter between 20 and 500 kg')).toBeTruthy();
  });

  it('saves a value inside it', async () => {
    await mount();
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '72.6');
    await fireEvent.press(screen.getByText('Save measurement'));
    expect(repo().addMeasurement.mock.calls[0][0].value).toBe(72.6);
  });

  /**
   * The one that matters for units: the field is in pounds, the database is in
   * kilograms, and 160 must not be stored as 160.
   */
  it('stores the canonical value, not the number on screen', async () => {
    await mount({ weight: 'lb' });
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '160');
    await fireEvent.press(screen.getByText('Save measurement'));
    expect(repo().addMeasurement.mock.calls[0][0].value).toBeCloseTo(72.5748, 3);
  });

  it('applies the bound of the unit on screen, not of the stored one', async () => {
    await mount({ weight: 'lb' });
    // 30 is a fine number of kilograms and an impossible number of pounds.
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '30');
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

  /** Deleting asks first — the row leaves every screen the moment it happens. */
  it('confirms before deleting anything', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount();
    await screen.findByDisplayValue('73.4');
    await fireEvent.press(screen.getByText('Delete this entry'));

    expect(alert).toHaveBeenCalled();
    expect(repo().removeMeasurement).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('deletes from the reading’s own lane, not today’s', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      // Take the destructive choice, which is what a user confirming does.
      buttons?.find(b => b.style === 'destructive')?.onPress?.();
    });
    await mount();
    await screen.findByDisplayValue('73.4');
    await fireEvent.press(screen.getByText('Delete this entry'));

    const [args] = repo().removeMeasurement.mock.calls[0];
    expect(args.laneKey).toBe('weight:2026-09-20');
    alert.mockRestore();
  });

  /** Keeping it must leave the reading exactly where it was. */
  it('does nothing if the confirmation is dismissed', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find(b => b.style === 'cancel')?.onPress?.();
    });
    await mount();
    await screen.findByDisplayValue('73.4');
    await fireEvent.press(screen.getByText('Delete this entry'));

    expect(repo().removeMeasurement).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
