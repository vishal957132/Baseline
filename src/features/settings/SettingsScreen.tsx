import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { selectEmail, selectName } from '../../app/store/authSlice';
import { selectCanSignOut, selectQueuedCount } from '../../app/store/syncSlice';
import { importHealthData, type ImportSummary } from '../../app/importService';
import { simulateSignInElsewhere } from '../../app/syncService';
import { storageStats } from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { signOut } from '../auth/signOut';
import { getConnectedSources, setConnectedSources } from '../../data/prefs';
import { DEFAULT_CONNECTED, providersForPlatform } from '../../providers/registry';
import {
  Banner, Button, Card, Chip, color, ListRow, ScreenHeader, space, Text,
} from '../../ui';

interface Props {
  /** Test seam. Left alone, the screen measures the database itself. */
  stats?: { records: number; since: number | null; bytes: number };
}

/**
 * Read-only, on purpose: the toggles a two-day build cannot honour would be
 * worse than none. What it does show is real — the record count, the storage
 * size, and the guard that stops you signing out over unsent changes.
 */
export function SettingsScreen({ stats }: Props) {
  const measured = useQuery(() => storageStats(), []);
  const storage = stats ?? measured.data;
  const dispatch = useDispatch();
  const email = useSelector(selectEmail);
  const name = useSelector(selectName);
  const queued = useSelector(selectQueuedCount);
  const canSignOut = useSelector(selectCanSignOut);
  const [signingOut, setSigningOut] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportSummary | null>(null);

  async function runImport() {
    setImporting(true);
    try {
      setLastImport(await importHealthData());
    } finally {
      setImporting(false);
    }
  }
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
        <Button
          label={importing ? 'Importing…' : 'Import now'}
          variant="secondary"
          icon="upload-cloud"
          disabled={importing || connected.length === 0}
          onPress={() => { runImport(); }}
        />

        {lastImport && lastImport.failed.length > 0 && (
          <Banner
            tone="danger"
            icon="alert-triangle"
            title={`${lastImport.failed.map(f => f.providerId).join(', ')} did not answer`}
            subtitle={`${lastImport.failed[0].error}. The other sources imported normally.`}
            actionLabel="Try again"
            onAction={() => { runImport(); }}
          />
        )}

        {lastImport && lastImport.failed.length === 0 && (
          <Banner
            tone="warn"
            icon="check"
            title={`Imported ${lastImport.imported} reading${lastImport.imported === 1 ? '' : 's'}`}
            subtitle={[
              lastImport.conflicts > 0
                ? `${lastImport.conflicts} now need a decision — see Sync.`
                : 'Nothing was in contention with what you typed.',
              lastImport.skipped > 0
                ? `${lastImport.skipped} skipped — those metrics are switched off.`
                : '',
            ].filter(Boolean).join(' ')}
          />
        )}

        <Text variant="caption" color="textMuted">
          Demo build. Every adapter returns seeded fixtures — swap one line in
          providers/registry.ts to read the real HealthKit or Health Connect store.
        </Text>

        <Text variant="caption" color="textMuted">ON THIS DEVICE</Text>
        <Card style={styles.list}>
          <ListRow
            title={storage ? `${storage.records.toLocaleString()} records` : 'Counting…'}
            subtitle={
              storage
                ? `${describeSince(storage.since)} · ${(storage.bytes / 1_048_576).toFixed(1)} MB on disk`
                : 'reading the database'
            }
          />
          <ListRow title="Units" subtitle="Metric (kg, km)" />
          <ListRow title="Goals" subtitle="70.0 kg · 10,000 steps" />
        </Card>

        {__DEV__ && (
          <Button
            label="Simulate sign-in on another device"
            variant="secondary"
            onPress={simulateSignInElsewhere}
          />
        )}

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

function describeSince(since: number | null): string {
  if (since === null) return 'No readings yet';
  const at = new Date(since);
  return `Since ${at.toLocaleString('en', { month: 'short' })} ${at.getFullYear()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  list: { padding: 0, overflow: 'hidden' },
  disabled: { opacity: 0.5 },
});
