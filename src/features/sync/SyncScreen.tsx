import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { selectSync } from '../../app/store/syncSlice';
import { openConflicts } from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { retryLane, syncNow } from '../../app/syncService';
import { MAX_ATTEMPTS } from '../../sync/engine';
import {
  Banner, Button, Card, color, EmptyState, ListRow, ScreenHeader, space, Text,
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
    <SafeAreaView style={styles.screen} edges={['top']}>
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
              title={`${dead.map(l => laneLabel(l.laneKey)).join(', ')} stopped after ${MAX_ATTEMPTS} attempts`}
              subtitle={`Nothing was lost — ${dead.reduce((n, l) => n + l.queued, 0)} change${dead.reduce((n, l) => n + l.queued, 0) === 1 ? '' : 's'} are still on this device and go out when you retry.`}
              actionLabel="Retry all"
              onAction={onRetryAll}
            />

            {/* One bad lane fails alone; everything else finished. */}
            <Text variant="caption" color="textMuted">LANES</Text>
            <Card style={styles.laneCard}>
              {sync.lanes.map(lane => (
                <ListRow
                  key={`summary-${lane.laneKey}`}
                  title={laneLabel(lane.laneKey)}
                  subtitle={`${lane.queued} queued`}
                  danger={lane.status === 'dead'}
                  right={
                    <Text
                      variant="caption"
                      color={lane.status === 'dead' ? 'danger' : 'textMuted'}
                    >
                      {lane.status === 'dead'
                        ? `${lane.queued} held · failed`
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
            <View style={styles.head}>
              <Text variant="caption" color="textMuted">
                {`QUEUED · ${queued} IN ${sync.lanes.length} LANE${sync.lanes.length === 1 ? '' : 'S'}`}
              </Text>
              <Text variant="caption" color="textMuted">Lanes run in parallel</Text>
            </View>

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
                    index={1}
                    kind="create"
                    label={laneLabel(lane.laneKey)}
                    opId={lane.laneKey.slice(-6)}
                    localSeq={lane.attempts + 12}
                    status={
                      lane.status === 'dead' ? 'dead'
                      : lane.status === 'retrying' ? 'retrying'
                      : lane.status === 'sending' ? 'sending'
                      : 'queued'
                    }
                    attempts={lane.attempts}
                    retryInSeconds={secondsUntil(lane.nextAttemptAt)}
                  />
                  {lane.queued > 1 && (
                    <SyncQueueItem
                      index={2}
                      kind="update"
                      label={`${lane.queued - 1} more`}
                      opId="queued"
                      localSeq={lane.attempts + 13}
                      status="queued"
                      heldBehind={1}
                    />
                  )}
                </Card>

                {lane.status === 'dead' && (
                  <Button label="Retry this lane" variant="danger"
                    onPress={() => onRetryLane(lane.laneKey)} />
                )}
              </View>
            ))}

            <Text variant="caption" color="textMuted">
              Order holds inside a lane, never across them. Sent ops keep the
              server’s sequence; anything still queued sorts after, by local number.
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
                title={`${laneLabel(c.laneKey)} has two versions`}
                subtitle="Same lane, now needing a decision"
                actionLabel="Review"
                onAction={() => nav.navigate('Conflict', { laneKey: c.laneKey })}
              />
            ))}
          </>
        )}

        {queued > 0 && <Button label="Try all lanes now" onPress={onRetryAll} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const LANE_WORDS = {
  queued: 'Queued', sending: 'Sending', retrying: 'Retrying',
  dead: 'Failed', conflict: 'Needs you',
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
