import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { selectSync } from '../../app/store/syncSlice';
import { Banner, Button, Card, color, EmptyState, ScreenHeader, space, Text } from '../../ui';
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

export function SyncScreen({ onRetryAll, onRetryLane }: Props = {}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const sync = useSelector(selectSync);
  const queued = sync.lanes.reduce((n, l) => n + l.queued, 0);

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
                    status={lane.status === 'dead' ? 'dead' : lane.status === 'retrying' ? 'retrying' : 'sending'}
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

                {lane.status === 'dead' && onRetryLane && (
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

        {sync.conflicts.length > 0 && (
          <>
            <Text variant="caption" color="danger">NEEDS YOUR ATTENTION</Text>
            {sync.conflicts.map(c => (
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

        {onRetryAll && queued > 0 && (
          <Button label="Try all lanes now" onPress={onRetryAll} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const LANE_WORDS = {
  sending: 'Sending', retrying: 'Retrying', dead: 'Failed', conflict: 'Needs you',
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
