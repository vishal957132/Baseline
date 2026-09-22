import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { selectSync } from '../../app/store/syncSlice';
import { selectUnits } from '../../app/store/unitsSlice';
import {
  addMeasurement, editMeasurement, measurementById, removeMeasurement,
} from '../../data/measurementRepo';
import { useQuery } from '../../data/useQuery';
import { EDITABLE_METRICS, metric } from '../../domain/metrics';
import {
  deviceTzOffsetMs, fromLocalDateTime, laneKey, toLocalDateTime,
} from '../../domain/time';
import type { MetricId } from '../../domain/types';
import {
  formatIn, sanitizeValueInput, unitFor, validateValue,
} from '../../domain/units';
import { Banner, Button, color, radius, space, Text, TextField } from '../../ui';

/**
 * Add, edit or delete one reading.
 *
 * A sheet, not a page: the dashboard stays visible behind it, because the entry
 * form must never block the app (design page 07). Saving works offline — the
 * write lands locally and the upload is queued.
 *
 * The sheet is bottom-anchored and capped below full height. It used to be a
 * plain modal filling the screen, which put the Cancel/Save bar underneath the
 * status bar — on a tall phone the two collided and neither button could be
 * tapped. Anchored to the bottom, the bar cannot reach the notch on any device.
 */
export function LogEntryScreen() {
  const route = useRoute<RouteProp<RootStackParams, 'LogEntry'>>();
  const nav = useNavigation();
  const sync = useSelector(selectSync);
  const units = useSelector(selectUnits);
  const insets = useSafeAreaInsets();

  const editing = route.params?.measurementId;
  const tz = deviceTzOffsetMs();
  const opened = useRef(toLocalDateTime(Date.now(), tz)).current;

  const [metricId, setMetricId] = useState<MetricId>(route.params?.metricId ?? 'weight');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(opened.date);
  const [time, setTime] = useState(opened.time);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Editing fills the form from the reading itself. Without this an edit kept
  // the value you retyped but stamped it `now`, quietly moving an old reading
  // to today.
  const existing = useQuery(
    () => (editing ? measurementById(editing) : Promise.resolve(null)),
    [editing],
  );
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !existing.data) return;
    loaded.current = true;
    const m = existing.data;
    setMetricId(m.metric);
    // Shown in the unit the user reads, not the unit it is stored in — editing
    // a reading while the app is set to pounds must not present kilograms.
    setValue(formatIn(unitFor(m.metric, units), m.value));
    const at = toLocalDateTime(m.recordedAt, tz);
    setDate(at.date);
    setTime(at.time);
  }, [existing.data, tz, units]);

  const d = metric(metricId);
  const unit = unitFor(metricId, units);
  const checked = validateValue(value, unit);
  const recordedAt = fromLocalDateTime(date, time, tz);
  const whenOk = recordedAt !== null && recordedAt <= Date.now();
  const valid = checked.ok && whenOk;

  /** Switching metric changes the unit, so 72.6 kg must not become 72.6 ml. */
  function pickMetric(id: MetricId) {
    setMetricId(id);
    setValue('');
    setTouched(false);
  }

  async function save() {
    if (!checked.ok || !whenOk || saving || recordedAt === null) return;
    setSaving(true);
    const now = Date.now();
    try {
      if (editing) {
        await editMeasurement({
          id: editing,
          lineageId: existing.data?.lineageId ?? editing,
          metric: metricId,
          value: checked.canonical,
          recordedAt, source: 'manual', tzOffsetMs: tz, now,
        });
      } else {
        await addMeasurement({
          id: `m-${now}`, metric: metricId, value: checked.canonical,
          recordedAt, source: 'manual', tzOffsetMs: tz, now,
        });
      }
      nav.goBack();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Delete, behind a confirmation.
   *
   * Confirmed rather than immediate because the row leaves every screen the
   * moment it happens, and the undo appears on History — which is not
   * necessarily where you came from. If the entry never reached the server
   * this cancels its queued upload instead of sending a delete.
   */
  function confirmRemove() {
    if (!editing) return;
    const label = `${formatIn(unit, existing.data?.value ?? 0)} ${unit.label}`;
    Alert.alert(
      `Delete this ${d.label.toLowerCase()} entry?`,
      `${label} will be removed from your history. You can undo this for a few seconds afterwards.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { remove(label); } },
      ],
    );
  }

  async function remove(label: string) {
    if (!editing) return;
    const now = Date.now();
    await removeMeasurement({
      id: editing,
      lineageId: existing.data?.lineageId ?? editing,
      // The reading's own lane, not today's — deleting must not touch a
      // different day's queue.
      laneKey: existing.data?.laneKey ?? laneKey(metricId, now, tz),
      source: 'manual',
      now,
      label,
    });
    nav.goBack();
  }

  // Nothing typed yet is not a mistake, so an untouched field stays quiet.
  const showValueError = touched && !checked.ok && checked.reason !== 'empty';

  return (
    <View style={styles.backdrop}>
      {/* Tapping the dimmed area dismisses the sheet, which is what a sheet is
          expected to do — and is the way out if the keyboard covers the bar. */}
      <Pressable
        style={styles.scrim}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={nav.goBack}
      />

      {/*
        `padding` on Android too, not just iOS.
        `edgeToEdgeEnabled=true` in gradle.properties means the window no
        longer resizes for the keyboard — android:windowSoftInputMode
        ="adjustResize" stops applying once the app draws behind the system
        bars, and the keyboard simply covers whatever is underneath. Leaving
        `behavior` undefined on Android made this a no-op view, so the sheet
        stayed where it was and the keyboard sat on top of the fields.
      */}
      <KeyboardAvoidingView behavior="padding" style={styles.lift}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.grabber} />

          <View style={styles.bar}>
            <Pressable onPress={nav.goBack} hitSlop={12}>
              <Text variant="label" color="textMuted">Cancel</Text>
            </Pressable>
            <Text variant="title">
              {editing ? `Edit ${d.label.toLowerCase()}` : `Log ${d.label.toLowerCase()}`}
            </Text>
            <Pressable onPress={save} disabled={!valid} hitSlop={12}>
              <Text variant="label" color={valid ? 'ink' : 'textMuted'}>Save</Text>
            </Pressable>
          </View>

          {/*
            keyboardShouldPersistTaps="handled" is load-bearing, not cosmetic:
            with the default ("never") a tap made while the keyboard is open
            dismisses the keyboard and is swallowed, so the field never gains
            focus and the next keystrokes go nowhere.
          */}
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {!editing && (
              <View style={styles.tabs}>
                {EDITABLE_METRICS.map(id => (
                  <Pressable
                    key={id}
                    onPress={() => pickMetric(id)}
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
              // Filtered as it is typed, so the field can never hold something
              // the save path would have to reject: digits only, one decimal
              // point, no more decimals than the unit carries, bounded length.
              onChangeText={next => {
                setValue(sanitizeValueInput(next, unit));
                setTouched(true);
              }}
              unit={unit.label}
              keyboardType="decimal-pad"
              placeholder="0"
              autoFocus
            />

            {showValueError && (
              <Banner
                tone="danger"
                icon="alert-triangle"
                title={checked.message}
                subtitle={`${d.label} is recorded between ${trimmed(unit.min)} and ${trimmed(unit.max)} ${unit.label}.`}
              />
            )}

            <View style={styles.when}>
              <View style={styles.whenField}>
                <TextField label="Date" value={date} onChangeText={setDate}
                  placeholder="2026-09-22" />
              </View>
              <View style={styles.whenField}>
                <TextField label="Time" value={time} onChangeText={setTime}
                  placeholder="08:43" />
              </View>
            </View>

            {!whenOk && (date !== '' || time !== '') && (
              <Banner
                tone="danger"
                icon="alert-triangle"
                title={recordedAt === null ? 'That is not a real date and time' : 'That is in the future'}
                subtitle="Use YYYY-MM-DD and HH:MM. A reading cannot be taken later than now."
              />
            )}

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
              <Button label="Delete this entry" variant="danger" onPress={confirmRemove} />
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** `2.5` not `2.50`, `500` not `500.0`. */
function trimmed(n: number): string {
  return String(Number(n.toFixed(2)));
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000059',
    /*
     * Just enough Z to stay above the tab bar, which is now elevation 0.
     *
     * This was 24, and Android drew the elevation shadow around the outline of
     * this full-screen view: a wide dark band down every edge, which read as a
     * pale box floating over the middle of the dimmed dashboard. A shadow on a
     * view the size of the screen has nothing to fall on and nothing to
     * describe, so it only ever shows up as an artefact.
     */
    elevation: 1,
    zIndex: 1,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Holds the sheet at the bottom and gives `maxHeight` below something to be
  // a percentage *of* — when the keyboard is up this box is the shorter one,
  // so the cap follows the space that is actually left.
  lift: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    // Capped rather than full-height: the bar stays clear of the status bar on
    // any device, and the dashboard behind stays visible, which is the point
    // of a sheet.
    maxHeight: '86%',
    backgroundColor: color.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill,
    backgroundColor: color.border, marginTop: space.sm,
  },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: space.lg, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  body: { gap: space.lg, padding: space.lg, paddingBottom: space.xl },
  tabs: { flexDirection: 'row', gap: space.sm },
  when: { flexDirection: 'row', gap: space.md },
  whenField: { flex: 1 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    backgroundColor: color.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.border,
  },
  tabOn: { backgroundColor: color.ink, borderColor: color.ink },
});
