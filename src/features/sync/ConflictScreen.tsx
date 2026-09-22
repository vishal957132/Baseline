import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import {
  laneCandidates, openConflicts, resolveConflict,
} from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { isMetricId, metric } from '../../domain/metrics';
import type { Measurement, MetricId } from '../../domain/types';
import { resolve, type Candidate } from '../../sync/conflict';
import {
  Banner, Button, Card, color, radius, ScreenHeader, space, Text,
} from '../../ui';
import { ConflictOption } from '../components/ConflictOption';

interface Props {
  /** Test seam. Left alone, the screen loads the lane's readings itself. */
  candidates?: Candidate[];
}

function toCandidate(m: Measurement): Candidate {
  return {
    id: m.id,
    lineageId: m.lineageId,
    value: m.value,
    source: m.source,
    serverSeq: m.serverSeq,
    localSeq: m.localSeq,
    recordedAt: m.recordedAt,
  };
}

/**
 * "Which one is right?"
 *
 * The candidate list and the suggestion both come from `resolve()` in
 * sync/conflict — the rule lives in one pure, tested function, and this screen
 * only renders its output.
 */
export function ConflictScreen({ candidates }: Props) {
  const { laneKey } = useRoute<RouteProp<RootStackParams, 'Conflict'>>().params;
  const nav = useNavigation();
  const metricId: MetricId = pickMetric(laneKey);

  const lane = useQuery(() => laneCandidates(laneKey), [laneKey]);
  const open = useQuery(() => openConflicts(), [laneKey]);

  const live = candidates ?? (lane.data ?? []).map(toCandidate);
  const resolution = live.length > 1 ? resolve(live) : null;
  const conflict = (open.data ?? []).find(c => c.laneKey === laneKey);

  const [chosen, setChosen] = useState<string | null>(null);
  const [preferMine, setPreferMine] = useState(false);
  const selected = chosen ?? resolution?.winner.id ?? null;

  async function keep() {
    if (!selected || !conflict) return;
    await resolveConflict({
      conflictId: conflict.id,
      chosenId: selected,
      laneKey,
      source: 'manual',
      now: Date.now(),
    });
    nav.goBack();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader title="Which one is right?" onBack={nav.goBack} />

        {resolution === null ? (
          <Banner
            tone="warn"
            icon="info-circle"
            title="Nothing to decide"
            subtitle="This lane has already been resolved."
          />
        ) : (
          <>
            <Text variant="body" color="textMuted">
              {`${resolution.candidates.length} things touched your ${metric(metricId).label.toLowerCase()} for this day. An entry and its later correction are the same record, so they count once. Pick what to keep — the rest stay in history.`}
            </Text>

            <Card style={styles.timeline}>
              <Text variant="caption" color="textMuted">WHAT HAPPENED</Text>
              {resolution.candidates.map(c => (
                <View key={`t-${c.id}`} style={styles.event}>
                  <View style={[styles.dot, c.source !== 'manual' && styles.dotImport]} />
                  <View style={styles.eventBody}>
                    <Text variant="label">{`${c.value} — ${describe(c)}`}</Text>
                    <Text variant="caption" color="textMuted">
                      {c.serverSeq === null ? 'on this phone' : 'already on the server'}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>

            {resolution.candidates.map(c => (
              <ConflictOption
                key={c.id}
                metricId={metricId}
                value={c.value}
                title={describe(c)}
                detail={`${c.source === 'manual' ? 'Manual' : 'Imported'} · ${c.serverSeq === null ? 'this phone' : 'from the server'}`}
                selected={selected === c.id}
                suggested={resolution.winner.id === c.id}
                onPress={() => setChosen(c.id)}
              />
            ))}

            <Banner
              tone="warn"
              icon="info-circle"
              title="Two imports merge silently, newest first"
              subtitle="Baseline only asks when something you typed is in contention. Order comes from the server sequence where there is one, never from a phone clock."
            />

            <Pressable
              onPress={() => setPreferMine(v => !v)}
              style={styles.checkRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: preferMine }}
            >
              <View style={[styles.box, preferMine && styles.boxOn]} />
              <Text variant="body">Always prefer what I typed myself</Text>
            </Pressable>

            <Button
              label={`Keep ${resolution.candidates.find(c => c.id === selected)?.value ?? ''}`}
              disabled={!conflict}
              onPress={() => { keep(); }}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function describe(c: Candidate): string {
  if (c.source !== 'manual') return 'the imported reading';
  return c.serverSeq === null ? 'your correction' : 'from your other device';
}

function pickMetric(laneKey: string): MetricId {
  const [id] = laneKey.split(':');
  return isMetricId(id) ? id : 'weight';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  timeline: { gap: space.md },
  event: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.ink, marginTop: 5 },
  dotImport: { backgroundColor: color.soft },
  eventBody: { flex: 1, gap: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: color.border },
  boxOn: { backgroundColor: color.ink, borderColor: color.ink },
});
