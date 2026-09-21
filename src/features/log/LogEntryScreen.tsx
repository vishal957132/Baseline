import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { selectSync } from '../../app/store/syncSlice';
import { addMeasurement, editMeasurement, removeMeasurement } from '../../data/measurementRepo';
import { EDITABLE_METRICS, metric } from '../../domain/metrics';
import { deviceTzOffsetMs, laneKey } from '../../domain/time';
import type { MetricId } from '../../domain/types';
import { Banner, Button, color, radius, space, Text, TextField } from '../../ui';

/**
 * Add, edit or delete one reading.
 *
 * A sheet, not a page: the dashboard stays visible behind it, because the entry
 * form must never block the app (design page 07). Saving works offline — the
 * write lands locally and the upload is queued.
 */
export function LogEntryScreen() {
  const route = useRoute<RouteProp<RootStackParams, 'LogEntry'>>();
  const nav = useNavigation();
  const sync = useSelector(selectSync);

  const [metricId, setMetricId] = useState<MetricId>(route.params?.metricId ?? 'weight');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const editing = route.params?.measurementId;
  const d = metric(metricId);
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    const now = Date.now();
    const tz = deviceTzOffsetMs();
    try {
      if (editing) {
        await editMeasurement({
          id: editing, lineageId: editing, metric: metricId,
          value: parsed, recordedAt: now, source: 'manual', tzOffsetMs: tz, now,
        });
      } else {
        await addMeasurement({
          id: `m-${now}`, metric: metricId, value: parsed,
          recordedAt: now, source: 'manual', tzOffsetMs: tz, now,
        });
      }
      nav.goBack();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Delete lives only here, not on the list row. If the entry never reached the
   * server, this cancels its queued upload rather than sending a delete.
   */
  async function remove() {
    if (!editing) return;
    const now = Date.now();
    await removeMeasurement({
      id: editing,
      lineageId: editing,
      laneKey: laneKey(metricId, now, deviceTzOffsetMs()),
      source: 'manual',
      now,
    });
    nav.goBack();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.bar}>
        <Pressable onPress={nav.goBack} hitSlop={8}>
          <Text variant="label" color="textMuted">Cancel</Text>
        </Pressable>
        <Text variant="title">{editing ? `Edit ${d.label.toLowerCase()}` : `Log ${d.label.toLowerCase()}`}</Text>
        <Pressable onPress={save} disabled={!valid} hitSlop={8}>
          <Text variant="label" color={valid ? 'ink' : 'textMuted'}>Save</Text>
        </Pressable>
      </View>

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
        {!editing && (
          <View style={styles.tabs}>
            {EDITABLE_METRICS.map(id => (
              <Pressable
                key={id}
                onPress={() => setMetricId(id)}
                style={[styles.tab, id === metricId && styles.tabOn]}
              >
                <Text variant="label" color={id === metricId ? 'textInverse' : 'text'}>
                  {metric(id).label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <TextField
          label={d.label}
          value={value}
          onChangeText={setValue}
          unit={d.unit}
          keyboardType="decimal-pad"
          placeholder="0"
          autoFocus
        />
        <TextField label="Note (optional)" value={note} onChangeText={setNote} />

        {!sync.online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="You are offline"
            subtitle="This saves to the device now and uploads on its own once you are back."
          />
        )}

        <Button
          label={editing ? 'Save changes' : 'Save measurement'}
          onPress={save}
          disabled={!valid || saving}
        />

        {editing && (
          <>
            <Button label="Delete this entry" variant="danger" onPress={remove} />
            <Text variant="caption" color="textMuted">
              Deleting is only here, not on the list row. If this entry has never
              reached the server, the delete cancels its queued upload instead of
              sending one.
            </Text>
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: space.lg, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  body: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    backgroundColor: color.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.border,
  },
  tabOn: { backgroundColor: color.ink, borderColor: color.ink },
});
