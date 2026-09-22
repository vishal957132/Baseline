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
import syncReducer from '../../../app/store/syncSlice';
import unitsReducer from '../../../app/store/unitsSlice';
import type { SourceId } from '../../../domain/types';
import { SettingsScreen } from '../SettingsScreen';

let mockConnected: SourceId[] = [];

jest.mock('../../../data/prefs', () => ({
  getConnectedSources: () => mockConnected,
  setConnectedSources: jest.fn(),
  getGoals: () => ({ weight: 70 }),
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
    reducer: { auth: authReducer, sync: syncReducer, units: unitsReducer },
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

beforeEach(() => {
  Platform.OS = 'android';
  importService().importHealthData.mockClear();
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
