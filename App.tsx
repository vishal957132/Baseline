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

import { ErrorBoundary } from './src/app/ErrorBoundary';
import { Navigation } from './src/app/navigation';
import { store } from './src/app/store';
import { sessionRestored } from './src/app/store/authSlice';
import { ensureDemoData } from './src/app/demoData';
import { startSync, stopSync } from './src/app/syncService';
import { openDatabase } from './src/data/db';
import { getSession } from './src/data/prefs';
import { color, Text } from './src/ui';

function App() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Read the cached session up front — it is a synchronous local read —
        // but hold the dispatch until the database is open. Auth status is what
        // gates the navigator, so dispatching here would let the dashboard
        // mount and query a database that does not exist yet: every card would
        // report "could not refresh" on a cold start and only recover on retry.
        const session = getSession();

        await openDatabase();
        await ensureDemoData(session?.email ?? null);

        // The queue exists from the moment the database is open, so the engine
        // starts here rather than on a screen — changes sync whether or not
        // anyone is looking at the Sync tab.
        startSync(store.dispatch);

        // Now the data layer is ready, let the tree render.
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
      } catch (e) {
        store.dispatch(sessionRestored(null));
        setError(String((e as Error)?.message ?? e));
      } finally {
        await BootSplash.hide({ fade: true });
      }
    })();

    return stopSync;
  }, []);

  if (error) {
    return (
      <View style={styles.error}>
        <Text variant="title">Could not start</Text>
        <Text variant="body" color="textMuted">{error}</Text>
      </View>
    );
  }

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <ErrorBoundary>
          <Navigation />
        </ErrorBoundary>
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
