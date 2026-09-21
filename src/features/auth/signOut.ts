/**
 * Signing out, for real.
 *
 * Three things have to go, in this order: the readings, the preferences, then
 * the session. Data first, because if the process dies midway a device with no
 * session and no data is recoverable, while a device showing a signed-out
 * banner over someone else's readings is not.
 *
 * Kept in one function because both Settings and the session-ended screen need
 * it, and a security-relevant sequence duplicated across two call sites will
 * eventually drift.
 */

import type { Dispatch } from '@reduxjs/toolkit';

import { signedOut } from '../../app/store/authSlice';
import { clearLocalData } from '../../data/measurementRepo';
import { clearPrefs } from '../../data/prefs';

export async function signOut(dispatch: Dispatch): Promise<void> {
  try {
    await clearLocalData();
  } finally {
    // The session is cleared even if the wipe failed — leaving someone signed
    // in because a DELETE errored would be the worse outcome.
    clearPrefs();
    dispatch(signedOut());
  }
}
