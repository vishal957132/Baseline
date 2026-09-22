import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { selectEmail, signedIn } from '../../app/store/authSlice';
import { selectSync } from '../../app/store/syncSlice';
import { resumeSession } from '../../app/syncService';
import { setSession } from '../../data/prefs';
import { Banner, Button, Card, color, ListRow, space, Text, TextField } from '../../ui';
import { signIn } from './accounts';
import { signOut } from './signOut';

/**
 * Signed in elsewhere (design page 12).
 *
 * The queue is shown deliberately: the unsent changes are safe, they stay on
 * this device, and they go out in order once the session is back. Nothing is
 * discarded and nothing is sent twice, because each op carries the id it was
 * created with.
 */
export function SessionEndedScreen() {
  const dispatch = useDispatch();
  const email = useSelector(selectEmail);
  const sync = useSelector(selectSync);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const queued = sync.lanes.reduce((n, l) => n + l.queued, 0);

  function resume() {
    const result = signIn(email ?? '', password);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    const { email: e, name } = result.account;
    setSession({ email: e, name, onboarded: true, signedInAt: Date.now() });
    dispatch(signedIn({ email: e, name, onboarded: true }));
    // Clear the expiry and let the held changes go out, in order.
    resumeSession();
  }

  /** Signing in as someone else clears this device, unsent changes included. */
  function useDifferentAccount() {
    signOut(dispatch).catch(() => undefined);
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
          <Text variant="display">You signed in on another device</Text>
          <Text variant="body" color="textMuted">
            This session ended when Baseline was opened elsewhere. Sign in again
            to carry on here.
          </Text>
        </View>

        {queued > 0 && (
          <>
            <Banner tone="warn" icon="shield-check"
              title={`Your ${queued} unsent change${queued === 1 ? '' : 's'} are safe`}
              subtitle="They stay on this device and upload in order once you are back." />
            <Card style={styles.list}>
              {sync.lanes.map(lane => (
                <ListRow key={lane.laneKey} title={lane.laneKey}
                  subtitle={`${lane.queued} queued`} />
              ))}
            </Card>
          </>
        )}

        <TextField
          label={`Password for ${email ?? 'your account'}`}
          value={password}
          onChangeText={t => { setPassword(t); setError(null); }}
          secure
        />
        {error && <Banner tone="danger" icon="alert-triangle" title={error} />}

        <Button label="Sign in and resume sync" onPress={resume}
          disabled={password === ''} />

        <Text variant="caption" color="textMuted">
          Signing in as someone else clears this device, unsent changes included.
        </Text>
        <Pressable onPress={useDifferentAccount} hitSlop={8}>
          <Text variant="label" color="danger" align="center">Use a different account</Text>
        </Pressable>
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
  list: { padding: 0, overflow: 'hidden' },
});
