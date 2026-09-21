import { signedIn } from '../../../app/store/authSlice';
import { selectCanSignOut } from '../../../app/store/syncSlice';
import { clearLocalData } from '../../../data/measurementRepo';
import { getGoals, getSession, setGoals, setSession } from '../../../data/prefs';
import { signOut } from '../signOut';

jest.mock('../../../data/measurementRepo', () => ({
  clearLocalData: jest.fn().mockResolvedValue(undefined),
}));

const wipe = clearLocalData as jest.Mock;

function signedInDevice() {
  setSession({
    email: 'vishal@baseline.app', name: 'Vishal Rabadiya',
    onboarded: true, signedInAt: 1,
  });
  setGoals({ steps: 15_000 });
}

beforeEach(() => {
  wipe.mockClear();
  wipe.mockResolvedValue(undefined);
});

describe('signing out', () => {
  it('deletes the local readings, not just the session', async () => {
    signedInDevice();
    await signOut(jest.fn());
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('clears the cached session, so the next launch shows sign-in', async () => {
    signedInDevice();
    await signOut(jest.fn());
    expect(getSession()).toBeNull();
  });

  /** Goals are per-person settings; the next user gets the defaults back. */
  it('resets the goals too', async () => {
    signedInDevice();
    expect(getGoals().steps).toBe(15_000);

    await signOut(jest.fn());
    expect(getGoals().steps).toBe(10_000);
  });

  it('tells the store, which is what gates the navigator back to sign-in', async () => {
    const dispatch = jest.fn();
    await signOut(dispatch);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth/signedOut' }),
    );
  });

  it('wipes the data before clearing the session', async () => {
    const order: string[] = [];
    wipe.mockImplementation(async () => { order.push('data'); });
    signedInDevice();

    await signOut(() => { order.push('dispatch'); return undefined as never; });

    // Data first: a device with no session and no data is recoverable; one
    // showing a signed-out banner over someone else's readings is not.
    expect(order).toEqual(['data', 'dispatch']);
  });

  /**
   * If the wipe throws we still sign out. Leaving someone signed in because a
   * DELETE failed is the worse of the two outcomes.
   */
  it('still signs out when the wipe fails', async () => {
    wipe.mockRejectedValue(new Error('database locked'));
    signedInDevice();
    const dispatch = jest.fn();

    await expect(signOut(dispatch)).rejects.toThrow(/database locked/);
    expect(getSession()).toBeNull();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth/signedOut' }),
    );
  });

  it('is idempotent — signing out twice is harmless', async () => {
    signedInDevice();
    await signOut(jest.fn());
    await expect(signOut(jest.fn())).resolves.toBeUndefined();
    expect(getSession()).toBeNull();
  });
});

describe('the guard', () => {
  /**
   * The button is disabled while the outbox is non-empty, so this is the
   * selector that protects unsent work (design page 13).
   */
  it('selectCanSignOut is false while anything is queued', () => {
    const withQueue = {
      sync: { lanes: [{ laneKey: 'weight:1', status: 'retrying' as const, queued: 3, attempts: 1, nextAttemptAt: null }] },
    };
    const empty = { sync: { lanes: [] } };

    expect(selectCanSignOut(withQueue as never)).toBe(false);
    expect(selectCanSignOut(empty as never)).toBe(true);
  });

  it('a signed-in identity is what sign-out undoes', () => {
    expect(signedIn({ email: 'a@b.c', name: 'A B', onboarded: true }).type)
      .toBe('auth/signedIn');
  });
});
