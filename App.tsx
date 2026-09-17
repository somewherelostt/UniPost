import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import ComposeScreen from './src/screens/ComposeScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import type { Id } from './convex/_generated/dataModel';
import type { Platform } from './src/types';
import { color, space, touchTarget, type } from './src/theme';

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL as string);

type Screen = 'compose' | 'review' | 'history' | 'accounts' | 'analytics';

// 'chart-line' confirmed present in the installed MaterialCommunityIcons glyph map
// (node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json),
// same verification discipline every other icon choice in TABS already follows.
const TABS: { key: Screen; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: 'compose', label: 'Compose', icon: 'pencil-box-outline' },
  { key: 'review', label: 'Review', icon: 'text-box-check-outline' },
  { key: 'history', label: 'History', icon: 'clock-outline' },
  { key: 'analytics', label: 'Analytics', icon: 'chart-line' },
  { key: 'accounts', label: 'Accounts', icon: 'account-multiple-outline' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('compose');
  const [activePostId, setActivePostId] = useState<Id<'posts'> | null>(null);
  const [activePlatforms, setActivePlatforms] = useState<Platform[]>([]);

  function handleGenerated(postId: Id<'posts'>, platforms: Platform[]) {
    setActivePostId(postId);
    setActivePlatforms(platforms);
    setScreen('review');
  }

  function handlePublished() {
    setScreen('history');
  }

  return (
    <ConvexProvider client={convex}>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.content}>
          {screen === 'compose' && <ComposeScreen onGenerated={handleGenerated} />}
          {screen === 'review' &&
            (activePostId ? (
              <ReviewScreen postId={activePostId} platforms={activePlatforms} onPublished={handlePublished} />
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="text-box-search-outline" size={40} color={color.onSurfaceFaint} />
                <Text style={styles.emptyStateText}>No draft yet. Generate one from Compose first.</Text>
              </View>
            ))}
          {screen === 'history' && <HistoryScreen />}
          {screen === 'analytics' && <AnalyticsScreen />}
          {screen === 'accounts' && <AccountsScreen />}
        </View>

        <View style={styles.navBar}>
          {TABS.map((tab) => {
            const isActive = screen === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={styles.navItem}
                onPress={() => setScreen(tab.key)}
                android_ripple={{ color: color.surfaceVariant, borderless: true }}
              >
                <View style={[styles.navIconWrap, isActive && styles.navIconWrapActive]}>
                  <MaterialCommunityIcons
                    name={tab.icon}
                    size={22}
                    color={isActive ? color.onPrimaryContainer : color.onSurfaceVariant}
                  />
                </View>
                <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </ConvexProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.background,
  },
  content: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.outlineFaint,
    backgroundColor: color.surface,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    minHeight: touchTarget,
  },
  navIconWrap: {
    width: 56,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconWrapActive: {
    backgroundColor: color.primaryContainer,
  },
  navLabel: {
    ...type.labelSmall,
    color: color.onSurfaceVariant,
    textTransform: 'none',
  },
  navLabelActive: {
    color: color.onSurface,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.md,
  },
  emptyStateText: {
    ...type.bodyMedium,
    color: color.onSurfaceFaint,
    textAlign: 'center',
  },
});
