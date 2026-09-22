/**
 * The import button's enabled state.
 *
 * The stored source list is cross-platform — an Android phone still carries a
 * saved preference for Apple Health — but Settings only renders the providers
 * this device has. Counting the stored list directly left the button enabled
 * after both visible toggles were switched off, and pressing it then reported
 * importing nothing. The button has to intersect with the platform exactly as
 * `importHealthData` does.
 */

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import authReducer from '../../../app/store/authSlice';
import goalsReducer from '../../../app/store/goalsSlice';
import syncReducer from '../../../app/store/syncSlice';
import unitsReducer from '../../../app/store/unitsSlice';
import type { SourceId } from '../../../domain/types';
import { SettingsScreen } from '../SettingsScreen';

let mockConnected: SourceId[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

let mockMetrics: string[] = ['weight', 'water', 'sleep', 'steps', 'energy'];

jest.mock('../../../data/prefs', () => ({
  getConnectedSources: () => mockConnected,
  setConnectedSources: jest.fn(),
  getImportedMetrics: () => mockMetrics,
  setImportedMetrics: jest.fn(),
  setUnitPrefs: jest.fn(),
}));

jest.mock('../../../app/importService', () => ({
  importHealthData: jest.fn().mockResolvedValue({
    imported: 0, conflicts: 0, failed: [], skipped: 0,
  }),
}));

jest.mock('../../../app/syncService', () => ({ simulateSignInElsewhere: jest.fn() }));

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

function mount() {
  const store = configureStore({
    reducer: {
      auth: authReducer, goals: goalsReducer, sync: syncReducer,
      units: unitsReducer,
    },
    preloadedState: { goals: { weight: 70 } },
  });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <Provider store={store}>
        <SettingsScreen stats={{ records: 0, since: null, bytes: 0 }} />
      </Provider>
    </SafeAreaProvider>,
  );
}

const importService = () => jest.requireMock('../../../app/importService');

const prefs = () => jest.requireMock('../../../data/prefs');

beforeEach(() => {
  Platform.OS = 'android';
  mockMetrics = ['weight', 'water', 'sleep', 'steps', 'energy'];
  importService().importHealthData.mockClear();
  prefs().setImportedMetrics.mockClear();
});

describe('the import button', () => {
  it('is available when this device has a source switched on', async () => {
    mockConnected = ['health_connect'];
    await mount();
    await fireEvent.press(screen.getByText('Get my latest readings'));
    expect(importService().importHealthData).toHaveBeenCalled();
  });

  /**
   * The exact reported case: both toggles visible on Android switched off,
   * while a saved Apple Health preference keeps the stored list non-empty.
   */
  it('does nothing when the only saved source belongs to another platform', async () => {
    mockConnected = ['apple_health'];
    await mount();
    await fireEvent.press(screen.getByText('Get my latest readings'));
    expect(importService().importHealthData).not.toHaveBeenCalled();
  });

  it('says why, rather than leaving a dead button', async () => {
    mockConnected = ['apple_health'];
    await mount();
    expect(
      screen.getByText('Switch on a health app above to bring readings in.'),
    ).toBeTruthy();
  });

  it('is unavailable when nothing at all is switched on', async () => {
    mockConnected = [];
    await mount();
    await fireEvent.press(screen.getByText('Get my latest readings'));
    expect(importService().importHealthData).not.toHaveBeenCalled();
  });
});

/**
 * Which metrics an import may bring in.
 *
 * Chosen during onboarding and previously never again: the Connect screen is
 * unreachable once onboarding is done, so the decision stood until reinstall.
 */
describe('the metrics an import reads', () => {
  it('lists every metric with its current state', async () => {
    mockMetrics = ['weight'];
    await mount();
    expect(screen.getAllByText('Brought in by an import')).toHaveLength(1);
    expect(screen.getAllByText('Skipped by an import')).toHaveLength(4);
  });

  // "Sleep" also labels a row in the units picker further down the screen;
  // the metrics list is rendered first.
  const metricRow = (label: string) => screen.getAllByText(label)[0];

  it('switches one off and remembers it', async () => {
    await mount();
    await fireEvent.press(metricRow('Sleep'));

    const [saved] = prefs().setImportedMetrics.mock.calls[0];
    expect(saved).not.toContain('sleep');
    expect(saved).toContain('weight');
  });

  it('switches one back on', async () => {
    mockMetrics = ['weight'];
    await mount();
    await fireEvent.press(metricRow('Sleep'));

    expect(prefs().setImportedMetrics.mock.calls[0][0]).toContain('sleep');
  });

  /** Switching one off is not a delete, and the copy has to say so. */
  it('says it only affects imports, never existing readings', async () => {
    await mount();
    expect(screen.getByText(/never removes readings you already have/)).toBeTruthy();
  });

  it('warns when nothing is selected', async () => {
    mockMetrics = [];
    await mount();
    expect(
      screen.getByText('Nothing selected — an import would bring in nothing.'),
    ).toBeTruthy();
  });
});
