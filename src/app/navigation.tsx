import {
  NavigationContainer, type NavigatorScreenParams,
} from '@react-navigation/native';
import {
  createBottomTabNavigator, type BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text as RNText, View } from 'react-native';
import { useSelector } from 'react-redux';

import type { MetricId } from '../domain/types';
import { ConnectScreen } from '../features/auth/ConnectScreen';
import { GoalsScreen } from '../features/auth/GoalsScreen';
import { SessionEndedScreen } from '../features/auth/SessionEndedScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import { ConflictScreen } from '../features/sync/ConflictScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { LogEntryScreen } from '../features/log/LogEntryScreen';
import { MetricDetailScreen } from '../features/metric/MetricDetailScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { SyncScreen } from '../features/sync/SyncScreen';
import { color, Icon, radius, type IconName } from '../ui';
import { selectAuth } from './store/authSlice';
import { selectSessionExpired } from './store/syncSlice';

/** Named so a screen can jump to a sibling tab rather than to the navigator. */
export type TabParams = {
  Today: undefined;
  History: undefined;
  Sync: undefined;
  Settings: undefined;
};

export type RootStackParams = {
  SignIn: undefined;
  Connect: undefined;
  Goals: undefined;
  SessionEnded: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  MetricDetail: { metricId: MetricId };
  LogEntry: { metricId?: MetricId; measurementId?: string };
  Conflict: { laneKey: string };
};

/**
 * A tab icon with the selected-state indicator above it.
 *
 * A short bar that grows in from the centre, rather than a filled glyph or a
 * pill behind it. These icons are stroke-drawn with `fill="none"`, so filling
 * them makes a solid house of the home icon but an unreadable blob of the sync
 * arrows and the settings sliders; and a pill behind the glyph reads as a
 * hover state more than a selection. A rule at the top edge of the tab is the
 * one treatment that is unambiguous for every glyph and needs no second set of
 * assets kept in step with the first.
 *
 * Spring rather than timing, and driven natively, so the bar settles instead
 * of stopping dead and the motion survives the incoming screen's first render.
 */
function TabIcon({ name, focused, tint }: {
  name: IconName; focused: boolean; tint: string;
}) {
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      damping: 15,
      stiffness: 190,
      mass: 0.6,
    }).start();
  }, [focused, anim]);

  return (
    <View style={styles.tabIcon}>
      <Animated.View
        style={[
          styles.indicator,
          {
            opacity: anim,
            // Grows out from the middle, so the bar appears to be drawn under
            // the tab you chose rather than fading into place.
            transform: [{ scaleX: anim }],
          },
        ]}
      />
      <Animated.View
        style={{
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
          ],
        }}
      >
        <Icon name={name} color={tint} />
      </Animated.View>
    </View>
  );
}

/** Defined once at module scope: an inline arrow here would be a new
 *  component type on every render, throwing away the tab's subtree. */
const icon = (name: IconName) => {
  const Render = ({ color: c, focused }: { color: string; focused: boolean }) => (
    <TabIcon name={name} focused={focused} tint={c} />
  );
  return Render;
};

/**
 * The label, bold once its tab is selected.
 *
 * Rendered rather than styled through `tabBarLabelStyle`, which is one static
 * style for both states and so cannot carry the weight change.
 */
const label = (text: string) => {
  const Render = ({ color: c, focused }: { color: string; focused: boolean }) => (
    <RNText style={[styles.tabLabel, focused && styles.tabLabelOn, { color: c }]}>
      {text}
    </RNText>
  );
  return Render;
};

/**
 * The press target, with every touch effect removed.
 *
 * Two separate effects, one per platform. `pressOpacity` defaults to 0.3 and
 * dips the whole tab to 30% under a finger — but only on iOS. Android never
 * reads it: PlatformPressable takes the ripple branch instead, defaulting to a
 * heavy rgba(0,0,0,.32). So silencing one leaves the other untouched, which is
 * why both are set here.
 *
 * Neither is missed: the indicator sliding in and the label going bold already
 * say which tab you are on, and they say it about the app rather than about
 * the finger.
 */
const tabButton = (props: BottomTabBarButtonProps) => (
  <PlatformPressable {...props} pressOpacity={1} pressColor="transparent" />
);

const TAB_ICON = {
  today: icon('home'),
  history: icon('history'),
  sync: icon('sync'),
  settings: icon('settings'),
};

const TAB_LABEL = {
  today: label('Today'),
  history: label('History'),
  sync: label('Sync'),
  settings: label('Settings'),
};

const Tab = createBottomTabNavigator<TabParams>();
const Stack = createNativeStackNavigator<RootStackParams>();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarButton: tabButton,
        // Slides the screens past each other instead of swapping them in one
        // frame — the tab bar animates, so the content should too.
        animation: 'shift',
      }}
    >
      <Tab.Screen name="Today" component={DashboardScreen}
        options={{ tabBarIcon: TAB_ICON.today, tabBarLabel: TAB_LABEL.today }} />
      <Tab.Screen name="History" component={HistoryScreen}
        options={{ tabBarIcon: TAB_ICON.history, tabBarLabel: TAB_LABEL.history }} />
      <Tab.Screen name="Sync" component={SyncScreen}
        options={{ tabBarIcon: TAB_ICON.sync, tabBarLabel: TAB_LABEL.sync }} />
      <Tab.Screen name="Settings" component={SettingsScreen}
        options={{ tabBarIcon: TAB_ICON.settings, tabBarLabel: TAB_LABEL.settings }} />
    </Tab.Navigator>
  );
}

/**
 * Three gates, in order: no session → sign in; a session without onboarding →
 * Connect then Goals; otherwise the app. A 401 mid-session puts the
 * session-ended screen over whatever the user was doing.
 */
export function Navigation() {
  const auth = useSelector(selectAuth);
  const sessionExpired = useSelector(selectSessionExpired);

  // The splash is still up while the cached session is read, so the app never
  // flashes a sign-in form at someone who is already signed in.
  if (auth.status === 'unknown') return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {auth.status === 'signed-out' ? (
          <Stack.Screen name="SignIn" component={SignInScreen} />
        ) : !auth.onboarded ? (
          <>
            <Stack.Screen name="Connect" component={ConnectScreen} />
            <Stack.Screen name="Goals" component={GoalsScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="MetricDetail" component={MetricDetailScreen} />
            {/*
              The log form is a bottom sheet: transparent, so the dashboard
              stays visible behind it, and sliding up from the bottom so it
              reads as a sheet rather than a page. A plain 'modal' filled the
              screen and put its Cancel/Save bar under the status bar.
            */}
            <Stack.Screen name="LogEntry" component={LogEntryScreen}
              options={{
                presentation: 'transparentModal',
                animation: 'slide_from_bottom',
              }} />
            <Stack.Screen name="Conflict" component={ConflictScreen} />
            {sessionExpired && (
              <Stack.Screen name="SessionEnded" component={SessionEndedScreen}
                options={{ presentation: 'fullScreenModal' }} />
            )}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: color.card,
    borderTopColor: color.border,
    height: 78,
    // React Navigation gives the bar elevation 8 by default, which on Android
    // lifts it above a transparent modal presented over the tabs. The top
    // border already separates it from the content, so the shadow costs
    // nothing to drop and stops the log sheet being overdrawn.
    elevation: 0,
  },
  tabLabel: { fontSize: 11, fontWeight: '500' },
  // Bold, not just tinted: on a pale bar the weight is what carries at a
  // glance, and it still reads for anyone who cannot separate the two colours.
  tabLabelOn: { fontWeight: '800' },
  tabIcon: {
    width: 56, alignItems: 'center', justifyContent: 'center', paddingTop: 12,
  },
  indicator: {
    position: 'absolute', top: 0,
    width: 26, height: 3,
    borderRadius: radius.pill,
    backgroundColor: color.ink,
  },
});
