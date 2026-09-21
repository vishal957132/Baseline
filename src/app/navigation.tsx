import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
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
import { color, Icon, type IconName } from '../ui';
import { selectAuth } from './store/authSlice';
import { selectSessionExpired } from './store/syncSlice';

export type RootStackParams = {
  SignIn: undefined;
  Connect: undefined;
  Goals: undefined;
  SessionEnded: undefined;
  Tabs: undefined;
  MetricDetail: { metricId: MetricId };
  LogEntry: { metricId?: MetricId; measurementId?: string };
  Conflict: { laneKey: string };
};

/** Defined once at module scope: an inline arrow here would be a new
 *  component type on every render, throwing away the tab's subtree. */
const icon = (name: IconName) => {
  const Render = ({ color: c }: { color: string }) => <Icon name={name} color={c} />;
  return Render;
};

const TAB_ICON = {
  today: icon('home'),
  history: icon('history'),
  sync: icon('sync'),
  settings: icon('settings'),
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParams>();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: { backgroundColor: color.card, borderTopColor: color.border },
      }}
    >
      <Tab.Screen name="Today" component={DashboardScreen}
        options={{ tabBarIcon: TAB_ICON.today }} />
      <Tab.Screen name="History" component={HistoryScreen}
        options={{ tabBarIcon: TAB_ICON.history }} />
      <Tab.Screen name="Sync" component={SyncScreen}
        options={{ tabBarIcon: TAB_ICON.sync }} />
      <Tab.Screen name="Settings" component={SettingsScreen}
        options={{ tabBarIcon: TAB_ICON.settings }} />
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
            {/* The log form is a sheet: the dashboard stays visible behind it. */}
            <Stack.Screen name="LogEntry" component={LogEntryScreen}
              options={{ presentation: 'modal' }} />
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
