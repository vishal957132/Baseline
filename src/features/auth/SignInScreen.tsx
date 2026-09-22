import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ensureDemoData } from '../../app/demoData';
import { signedIn } from '../../app/store/authSlice';
import { setSession } from '../../data/prefs';
import { Banner, Button, Card, color, space, Text, TextField } from '../../ui';
import { ACCOUNTS, signIn } from './accounts';

/**
 * Sign-in.
 *
 * Only reached when there is no cached session — a returning user goes straight
 * to their data, because the local database does not need the network to be
 * readable (design page 01).
 */
export function SignInScreen() {
  const dispatch = useDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const result = signIn(email, password);
    if (!result.ok) {
      setError(result.reason);
      return;
    }

    const { email: e, name, onboarded } = result.account;
    setSession({ email: e, name, onboarded, signedInAt: Date.now() });

    // Signing out wipes the local tables, so a fresh session may be starting
    // on an empty database. Seed before the tree renders, or the dashboard
    // paints nothing and only fills after a reload.
    await ensureDemoData(e);

    dispatch(signedIn({ email: e, name, onboarded }));
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/*
        keyboardShouldPersistTaps="handled" is load-bearing, not cosmetic: with
        the default ("never") a tap made while the keyboard is open dismisses
        the keyboard and is swallowed, so the field never gains focus and the
        next keystrokes go nowhere. KeyboardAvoidingView keeps the focused
        field above the keyboard so the user can see what they typed.
      */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
        <View style={styles.hero}>
          <Text variant="display">Baseline</Text>
          <Text variant="body" color="textMuted">
            Every measurement you take, kept in one timeline — on the device
            first, on the server when it can.
          </Text>
        </View>

        <TextField
          label="Email"
          value={email}
          onChangeText={t => { setEmail(t); setError(null); }}
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={t => { setPassword(t); setError(null); }}
          secure
          placeholder="••••••••"
        />

        {error && (
          <Banner tone="danger" icon="alert-triangle" title={error}
            subtitle="Check the demo accounts below." />
        )}

        <Button label="Sign in" onPress={() => { submit(); }}
          disabled={email.trim() === '' || password === ''} />

        <Text variant="caption" color="textMuted">
          A cached session opens straight to your data. Sign-in is only needed
          when the session has expired and you are online.
        </Text>

        {/* Demo build: the credentials are in the app on purpose. */}
        <Text variant="caption" color="textMuted">DEMO ACCOUNTS — TAP TO FILL</Text>
        {ACCOUNTS.map(a => (
          <Card key={a.email} onPress={() => { setEmail(a.email); setPassword(a.password); setError(null); }}>
            <Text variant="label">{`${a.name} · ${a.email}`}</Text>
            <Text variant="caption" color="textMuted">{`${a.password} · ${a.hint}`}</Text>
          </Card>
        ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  fill: { flex: 1 },
  body: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  hero: { gap: space.sm, paddingVertical: space.xl },
});
