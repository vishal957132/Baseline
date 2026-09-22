import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';

import authReducer, { sessionRestored, signedIn } from '../store/authSlice';
import syncReducer from '../store/syncSlice';
import { Navigation } from '../navigation';

function mount(setup?: (dispatch: ReturnType<typeof makeStore>['dispatch']) => void) {
  const store = makeStore();
  setup?.(store.dispatch);
  return render(
    <Provider store={store}>
      <Navigation />
    </Provider>,
  );
}

function makeStore() {
  return configureStore({ reducer: { auth: authReducer, sync: syncReducer } });
}

/**
 * Auth status is what gates the navigator, which makes it the thing that keeps
 * screens from querying a database that is not open yet.
 *
 * Dispatching a restored session before `openDatabase()` resolved used to let
 * the dashboard mount early, so all five of its queries threw "Database not
 * open" and the screen reported that nothing could be refreshed — recovering
 * only when the user pressed Try again.
 */
describe('the navigator gate', () => {
  it('renders nothing while the session is still unknown', async () => {
    const { toJSON } = await mount();
    expect(toJSON()).toBeNull();
  });

  it('shows sign-in once there is no cached session', async () => {
    await mount(dispatch => dispatch(sessionRestored(null)));
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('sends a signed-in but un-onboarded user to Connect first', async () => {
    await mount(dispatch =>
      dispatch(signedIn({
        email: 'demo@baseline.app', name: 'Demo User', onboarded: false,
      })),
    );
    // ScreenHeader upper-cases its eyebrow.
    expect(screen.getByText('STEP 1 OF 2')).toBeTruthy();
    expect(screen.getByText('Where should we read from?')).toBeTruthy();
  });
});
