import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { ALL_METRICS, metric } from '../../domain/metrics';
import type { MetricId, SourceId } from '../../domain/types';
import { providersForPlatform } from '../../providers/registry';
import {
  Banner, Button, Card, Chip, color, Icon, ScreenHeader, space, Text,
} from '../../ui';

/** What each source calls the metric — the reason an adapter layer exists. */
const FIELD_NAMES: Record<MetricId, string> = {
  weight: 'body_mass',
  steps: 'step_count',
  sleep: 'sleep_analysis',
  energy: 'active_energy',
  water: 'water_intake',
};

/** Onboarding step 1: pick a source. */
export function ConnectScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const providers = providersForPlatform();
  const [chosen, setChosen] = useState<SourceId | null>(null);
  const [metrics, setMetrics] = useState<MetricId[]>(ALL_METRICS);

  const toggle = (id: MetricId) =>
    setMetrics(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id]));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader eyebrow="Step 1 of 2" title="Where should we read from?" />

        <Text variant="body" color="textMuted">
          Each source names the same metric differently. One adapter per source
          translates them, so iOS and Android reach the app in an identical shape.
        </Text>

        {providers.map(p => (
          <Card key={p.id} onPress={() => setChosen(p.id)}
            style={chosen === p.id ? styles.picked : undefined}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text variant="label">{p.label}</Text>
                <Text variant="caption" color="textMuted">
                  {`${p.platform} · sample data: ${p.sampleShape}`}
                </Text>
              </View>
              <Chip label={chosen === p.id ? 'Using' : 'Use'}
                tone={chosen === p.id ? 'provider' : 'neutral'} />
            </View>
          </Card>
        ))}

        <Text variant="caption" color="textMuted">READ THESE METRICS</Text>
        <Card style={styles.list}>
          {ALL_METRICS.map(id => (
            <Pressable key={id} onPress={() => toggle(id)} style={styles.metric}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: metrics.includes(id) }}>
              <View style={[styles.box, metrics.includes(id) && styles.boxOn]}>
                {metrics.includes(id) && <Icon name="check" size={14} color={color.textInverse} />}
              </View>
              <View style={styles.grow}>
                <Text variant="label">{metric(id).label}</Text>
                <Text variant="caption" color="textMuted">{FIELD_NAMES[id]}</Text>
              </View>
            </Pressable>
          ))}
        </Card>

        <Banner tone="warn" icon="info-circle"
          title="Demo build — all sources return seeded fixtures"
          subtitle="Not readings from your device. Imports still never overwrite what you typed yourself." />

        <Button label="Continue" onPress={() => nav.navigate('Goals')}
          disabled={chosen === null} />
        <Pressable onPress={() => nav.navigate('Goals')} hitSlop={8}>
          <Text variant="label" color="ink" align="center">Skip for now</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 2 },
  picked: { borderColor: color.ink, borderWidth: 2 },
  list: { padding: 0, overflow: 'hidden' },
  metric: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.lg,
  },
  box: {
    width: 24, height: 24, borderRadius: 6, alignItems: 'center',
    justifyContent: 'center', borderWidth: 2, borderColor: color.border,
  },
  boxOn: { backgroundColor: color.ink, borderColor: color.ink },
});
