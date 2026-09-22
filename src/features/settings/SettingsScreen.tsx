import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { selectEmail, selectName } from '../../app/store/authSlice';
import { selectCanSignOut, selectQueuedCount } from '../../app/store/syncSlice';
import { signOut } from '../auth/signOut';
import { getConnectedSources, setConnectedSources } from '../../data/prefs';
import { DEFAULT_CONNECTED, providersForPlatform } from '../../providers/registry';
import {
  Banner, Button, Card, Chip, color, ListRow, ScreenHeader, space, Text,
} from '../../ui';

interface Props {
  /** Real counts, read once at mount by the app shell. */
  recordCount?: number;
  storageBytes?: number;
}

/**
 * Read-only, on purpose: the toggles a two-day build cannot honour would be
 * worse than none. What it does show is real — the record count, the storage
 * size, and the guard that stops you signing out over unsent changes.
 */
export function SettingsScreen({ recordCount, storageBytes }: Props) {
  const dispatch = useDispatch();
  const email = useSelector(selectEmail);
  const name = useSelector(selectName);
  const queued = useSelector(selectQueuedCount);
  const canSignOut = useSelector(selectCanSignOut);
  const [signingOut, setSigningOut] = useState(false);
  const [connected, setConnected] = useState(() =>
    getConnectedSources(DEFAULT_CONNECTED),
  );

  function toggleSource(id: (typeof connected)[number]) {
    const next = connected.includes(id)
      ? connected.filter(x => x !== id)
      : [...connected, id];
    setConnected(next);
    setConnectedSources(next);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader title="Settings" />

        <Card>
          <Text variant="label">{name ?? 'Not signed in'}</Text>
          <Text variant="caption" color="textMuted">
            {email ? `${email} · signed in on this device` : 'No cached session'}
          </Text>
        </Card>

        <Text variant="caption" color="textMuted">DATA SOURCES</Text>
        <Card style={styles.list}>
          {providersForPlatform().map(p => (
            <ListRow
              key={p.id}
              title={`${p.label} · ${p.platform}`}
              subtitle={p.sampleShape}
              onPress={() => toggleSource(p.id)}
              right={
                <Chip
                  label={connected.includes(p.id) ? 'On' : 'Off'}
                  tone={connected.includes(p.id) ? 'provider' : 'neutral'}
                />
              }
            />
          ))}
        </Card>
        <Text variant="caption" color="textMuted">
          Demo build. Every adapter returns seeded fixtures — swap one line in
          providers/registry.ts to read the real HealthKit or Health Connect store.
        </Text>

        <Text variant="caption" color="textMuted">ON THIS DEVICE</Text>
        <Card style={styles.list}>
          <ListRow
            title={`${(recordCount ?? 0).toLocaleString()} records`}
            subtitle={
              storageBytes
                ? `${(storageBytes / 1_048_576).toFixed(1)} MB on disk`
                : 'reading…'
            }
          />
          <ListRow title="Units" subtitle="Metric (kg, km)" />
          <ListRow title="Goals" subtitle="70.0 kg · 10,000 steps" />
        </Card>

        {!canSignOut && (
          <Banner
            tone="danger"
            icon="alert-triangle"
            title={`${queued} change${queued === 1 ? '' : 's'} have not reached the server`}
            subtitle="Signing out now would discard them, so that button is disabled until this clears."
          />
        )}

        <View style={canSignOut ? undefined : styles.disabled}>
          <Button
            label={signingOut ? 'Signing out…' : 'Sign out'}
            variant="secondary"
            disabled={!canSignOut || signingOut}
            onPress={() => {
              setSigningOut(true);
              // Clears the readings, the goals and the session, then the
              // navigator gates back to sign-in.
              signOut(dispatch).catch(() => setSigningOut(false));
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  list: { padding: 0, overflow: 'hidden' },
  disabled: { opacity: 0.5 },
});
