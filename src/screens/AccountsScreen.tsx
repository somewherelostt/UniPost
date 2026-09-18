import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { PLATFORM_LABELS, PLATFORMS, PLATFORMS_NOT_YET_AVAILABLE, type ConnectablePlatform } from '../types';
import { color, radius, space, touchTarget, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';

type ConnectionRecord = {
  platform: ConnectablePlatform;
  accounts: { label: string; connected: boolean }[];
};

// Every platform this screen manages: every Platform except Bluesky (authenticates via a static
// handle + app password already in Convex env vars, never a linked account to connect/disconnect)
// and anything still listed as not-yet-available (no working connect path to offer at all).
const MANAGED_PLATFORMS = PLATFORMS.filter(
  (platform): platform is ConnectablePlatform =>
    platform !== 'bluesky' && !PLATFORMS_NOT_YET_AVAILABLE.includes(platform)
);

export default function AccountsScreen() {
  const platformStatus = useQuery(api.queries.getPlatformStatus);
  const [connections, setConnections] = useState<ConnectionRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<ConnectablePlatform | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<ConnectablePlatform | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ConnectablePlatform | null>(null);
  const [confirmDisconnectAll, setConfirmDisconnectAll] = useState(false);
  const [disconnectingAll, setDisconnectingAll] = useState(false);

  const listConnections = useAction(api.connections.listConnections);
  const getConnectUrl = useAction(api.connections.getPlatformConnectUrl);
  const disconnectPlatform = useAction(api.connections.disconnectPlatform);
  const disconnectAllPlatforms = useAction(api.connections.disconnectAllPlatforms);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConnections(await listConnections({}));
    } catch {
      setError('Could not load your accounts. Try again.');
    } finally {
      setLoading(false);
    }
  }, [listConnections]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function isConnected(platform: ConnectablePlatform): boolean {
    return connections?.find((entry) => entry.platform === platform)?.accounts.some((a) => a.connected) ?? false;
  }

  function connectionLabel(platform: ConnectablePlatform): string | undefined {
    return connections?.find((entry) => entry.platform === platform)?.accounts.find((account) => account.connected)?.label;
  }

  async function handleConnect(platform: ConnectablePlatform) {
    setError(null);
    setConnectingPlatform(platform);
    try {
      const { url, error: connectError } = await getConnectUrl({ platform });
      if (connectError || !url) {
        setError(connectError ?? `Could not start the ${PLATFORM_LABELS[platform]} connection.`);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not connect ${PLATFORM_LABELS[platform]}.`);
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function handleDisconnect(platform: ConnectablePlatform) {
    setError(null);
    setConfirmDisconnect(null);
    setDisconnectingPlatform(platform);
    try {
      const { success, error: disconnectError } = await disconnectPlatform({ platform });
      if (!success) {
        setError(disconnectError ?? `Could not disconnect ${PLATFORM_LABELS[platform]}.`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not disconnect ${PLATFORM_LABELS[platform]}.`);
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  async function handleDisconnectAll() {
    setError(null);
    setConfirmDisconnectAll(false);
    setDisconnectingAll(true);
    try {
      const { success, errors } = await disconnectAllPlatforms({});
      if (!success) {
        setError(errors[0] ?? 'Could not disconnect every account.');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect every account.');
    } finally {
      setDisconnectingAll(false);
    }
  }

  const anyConnected = MANAGED_PLATFORMS.some(isConnected);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View>
        <Text style={styles.title}>Accounts</Text>
        <Text style={styles.subtitle}>Connect the platforms you publish to.</Text>
      </View>

      {anyConnected ? (
        confirmDisconnectAll ? (
          <View style={styles.confirmBlock}>
            <Text style={styles.confirmText}>Disconnect every connected account?</Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setConfirmDisconnectAll(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.dangerButton}
                onPress={handleDisconnectAll}
                disabled={disconnectingAll}
                android_ripple={{ color: color.onError }}
              >
                {disconnectingAll ? (
                  <ActivityIndicator color={color.onError} />
                ) : (
                  <Text style={styles.dangerButtonText}>Disconnect all</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.disconnectAllButton}
            onPress={() => setConfirmDisconnectAll(true)}
            android_ripple={{ color: color.outline }}
          >
            <MaterialCommunityIcons name="link-off" size={16} color={color.error} />
            <Text style={styles.disconnectAllButtonText}>Disconnect all</Text>
          </Pressable>
        )
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={color.onErrorContainer} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.list}>
        <View style={styles.row}>
          <View style={styles.rowInfo}>
            <PlatformBadge platform="bluesky" size={28} />
            <View>
              <Text style={styles.rowLabel}>Bluesky</Text>
              <Text style={[styles.rowStatus, platformStatus?.bluesky && styles.rowStatusConnected]}>
                {platformStatus === undefined ? 'Checking…' : platformStatus.bluesky ? 'Configured on server · Live' : 'Add handle and app password on the server'}
              </Text>
            </View>
          </View>
          <View style={[styles.healthBadge, platformStatus?.bluesky && styles.healthBadgeLive]}>
            <Text style={[styles.healthBadgeText, platformStatus?.bluesky && styles.healthBadgeTextLive]}>
              {platformStatus?.bluesky ? 'Live' : 'Setup'}
            </Text>
          </View>
        </View>

        {MANAGED_PLATFORMS.map((platform) => {
          const connected = isConnected(platform);
          const connecting = connectingPlatform === platform;
          const disconnecting = disconnectingPlatform === platform;
          const confirming = confirmDisconnect === platform;
          const label = connectionLabel(platform);
          const statusLabel = loading && connections === null
            ? 'Checking…'
            : connected
              ? `${label ?? 'Connected'} · checked just now`
              : platform === 'instagram'
                ? 'Business or Creator account required'
                : 'Not connected';

          return (
            <View key={platform} style={styles.row}>
              <View style={styles.rowInfo}>
                <PlatformBadge platform={platform} size={28} />
                <View>
                  <Text style={styles.rowLabel}>{PLATFORM_LABELS[platform]}</Text>
                  <Text style={[styles.rowStatus, connected && styles.rowStatusConnected]}>{statusLabel}</Text>
                </View>
              </View>

              {confirming ? (
                <View style={styles.confirmActions}>
                  <Pressable style={styles.secondaryButton} onPress={() => setConfirmDisconnect(null)}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.dangerButton}
                    onPress={() => handleDisconnect(platform)}
                    disabled={disconnecting}
                    android_ripple={{ color: color.onError }}
                  >
                    {disconnecting ? (
                      <ActivityIndicator color={color.onError} />
                    ) : (
                      <Text style={styles.dangerButtonText}>Confirm</Text>
                    )}
                  </Pressable>
                </View>
              ) : connected ? (
                <Pressable
                  style={styles.rowActionButton}
                  onPress={() => setConfirmDisconnect(platform)}
                  disabled={disconnecting}
                  android_ripple={{ color: color.outline }}
                >
                  <Text style={styles.rowActionButtonText}>Disconnect</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.connectButton}
                  onPress={() => handleConnect(platform)}
                  disabled={connecting}
                  android_ripple={{ color: color.onPrimary }}
                >
                  {connecting ? (
                    <ActivityIndicator size="small" color={color.onPrimary} />
                  ) : (
                    <Text style={styles.connectButtonText}>Connect</Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
        <View style={[styles.row, styles.unavailableRow]}>
          <View style={styles.rowInfo}>
            <PlatformBadge platform="threads" size={28} />
            <View>
              <Text style={styles.rowLabel}>Threads</Text>
              <Text style={styles.rowStatus}>No publishing connection is available yet</Text>
            </View>
          </View>
          <View style={styles.unavailableBadge}><Text style={styles.unavailableBadgeText}>Unavailable</Text></View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingTop: space.xl, gap: space.lg, paddingBottom: space.xxxl },
  title: { ...type.headlineSmall, color: color.onBackground },
  subtitle: { ...type.bodyMedium, color: color.onSurfaceVariant, marginTop: 2 },
  disconnectAllButton: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.error,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  disconnectAllButtonText: { ...type.labelLarge, color: color.error, textTransform: 'none' },
  confirmBlock: {
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.error,
    borderRadius: radius.md,
    padding: space.md,
  },
  confirmText: { ...type.bodyMedium, color: color.onSurface },
  confirmActions: { flexDirection: 'row', gap: space.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.errorContainer,
    borderRadius: radius.sm,
    padding: space.md,
  },
  errorText: { ...type.bodyMedium, color: color.onErrorContainer, flex: 1 },
  list: { borderTopWidth: 1, borderTopColor: color.outlineFaint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.outlineFaint,
    backgroundColor: color.background,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
  },
  rowInfo: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1 },
  rowLabel: { ...type.titleMedium, color: color.onSurface },
  rowStatus: { ...type.bodyMedium, color: color.onSurfaceFaint },
  rowStatusConnected: { color: color.success },
  healthBadge: { borderRadius: radius.pill, backgroundColor: color.surfaceRaised, paddingVertical: 4, paddingHorizontal: space.sm },
  healthBadgeLive: { backgroundColor: color.successContainer },
  healthBadgeText: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'uppercase' },
  healthBadgeTextLive: { color: color.success },
  unavailableRow: { opacity: 0.6 },
  unavailableBadge: { borderRadius: radius.pill, backgroundColor: color.surfaceRaised, paddingVertical: 4, paddingHorizontal: space.sm },
  unavailableBadgeText: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'uppercase' },
  rowActionButton: {
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActionButtonText: { ...type.labelLarge, color: color.onSurfaceVariant, textTransform: 'none' },
  connectButton: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectButtonText: { ...type.labelLarge, color: color.onPrimary, textTransform: 'none' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { ...type.labelLarge, color: color.onSurfaceVariant, textTransform: 'none' },
  dangerButton: {
    backgroundColor: color.error,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: { ...type.labelLarge, color: color.onError, textTransform: 'none' },
});
