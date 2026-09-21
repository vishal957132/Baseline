import authReducer, {
  onboardingFinished, sessionRestored, signedIn, signedOut,
} from '../../../app/store/authSlice';
import { clearSession, getGoals, getSession, setGoals, setSession } from '../../../data/prefs';
import { ACCOUNTS, signIn } from '../accounts';

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
