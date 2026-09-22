import authReducer, {
  onboardingFinished, sessionRestored, signedIn, signedOut,
} from '../../../app/store/authSlice';
import {
  clearPrefs, clearSession, getConnectedSources, getGoals, getSession,
  markOnboarded, setConnectedSources, setGoals, setSession,
} from '../../../data/prefs';
import { DEFAULT_CONNECTED } from '../../../providers/registry';
import { ACCOUNTS, accountFor, signIn } from '../accounts';

describe('credentials', () => {
  it('accepts every demo account with its documented password', () => {
    for (const a of ACCOUNTS) {
      expect(signIn(a.email, a.password).ok).toBe(true);
    }
  });

  it('ignores case in the email but not in the password', () => {
    expect(signIn('VISHAL@Baseline.app', 'baseline').ok).toBe(true);
    expect(signIn('vishal@baseline.app', 'Baseline').ok).toBe(false);
  });

  it('tolerates surrounding whitespace from a keyboard', () => {
    expect(signIn('  vishal@baseline.app  ', 'baseline').ok).toBe(true);
  });

  it('distinguishes an unknown email from a wrong password', () => {
    const noUser = signIn('nobody@example.com', 'baseline');
    const badPass = signIn('vishal@baseline.app', 'nope');
    expect(noUser.ok === false && noUser.reason).toMatch(/No account/);
    expect(badPass.ok === false && badPass.reason).toMatch(/Wrong password/);
  });

  it('marks exactly one account as needing onboarding', () => {
    expect(ACCOUNTS.filter(a => !a.onboarded).map(a => a.email))
      .toEqual(['demo@baseline.app']);
  });

  /**
   * The empty account exists so the empty states can be reached. Seeding it
   * would make them unreachable — which is exactly what happened when the
   * seeder ran for every sign-in regardless of who.
   */
  it('leaves exactly one account unseeded, for the empty states', () => {
    expect(ACCOUNTS.filter(a => !a.seedHistory).map(a => a.email))
      .toEqual(['empty@baseline.app']);
  });

  it('seeds the two accounts that are meant to have history', () => {
    expect(ACCOUNTS.filter(a => a.seedHistory).map(a => a.email))
      .toEqual(['vishal@baseline.app', 'demo@baseline.app']);
  });

  it('looks an account up by email, ignoring case and spacing', () => {
    expect(accountFor('  VISHAL@Baseline.app ')?.name).toBe('Vishal Rabadiya');
  });

  it('has no account for an unknown email, or for none at all', () => {
    expect(accountFor('nobody@example.com')).toBeUndefined();
    expect(accountFor(null)).toBeUndefined();
    expect(accountFor(undefined)).toBeUndefined();
  });

  it('gives every account a display name for the Settings screen', () => {
    expect(ACCOUNTS.every(a => a.name.trim().length > 0)).toBe(true);
    expect(signIn('vishal@baseline.app', 'baseline')).toMatchObject({
      ok: true,
      account: { name: 'Vishal Rabadiya' },
    });
  });
});

describe('cached session', () => {
  beforeEach(clearSession);

  it('is absent before signing in', () => {
    expect(getSession()).toBeNull();
  });

  /** The reason a returning user never sees the sign-in form. */
  it('round-trips so the next launch opens straight to the data', () => {
    setSession({
      email: 'vishal@baseline.app', name: 'Vishal Rabadiya',
      onboarded: true, signedInAt: 1,
    });
    expect(getSession()).toEqual({
      email: 'vishal@baseline.app', name: 'Vishal Rabadiya',
      onboarded: true, signedInAt: 1,
    });
  });

  it('is gone after signing out', () => {
    setSession({ email: 'a@b.c', name: 'A B', onboarded: true, signedInAt: 1 });
    clearSession();
    expect(getSession()).toBeNull();
  });
});

/**
 * The restart bug: finishing onboarding used to update only Redux, so the next
 * launch read a cached session that still said `onboarded: false` and sent the
 * user back through Connect and Goals every time.
 */
describe('onboarding survives a restart', () => {
  beforeEach(clearPrefs);

  it('writes the flag onto the cached session', () => {
    setSession({
      email: 'demo@baseline.app', name: 'Demo User',
      onboarded: false, signedInAt: 1,
    });

    markOnboarded();

    expect(getSession()?.onboarded).toBe(true);
  });

  it('leaves the rest of the session alone', () => {
    setSession({
      email: 'demo@baseline.app', name: 'Demo User',
      onboarded: false, signedInAt: 99,
    });

    markOnboarded();

    expect(getSession()).toEqual({
      email: 'demo@baseline.app', name: 'Demo User',
      onboarded: true, signedInAt: 99,
    });
  });

  it('does nothing when nobody is signed in', () => {
    markOnboarded();
    expect(getSession()).toBeNull();
  });

  it('is idempotent', () => {
    setSession({ email: 'a@b.c', name: 'A B', onboarded: false, signedInAt: 1 });
    markOnboarded();
    markOnboarded();
    expect(getSession()?.onboarded).toBe(true);
  });
});

describe('goals are settings, not measurements', () => {
  it('has sensible defaults before onboarding', () => {
    expect(getGoals()).toMatchObject({ weight: 70, steps: 10_000, water: 2_500 });
  });

  it('merges a partial change over the defaults', () => {
    setGoals({ steps: 15_000 });
    const goals = getGoals();
    expect(goals.steps).toBe(15_000);
    expect(goals.weight).toBe(70); // untouched
  });
});

describe('the connected sources', () => {
  beforeEach(clearPrefs);

  it('falls back to the caller\u2019s defaults before anything is chosen', () => {
    expect(getConnectedSources(DEFAULT_CONNECTED)).toEqual(DEFAULT_CONNECTED);
  });

  it('remembers a choice across launches', () => {
    setConnectedSources(['json_feed']);
    expect(getConnectedSources(DEFAULT_CONNECTED)).toEqual(['json_feed']);
  });

  it('remembers switching everything off, rather than reverting to defaults', () => {
    setConnectedSources([]);
    expect(getConnectedSources(DEFAULT_CONNECTED)).toEqual([]);
  });

  it('goes with the session on sign-out', () => {
    setConnectedSources(['json_feed']);
    clearPrefs();
    expect(getConnectedSources(DEFAULT_CONNECTED)).toEqual(DEFAULT_CONNECTED);
  });
});

describe('the auth gates', () => {
  const initial = authReducer(undefined, { type: 'init' });

  it('starts unknown, so the splash holds instead of flashing sign-in', () => {
    expect(initial.status).toBe('unknown');
  });

  it('a restored session goes straight in', () => {
    const state = authReducer(
      initial,
      sessionRestored({
        email: 'vishal@baseline.app', name: 'Vishal Rabadiya', onboarded: true,
      }),
    );
    expect(state).toEqual({
      status: 'signed-in', email: 'vishal@baseline.app',
      name: 'Vishal Rabadiya', onboarded: true,
    });
  });

  it('no cached session means signed out', () => {
    expect(authReducer(initial, sessionRestored(null)).status).toBe('signed-out');
  });

  it('a new user lands signed-in but not onboarded', () => {
    const state = authReducer(
      initial,
      signedIn({ email: 'demo@baseline.app', name: 'Demo User', onboarded: false }),
    );
    expect(state.status).toBe('signed-in');
    expect(state.onboarded).toBe(false);
  });

  it('finishing onboarding opens the app without another sign-in', () => {
    let state = authReducer(
      initial,
      signedIn({ email: 'demo@baseline.app', name: 'Demo User', onboarded: false }),
    );
    state = authReducer(state, onboardingFinished());
    expect(state).toEqual({
      status: 'signed-in', email: 'demo@baseline.app',
      name: 'Demo User', onboarded: true,
    });
  });

  it('signing out clears the email as well as the status', () => {
    const state = authReducer(
      authReducer(initial, signedIn({ email: 'a@b.c', name: 'A B', onboarded: true })),
      signedOut(),
    );
    expect(state).toEqual({
      status: 'signed-out', email: null, name: null, onboarded: false,
    });
  });
});
