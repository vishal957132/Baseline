import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { onboardingFinished } from '../../app/store/authSlice';
import { getGoals, markOnboarded, setGoals } from '../../data/prefs';
import { Banner, Button, Card, color, radius, ScreenHeader, space, Text, TextField } from '../../ui';

const STEP_PRESETS = [6_000, 10_000, 15_000];

/**
 * Keep only digits and a single decimal point.
 *
 * A pad keyboard should not be able to produce anything else, but a hardware
 * keyboard can — and a stray letter would make `Number()` return NaN, which
 * `|| undefined` would then silently swallow, losing the goal the user typed.
 * Partial input like "68." survives, because it is a state you pass through
 * while typing.
 */
function numericOnly(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('')}` : whole;
}

/**
 * Onboarding step 2: goals.
 *
 * Goals are local settings, not measurements — they live in MMKV, not the
 * measurements table. Changing one never rewrites history; it only changes what
 * progress is measured against (design page 03).
 */
export function GoalsScreen() {
  const dispatch = useDispatch();
  const existing = getGoals();

  const [weight, setWeight] = useState(String(existing.weight ?? ''));
  const [steps, setSteps] = useState(existing.steps ?? 10_000);
  const [water, setWater] = useState(String((existing.water ?? 2_500) / 1000));

  function finish(save: boolean) {
    if (save) {
      setGoals({
        weight: Number(weight) || undefined,
        steps,
        water: Number(water) ? Number(water) * 1000 : undefined,
      });
    }
    // Persist before dispatching: the store gets the user into the app, but
    // only the cached session survives a restart.
    markOnboarded();
    dispatch(onboardingFinished());
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
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
        <ScreenHeader eyebrow="Step 2 of 2" title="What are you aiming for?" />

        <Text variant="body" color="textMuted">
          Goals turn a number into progress. Set one now or leave it — every
          metric works without one.
        </Text>

        <Card style={styles.group}>
          <TextField label="Target weight" value={weight}
            onChangeText={t => setWeight(numericOnly(t))}
            unit="kg" keyboardType="decimal-pad" placeholder="70.0" />
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
          <Text variant="caption" color="textMuted">Your 30-day average is 8,140.</Text>
        </Card>

        <Card style={styles.group}>
          <TextField label="Daily water" value={water}
            onChangeText={t => setWater(numericOnly(t))}
            unit="litres per day" keyboardType="decimal-pad" placeholder="2.5" />
        </Card>

        <Banner tone="warn" icon="info-circle"
          title="Goals are local settings, not measurements"
          subtitle="Changing one never rewrites history — it only changes what progress is measured against." />

        <Button label="Start tracking" onPress={() => finish(true)} />
        <Pressable onPress={() => finish(false)} hitSlop={8}>
          <Text variant="label" color="ink" align="center">Set these later</Text>
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
