/**
 * Demo credentials. A plain map, not a table.
 *
 * There is no backend, so there is nothing to authenticate against — and a
 * password column in SQLite would look like real auth while being strictly
 * worse than admitting it is fake. Sign-in checks this map and the result is
 * cached in MMKV; the "server" never sees a credential.
 *
 * Swapping in a real endpoint means replacing `signIn` here.
 */

export interface Account {
  email: string;
  /** Shown on the Settings screen. */
  name: string;
  password: string;
  /** Skips onboarding — this is the account that already has history. */
  onboarded: boolean;
  /** Shown on the sign-in screen so a reviewer knows what each one does. */
  hint: string;
}

export const ACCOUNTS: Account[] = [
  {
    email: 'vishal@baseline.app',
    name: 'Vishal Rabadiya',
    password: 'baseline',
    onboarded: true,
    hint: 'Existing user — opens straight to seeded history',
  },
  {
    email: 'demo@baseline.app',
    name: 'Demo User',
    password: 'demo1234',
    onboarded: false,
    hint: 'New user — walks through Connect and Goals first',
  },
  {
    email: 'empty@baseline.app',
    name: 'Empty Account',
    password: 'empty1234',
    onboarded: true,
    hint: 'No readings — shows the empty states',
  },
];

export type SignInResult =
  | { ok: true; account: Account }
  | { ok: false; reason: string };

/** Case-insensitive on email, exact on password. */
export function signIn(email: string, password: string): SignInResult {
  const account = ACCOUNTS.find(
    a => a.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!account) return { ok: false, reason: 'No account with that email' };
  if (account.password !== password) return { ok: false, reason: 'Wrong password' };
  return { ok: true, account };
}
