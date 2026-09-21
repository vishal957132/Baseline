/**
 * App shell: store, safe areas, navigation.
 *
 * The database opens and seeds before the tree mounts, so the first frame has
 * data to paint rather than a spinner.
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import BootSplash from 'react-native-bootsplash';

import { Navigation } from './src/app/navigation';
import { store } from './src/app/store';
import { sessionRestored } from './src/app/store/authSlice';
import { openDatabase } from './src/data/db';
import { getSession } from './src/data/prefs';
import { deviceTzOffsetMs } from './src/domain/time';
import { seedDatabase, seedSyncFixtures } from './src/test/seed';
import { color, Text } from './src/ui';

function App() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // The cached session is read first: a returning user never sees the
        // sign-in form, because the local database does not need the network.
        const session = getSession();
        store.dispatch(
          sessionRestored(
            session
              ? {
                  email: session.email,
                  name: session.name,
                  onboarded: session.onboarded,
                }
              : null,
          ),
        );

        const db = await openDatabase();
        if (__DEV__) {
          const now = Date.now();
          await seedDatabase(db, now, deviceTzOffsetMs());
          await seedSyncFixtures(db, now, deviceTzOffsetMs());
        }
      } catch (e) {
        store.dispatch(sessionRestored(null));
        setError(String((e as Error)?.message ?? e));
      } finally {
        await BootSplash.hide({ fade: true });
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={styles.error}>
        <Text variant="title">Could not open the database</Text>
        <Text variant="body" color="textMuted">{error}</Text>
      </View>
    );
  }

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <Navigation />
      </SafeAreaProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  error: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 24, backgroundColor: color.paper,
  },
});

export default App;
