import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';

import authReducer, { sessionRestored, signedIn } from '../store/authSlice';
import goalsReducer from '../store/goalsSlice';
import syncReducer from '../store/syncSlice';
import unitsReducer from '../store/unitsSlice';
import { setSession } from '../../data/prefs';
import { Navigation } from '../navigation';

async function mount(
  setup?: (dispatch: ReturnType<typeof makeStore>['dispatch']) => void,
) {
  const store = makeStore();
  setup?.(store.dispatch);
  // Awaited here: `render` is async in RTL 14, so assigning onto its return
  // value would decorate the promise rather than the result.
  const view = await render(
    <Provider store={store}>
      <Navigation />
    </Provider>,
  );
  // Assign rather than spread: RTL's result carries methods on its prototype.
  return Object.assign(view, { store });
}

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer, goals: goalsReducer, sync: syncReducer,
      units: unitsReducer,
    },
  });
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

/**
 * Finishing onboarding has to actually move the user.
 *
 * Walked from Connect through Goals rather than dispatched directly, because
 * the defect depended on *which* screen was current when the branch flipped:
 * conditional stacks keep the route when its name still exists in the branch
 * being switched to. The Settings entry point was first registered as a second
 * screen also called `Goals`, so pressing "Start tracking" swapped the branch
 * and landed on the goals screen again — the button looked dead.
 */
describe('finishing onboarding from the goals step', () => {
  beforeEach(() => {
    setSession({
      email: 'demo@baseline.app', name: 'Demo User',
      onboarded: false, signedInAt: 1,
    });
  });

  const walkToGoals = async () => {
    await mount(dispatch =>
      dispatch(signedIn({
        email: 'demo@baseline.app', name: 'Demo User', onboarded: false,
      })),
    );
    await fireEvent.press(screen.getByText('Continue'));
    expect(screen.getByText('STEP 2 OF 2')).toBeTruthy();
  };

  it('reaches the tabs from "Start tracking"', async () => {
    await walkToGoals();
    await fireEvent.press(screen.getByText('Start tracking'));

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.queryByText('STEP 2 OF 2')).toBeNull();
  });

  /** Skipping is the same journey; it just stores nothing. */
  it('reaches the tabs from "Set these later" too', async () => {
    await walkToGoals();
    await fireEvent.press(screen.getByText('Set these later'));

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.queryByText('STEP 2 OF 2')).toBeNull();
  });
});
