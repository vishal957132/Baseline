import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { store } from '../../../app/store';
import { goalsRestored } from '../../../app/store/goalsSlice';
import { getGoals, getSession, setGoals, setSession } from '../../../data/prefs';
import { GoalsScreen } from '../GoalsScreen';

let mockRouteName = 'Goals';
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ name: mockRouteName }),
}));

// The step average is read for real now, rather than hardcoded in the copy.
jest.mock('../../../data/measurementRepo', () => ({
  bucketByDay: jest.fn().mockResolvedValue([]),
}));

const SAFE_FRAME = { x: 0, y: 0, width: 390, height: 844 };
const SAFE_INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

const mounted = (routeName = 'Goals') => {
  mockRouteName = routeName;
  return render(
    <SafeAreaProvider initialMetrics={{ frame: SAFE_FRAME, insets: SAFE_INSETS }}>
    <Provider store={store}>
      <GoalsScreen />
    </Provider>
    </SafeAreaProvider>,
  );
};

beforeEach(() => {
  mockRouteName = 'Goals';
  mockGoBack.mockClear();
  // Both halves, as the app does at launch: MMKV is what survives a restart,
  // the store is what the screens render from. MMKV also persists across tests
  // in a file, so a test that saves a goal would otherwise decide what the
  // next one starts from.
  const defaults = { weight: 70, steps: 10_000, water: 2_500 };
  setGoals(defaults);
  store.dispatch(goalsRestored(defaults));
  jest.requireMock('../../../data/measurementRepo')
    .bucketByDay.mockResolvedValue([]);
});

/**
 * Note `await fireEvent` — in React Native Testing Library 14 both `render`
 * and `fireEvent` are async. Without the await the state update has not
 * flushed, and the assertion reads the previous value.
 */
describe('finishing onboarding', () => {
  const signedInNotOnboarded = () =>
    setSession({
      email: 'demo@baseline.app', name: 'Demo User',
      onboarded: false, signedInAt: 1,
    });

  it('is remembered after "Start tracking", so a restart opens the dashboard', async () => {
    signedInNotOnboarded();
    await mounted();
    await fireEvent.press(screen.getByText('Start tracking'));
    expect(getSession()?.onboarded).toBe(true);
  });

  /** Skipping the goals still finishes onboarding — they are optional. */
  it('is remembered after "Set these later" too', async () => {
    signedInNotOnboarded();
    await mounted();
    await fireEvent.press(screen.getByText('Set these later'));
    expect(getSession()?.onboarded).toBe(true);
  });

  it('does not save goals when they were skipped', async () => {
    signedInNotOnboarded();
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '68.5');
    await fireEvent.press(screen.getByText('Set these later'));
    expect(getGoals().weight).toBe(70); // the default, not the typed value
  });
});

describe('the goals form accepts typing', () => {
  it('updates the target weight field as the user types', async () => {
    await mounted();
    const weight = screen.getByDisplayValue('70.0');

    await fireEvent.changeText(weight, '68.5');
    expect(screen.getByDisplayValue('68.5')).toBeTruthy();
  });

  it('updates the daily water field as the user types', async () => {
    await mounted();
    const water = screen.getByDisplayValue('2500');

    await fireEvent.changeText(water, '3000');
    expect(screen.getByDisplayValue('3000')).toBeTruthy();
  });

  it('lets the field be cleared', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '');
    expect(screen.getByDisplayValue('')).toBeTruthy();
  });

  /** Backspace, one character at a time — the reported failure. */
  it('deletes characters one at a time', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '7');
    expect(screen.getByDisplayValue('7')).toBeTruthy();

    await fireEvent.changeText(screen.getByDisplayValue('7'), '');
    expect(screen.getByDisplayValue('')).toBeTruthy();

    await fireEvent.changeText(screen.getByDisplayValue(''), '6');
    expect(screen.getByDisplayValue('6')).toBeTruthy();
  });

  it('keeps a half-typed decimal like "68." instead of rejecting it', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '68.');
    expect(screen.getByDisplayValue('68.')).toBeTruthy();
  });

  it('ignores characters a numeric goal cannot hold', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '6a8');
    expect(screen.getByDisplayValue('68')).toBeTruthy();
  });

  /** One decimal in kilograms; a stray second point is a slip, not precision. */
  it('drops a stray decimal point and caps at the unit precision', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '68.5.2');
    expect(screen.getByDisplayValue('68.5')).toBeTruthy();
  });

  it('saves what was typed', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '68.5');
    await fireEvent.changeText(screen.getByDisplayValue('2500'), '3000');
    await fireEvent.press(screen.getByText('Start tracking'));

    expect(getGoals()).toMatchObject({ weight: 68.5, water: 3000 });
  });
});

/**
 * The same screen, reopened from Settings.
 *
 * It exists twice in the navigator — once as onboarding step 2, once behind
 * the Settings row — because the fields and the storage are identical and only
 * the framing differs.
 */
describe('editing goals from Settings', () => {
  it('offers Save instead of finishing onboarding', async () => {
    await mounted('EditGoals');
    expect(screen.getByText('Save goals')).toBeTruthy();
    expect(screen.queryByText('Start tracking')).toBeNull();
    expect(screen.queryByText('Set these later')).toBeNull();
    expect(screen.queryByText('STEP 2 OF 2')).toBeNull();
  });

  it('saves the change and returns, without touching onboarding', async () => {
    setSession({
      email: 'vishal@baseline.app', name: 'Vishal Rabadiya',
      onboarded: true, signedInAt: 1,
    });
    await mounted('EditGoals');
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '66.5');
    await fireEvent.press(screen.getByText('Save goals'));

    expect(getGoals().weight).toBe(66.5);
    expect(mockGoBack).toHaveBeenCalled();
    expect(getSession()?.onboarded).toBe(true);
  });

  /**
   * The reported bug: the metric screen showed the new goal, Settings and the
   * dashboard did not. Those two live in tabs that stay mounted, so reading
   * MMKV during render never re-ran; only the metric screen looked right, and
   * only because navigating to it remounts it. Saving has to reach the store.
   */
  it('publishes the change to the store, not only to storage', async () => {
    await mounted('EditGoals');
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '66.5');
    await fireEvent.press(screen.getByText('Save goals'));

    expect(store.getState().goals.weight).toBe(66.5); // what screens re-render from
    expect(getGoals().weight).toBe(66.5);             // what survives a restart
  });

  /** A blank field means "no goal", which every metric supports. */
  it('clears a goal when the field is emptied', async () => {
    await mounted('EditGoals');
    await fireEvent.changeText(screen.getByDisplayValue('70.0'), '');
    await fireEvent.press(screen.getByText('Save goals'));
    expect(getGoals().weight).toBeUndefined();
  });
});
