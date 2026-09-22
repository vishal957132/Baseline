import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';

import type { RootStackParams } from '../../app/navigation';
import { selectSync } from '../../app/store/syncSlice';
import { openConflicts } from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { retryLane, syncNow } from '../../app/syncService';
import { MAX_ATTEMPTS } from '../../sync/engine';
import {
  Banner, Button, Card, EmptyState, ListRow, Screen, ScreenHeader, Text, color, space,
} from '../../ui';
import { SyncQueueItem } from '../components/SyncQueueItem';

/**
 * The queue, grouped by lane.
 *
 * Reads the store only. Starting a drain or retrying a lane goes through the
 * engine, which is handed in by the app shell — the screen never reaches into
 * it directly.
 */
interface Props {
  onRetryAll?: () => void;
  onRetryLane?: (laneKey: string) => void;
}

export function SyncScreen({
  // Defaulted rather than injected by the navigator: the app gets the real
  // service, and tests still pass their own.
  onRetryAll = syncNow,
  onRetryLane = retryLane,
}: Props = {}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const sync = useSelector(selectSync);
  const queued = sync.lanes.reduce((n, l) => n + l.queued, 0);
  const dead = sync.lanes.filter(l => l.status === 'dead');

  // Straight from the table, not from the store. The engine only knows about
  // conflicts the *server* reported; the ones detected locally — a typed
  // reading disagreeing with an imported one — are rows, and were invisible
  // here while this read the engine's in-memory list instead.
  const conflicts = useQuery(() => openConflicts(), []);
  const needsDecision = conflicts.data ?? [];

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader title="Sync" />

        <Banner
          tone={sync.online ? 'warn' : 'warn'}
          icon={sync.online ? 'upload-cloud' : 'wifi-off'}
          title={sync.online ? 'Syncing' : 'Waiting for a connection'}
          subtitle={
            sync.lastSyncedAt
              ? `Last successful sync: ${clock(sync.lastSyncedAt)}`
              : 'Nothing has synced yet'
          }
        />

        {dead.length > 0 && (
          <>
            <Banner
              tone="danger"
              icon="alert-triangle"
              title={`Couldn’t upload ${dead.map(l => laneLabel(l.laneKey)).join(', ')}`}
              subtitle={`Gave up after ${MAX_ATTEMPTS} tries. Nothing was lost — ${dead.reduce((n, l) => n + l.queued, 0)} change${dead.reduce((n, l) => n + l.queued, 0) === 1 ? '' : 's'} are still on this device and upload when you try again.`}
              actionLabel="Try again"
              onAction={onRetryAll}
            />

            {/* One bad lane fails alone; everything else finished. */}
            <Text variant="caption" color="textMuted">WHAT IS WAITING</Text>
            <Card style={styles.laneCard}>
              {sync.lanes.map(lane => (
                <ListRow
                  key={`summary-${lane.laneKey}`}
                  title={laneLabel(lane.laneKey)}
                  subtitle={`${lane.queued} change${lane.queued === 1 ? '' : 's'}`}
                  danger={lane.status === 'dead'}
                  right={
                    <Text
                      variant="caption"
                      color={lane.status === 'dead' ? 'danger' : 'textMuted'}
                    >
                      {lane.status === 'dead'
                        ? `${lane.queued} not sent`
                        : LANE_WORDS[lane.status]}
                    </Text>
                  }
                />
              ))}
            </Card>
          </>
        )}

        {queued === 0 ? (
          <EmptyState
            icon="check"
            title="Everything is up to date"
            body="Changes you make offline appear here until they reach the server."
          />
        ) : (
          <>
            <Text variant="caption" color="textMuted">
              {`${queued} CHANGE${queued === 1 ? '' : 'S'} WAITING TO UPLOAD`}
            </Text>

            {sync.lanes.map(lane => (
              <View key={lane.laneKey} style={styles.lane}>
                {/* The lane header sits outside the card, as a labelled rule. */}
                <View style={styles.laneHead}>
                  <Text variant="caption" color="textMuted">{laneLabel(lane.laneKey)}</Text>
                  <View style={styles.rule} />
                  <Text variant="caption" color={lane.status === 'dead' ? 'danger' : 'warnText'}>
                    {LANE_WORDS[lane.status]}
                  </Text>
                </View>

                <Card style={styles.laneCard}>
                  <SyncQueueItem
                    label={laneLabel(lane.laneKey)}
                    count={lane.queued}
                    status={
                      lane.status === 'dead' ? 'dead'
                      : lane.status === 'retrying' ? 'retrying'
                      : lane.status === 'sending' ? 'sending'
                      : 'queued'
                    }
                    attempts={lane.attempts}
                    retryInSeconds={secondsUntil(lane.nextAttemptAt)}
                  />
                </Card>

                {lane.status === 'dead' && (
                  <Button label="Try these again" variant="danger"
                    onPress={() => onRetryLane(lane.laneKey)} />
                )}
              </View>
            ))}

            <Text variant="caption" color="textMuted">
              Changes are grouped by measurement and day, and each group uploads
              on its own. One group being stuck never holds up the others, and
              within a group your edits arrive in the order you made them.
            </Text>
          </>
        )}

        {needsDecision.length > 0 && (
          <>
            <Text variant="caption" color="danger">NEEDS YOUR ATTENTION</Text>
            {needsDecision.map(c => (
              <Banner
                key={c.laneKey}
                tone="danger"
                icon="alert-triangle"
                title={`${laneLabel(c.laneKey)} has two different values`}
                subtitle="Pick the one you want to keep. The other stays in your history."
                actionLabel="Review"
                onAction={() => nav.navigate('Conflict', { laneKey: c.laneKey })}
              />
            ))}
          </>
        )}

        {queued > 0 && <Button label="Try uploading now" onPress={onRetryAll} />}
      </ScrollView>
    </Screen>
  );
}

/** Status in the user's words. The engine's names stay in the engine. */
const LANE_WORDS = {
  queued: 'Waiting', sending: 'Sending', retrying: 'Trying again',
  dead: 'Not sent', conflict: 'Needs you',
};

/** `weight:2026-09-21` → `Weight · 21 Sep`. */
function laneLabel(laneKey: string): string {
  const [metricId, day] = laneKey.split(':');
  const at = new Date(day);
  const name = metricId.charAt(0).toUpperCase() + metricId.slice(1);
  if (Number.isNaN(at.getTime())) return name;
  return `${name} · ${at.getDate()} ${at.toLocaleString('en', { month: 'short' })}`;
}

function secondsUntil(at: number | null): number | null {
  return at === null ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
}

function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lane: { gap: space.sm },
  laneHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rule: { flex: 1, height: 1, backgroundColor: color.border },
  laneCard: { padding: 0, overflow: 'hidden' },
});
