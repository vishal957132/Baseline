/**
 * Who is signed in, and whether they have been through onboarding.
 *
 * `status: 'unknown'` is the first frame, before the cached session has been
 * read. The splash stays up through it, so the app never flashes a sign-in
 * form at someone who is already signed in.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface Identity {
  email: string;
  name: string;
  onboarded: boolean;
}

export interface AuthState extends Omit<Identity, 'email' | 'name'> {
  status: 'unknown' | 'signed-out' | 'signed-in';
  email: string | null;
  name: string | null;
}

const initialState: AuthState = {
  status: 'unknown',
  email: null,
  name: null,
  onboarded: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionRestored: (_state, action: PayloadAction<Identity | null>) =>
      action.payload
        ? { status: 'signed-in' as const, ...action.payload }
        : { status: 'signed-out' as const, email: null, name: null, onboarded: false },

    signedIn: (state, action: PayloadAction<Identity>) => {
      state.status = 'signed-in';
      state.email = action.payload.email;
      state.name = action.payload.name;
      state.onboarded = action.payload.onboarded;
    },

    onboardingFinished: state => {
      state.onboarded = true;
    },

    signedOut: () => ({
      status: 'signed-out' as const, email: null, name: null, onboarded: false,
    }),
  },
});

export const { sessionRestored, signedIn, onboardingFinished, signedOut } =
  authSlice.actions;
export default authSlice.reducer;

interface WithAuth {
  auth: AuthState;
}

export const selectAuth = (s: WithAuth) => s.auth;
export const selectEmail = (s: WithAuth) => s.auth.email;
export const selectName = (s: WithAuth) => s.auth.name;
