import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

import type { RootStackParams } from '../../app/navigation';
import { selectEmail, selectName } from '../../app/store/authSlice';
import { selectCanSignOut, selectQueuedCount } from '../../app/store/syncSlice';
import { importHealthData, type ImportSummary } from '../../app/importService';
import { simulateSignInElsewhere } from '../../app/syncService';
import { storageStats } from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { signOut } from '../auth/signOut';
import { selectGoals } from '../../app/store/goalsSlice';
import { selectUnits, unitChanged } from '../../app/store/unitsSlice';
import {
  getConnectedSources, getImportedMetrics, setConnectedSources,
  setImportedMetrics, setUnitPrefs,
} from '../../data/prefs';
import { ALL_METRICS, metric } from '../../domain/metrics';
import type { Goals } from '../../data/prefs';
import type { MetricId } from '../../domain/types';
import {
  CONVERTIBLE_METRICS, formatWithUnit, UNIT_OPTIONS, unitFor, type UnitId,
} from '../../domain/units';
import {
  connectedProviders, DEFAULT_CONNECTED, providersForPlatform,
} from '../../providers/registry';
import {
  Banner, Button, Card, Chip, Icon, ListRow, Screen, ScreenHeader, Text, color, radius, space,
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
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
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
  const units = useSelector(selectUnits);
  const goals = useSelector(selectGoals);
  /*
   * Which metrics an import may bring in.
   *
   * Chosen during onboarding and, until now, never again — a decision made
   * once on a screen you cannot return to was permanent until reinstall. Held
   * in local state rather than Redux because nothing outside this screen and
   * the import renders from it, and the import reads storage directly.
   */
  const [imported, setImported] = useState(() => getImportedMetrics(ALL_METRICS));

  function toggleMetric(id: MetricId) {
    const next = imported.includes(id)
      ? imported.filter(x => x !== id)
      : [...imported, id];
    setImported(next);
    setImportedMetrics(next);
  }

  /**
   * Both the store and MMKV: the store is what the screens re-render from, and
   * MMKV is what survives a restart. Writing only one of them is how a setting
   * appears to work and then forgets itself.
   */
  function chooseUnit(metricId: MetricId, unit: UnitId) {
    setUnitPrefs({ ...units, [metricId]: unit });
    dispatch(unitChanged({ metric: metricId, unit }));
  }

  /*
   * What this device can actually read from, which is not the same as what is
   * stored. The saved list is cross-platform — an Android phone still carries
   * a preference for Apple Health — so counting it directly left the import
   * button enabled after both visible toggles were switched off, and pressing
   * it reported importing nothing. `importHealthData` already intersects with
   * the platform; the button has to ask the same question.
   */
  const usable = connectedProviders(connected);

  function toggleSource(id: (typeof connected)[number]) {
    const next = connected.includes(id)
      ? connected.filter(x => x !== id)
      : [...connected, id];
    setConnected(next);
    setConnectedSources(next);
  }

  return (
    <Screen style={styles.screen}>
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
          label={importing ? 'Checking your health apps…' : 'Get my latest readings'}
          variant="secondary"
          icon="upload-cloud"
          disabled={importing || usable.length === 0}
          onPress={() => { runImport(); }}
        />
        <Text variant="caption" color="textMuted">
          {usable.length === 0
            ? 'Switch on a health app above to bring readings in.'
            : 'Looks at the health apps switched on above and brings in anything new from the last 30 days. Nothing is removed, nothing you typed is changed, and running it twice adds nothing twice.'}
        </Text>

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
          Demo build. Every source returns sample data. Going live changes one
          adapter file per source, and nothing above it.
        </Text>

        <Text variant="caption" color="textMuted">READ THESE METRICS</Text>
        <Card style={styles.list}>
          {ALL_METRICS.map(id => (
            <ListRow
              key={id}
              title={metric(id).label}
              subtitle={
                imported.includes(id)
                  ? 'Brought in by an import'
                  : 'Skipped by an import'
              }
              onPress={() => toggleMetric(id)}
              right={
                <Chip
                  label={imported.includes(id) ? 'On' : 'Off'}
                  tone={imported.includes(id) ? 'provider' : 'neutral'}
                />
              }
            />
          ))}
        </Card>
        <Text variant="caption" color="textMuted">
          {imported.length === 0
            ? 'Nothing selected — an import would bring in nothing.'
            : 'Only affects what an import reads. You can still log any metric yourself, and switching one off never removes readings you already have.'}
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
        </Card>

        <Text variant="caption" color="textMuted">UNITS</Text>
        <Card style={styles.list}>
          {CONVERTIBLE_METRICS.map(id => {
            const chosen = unitFor(id, units);
            return (
              <ListRow
                key={id}
                title={metric(id).label}
                subtitle={`Shown in ${chosen.name.toLowerCase()}`}
                right={
                  <View style={styles.units}>
                    {UNIT_OPTIONS[id].map(option => (
                      <Pressable
                        key={option.id}
                        onPress={() => chooseUnit(id, option.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: option.id === chosen.id }}
                        style={[styles.unit, option.id === chosen.id && styles.unitOn]}
                      >
                        <Text
                          variant="label"
                          color={option.id === chosen.id ? 'textInverse' : 'text'}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                }
              />
            );
          })}
        </Card>
        <Text variant="caption" color="textMuted">
          A display choice only. Every reading stays stored in one unit, so
          switching here re-reads your whole history rather than rewriting any
          of it.
        </Text>

        <Text variant="caption" color="textMuted">GOALS</Text>
        <Card style={styles.list}>
          <ListRow
            title="Targets"
            subtitle={describeGoals(goals, units)}
            onPress={() => nav.navigate('EditGoals')}
            right={<Icon name="chevron-right" size={18} color={color.textMuted} />}
          />
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
    </Screen>
  );
}

/** The saved goals, each in the unit the user reads it in. */
function describeGoals(
  goals: Goals, units: Parameters<typeof unitFor>[1],
): string {
  const parts = (Object.keys(goals) as MetricId[])
    .filter(id => goals[id] !== undefined)
    .map(id => formatWithUnit(id, goals[id] as number, units));
  return parts.length > 0 ? parts.join(' · ') : 'None set';
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
  units: { flexDirection: 'row', gap: space.xs },
  unit: {
    minWidth: 46, alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: space.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.card,
  },
  unitOn: { backgroundColor: color.ink, borderColor: color.ink },
});
