import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

import { onboardingFinished } from '../../app/store/authSlice';
import { goalsChanged, selectGoals } from '../../app/store/goalsSlice';
import { selectUnits } from '../../app/store/unitsSlice';
import { bucketByDay } from '../../data/measurementRepo';
import { markOnboarded, setGoals } from '../../data/prefs';
import { useQuery } from '../../data/useQuery';
import { deviceTzOffsetMs, rangeWindow } from '../../domain/time';
import {
  formatIn, sanitizeValueInput, unitFor, type UnitOption,
} from '../../domain/units';
import {
  Banner, Button, Card, Screen, ScreenHeader, Text, TextField, color, radius, space,
} from '../../ui';

const STEP_PRESETS = [6_000, 10_000, 15_000];

/**
 * Goals — onboarding step 2, and the same screen reached again from Settings.
 *
 * One screen rather than two: the fields, the storage and the caveat are
 * identical, and only the framing differs. `edit` swaps the step eyebrow for a
 * back button and returns to Settings instead of completing onboarding.
 *
 * Goals are local settings, not measurements — they live in MMKV, not the
 * measurements table. Changing one never rewrites history; it only changes what
 * progress is measured against (design page 03).
 */
export function GoalsScreen() {
  const dispatch = useDispatch();
  const nav = useNavigation();
  // Which route rendered this, rather than a param: the two live in different
  // branches of the navigator and must not share a name.
  const editing = useRoute().name === 'EditGoals';

  const units = useSelector(selectUnits);
  const weightUnit = unitFor('weight', units);
  const waterUnit = unitFor('water', units);

  // From the store, so reopening the screen shows what was last saved even
  // when nothing has remounted.
  const existing = useSelector(selectGoals);

  /*
   * Fields hold the value in the unit on screen, never the stored one. Goals
   * are kept canonically — kilograms, millilitres — so switching units later
   * re-reads them rather than rewriting them, exactly as a reading does.
   * Typing 154 into a field labelled lb must not store 154 kg.
   */
  const [weight, setWeight] = useState(
    existing.weight === undefined ? '' : formatIn(weightUnit, existing.weight),
  );
  const [water, setWater] = useState(
    existing.water === undefined ? '' : formatIn(waterUnit, existing.water),
  );
  const [steps, setSteps] = useState(existing.steps ?? 10_000);

  /*
   * The real 30-day step average.
   *
   * This line used to read "Your 30-day average is 8,140" from a hardcoded
   * string. Harmless as onboarding flavour nobody re-reads; a plain untruth on
   * a screen you can reopen from Settings to check your numbers against.
   */
  const tz = deviceTzOffsetMs();
  const { from, to } = rangeWindow('30d', Date.now(), tz);
  const stepDays = useQuery(() => bucketByDay('steps', from, to, tz), [from, to]);
  const average = averageOf(stepDays.data);

  function save() {
    const next = {
      weight: toCanonical(weight, weightUnit),
      water: toCanonical(water, waterUnit),
      steps,
    };
    // Both, in this order: MMKV is what survives a restart, the store is what
    // the dashboard and Settings re-render from. Writing only one of them is
    // how a saved goal appears to take and then reverts on the next launch —
    // or takes on restart and nowhere before it.
    setGoals(next);
    dispatch(goalsChanged(next));
  }

  function finishOnboarding(store: boolean) {
    if (store) save();
    // Persist before dispatching: the store gets the user into the app, but
    // only the cached session survives a restart.
    markOnboarded();
    dispatch(onboardingFinished());
  }

  return (
    <Screen style={styles.screen}>
      {/*
        keyboardShouldPersistTaps="handled" is load-bearing, not cosmetic: with
        the default ("never") a tap made while the keyboard is open dismisses
        the keyboard and is swallowed, so the field never gains focus and the
        next keystrokes go nowhere. `padding` on both platforms, because
        edge-to-edge stops the Android window resizing for the keyboard.
      */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
        {editing ? (
          <ScreenHeader title="Goals" onBack={nav.goBack} />
        ) : (
          <ScreenHeader eyebrow="Step 2 of 2" title="What are you aiming for?" />
        )}

        <Text variant="body" color="textMuted">
          Goals turn a number into progress. Set one now or leave it — every
          metric works without one.
        </Text>

        <Card style={styles.group}>
          <TextField label="Target weight" value={weight}
            onChangeText={t => setWeight(sanitizeValueInput(t, weightUnit))}
            unit={weightUnit.label} keyboardType="decimal-pad"
            placeholder={formatIn(weightUnit, 70)} />
          <Text variant="caption" color="textMuted">
            Tracked against your latest reading, whatever its source.
          </Text>
        </Card>

        <Card style={styles.group}>
          <Text variant="caption" color="textMuted">DAILY STEPS</Text>
          <View style={styles.presets}>
            {STEP_PRESETS.map(n => (
              <Pressable key={n} onPress={() => setSteps(n)}
                style={[styles.preset, n === steps && styles.presetOn]}>
                <Text variant="label" color={n === steps ? 'textInverse' : 'text'}>
                  {n.toLocaleString()}
                </Text>
              </Pressable>
            ))}
          </View>
          {average !== null && (
            <Text variant="caption" color="textMuted">
              {`Your 30-day average is ${average.toLocaleString()}.`}
            </Text>
          )}
        </Card>

        <Card style={styles.group}>
          <TextField label="Daily water" value={water}
            onChangeText={t => setWater(sanitizeValueInput(t, waterUnit))}
            unit={waterUnit.label} keyboardType="decimal-pad"
            placeholder={formatIn(waterUnit, 2_500)} />
        </Card>

        <Banner tone="warn" icon="info-circle"
          title="Goals are local settings, not measurements"
          subtitle="Changing one never rewrites history — it only changes what progress is measured against." />

        {editing ? (
          <Button label="Save goals" onPress={() => { save(); nav.goBack(); }} />
        ) : (
          <>
            <Button label="Start tracking" onPress={() => finishOnboarding(true)} />
            <Pressable onPress={() => finishOnboarding(false)} hitSlop={8}>
              <Text variant="label" color="ink" align="center">Set these later</Text>
            </Pressable>
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * What to store, or nothing at all.
 *
 * A blank field means "no goal", which is a supported state — every metric
 * works without one — so it has to come back as undefined rather than as zero.
 */
function toCanonical(text: string, unit: UnitOption): number | undefined {
  const typed = Number(text);
  if (text.trim() === '' || !Number.isFinite(typed) || typed <= 0) return undefined;
  return unit.toCanonical(typed);
}

/** Mean of the days that have a reading, rounded. Null when there are none. */
function averageOf(days: { value: number }[] | null): number | null {
  if (!days || days.length === 0) return null;
  const total = days.reduce((sum, d) => sum + d.value, 0);
  return Math.round(total / days.length);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  fill: { flex: 1 },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  group: { gap: space.sm },
  presets: { flexDirection: 'row', gap: space.sm },
  preset: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    backgroundColor: color.paper, borderRadius: radius.md,
    borderWidth: 1, borderColor: color.border,
  },
  presetOn: { backgroundColor: color.ink, borderColor: color.ink },
});
