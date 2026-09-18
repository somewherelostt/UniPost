import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PLATFORM_LABELS } from '../types';
import type { MetricsPlatform } from '../types';
import { color, radius, space, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';

interface PlatformSummary {
  platform: MetricsPlatform;
  postCount: number;
  totalLikes: number;
  totalReposts: number;
  totalComments: number;
  totalViews: number;
}

interface PostMetricsRow {
  platformPostId: Id<'platformPosts'>;
  postId: Id<'posts'>;
  platform: MetricsPlatform;
  brief: string;
  url?: string;
  publishedAt?: number;
  likes?: number;
  reposts?: number;
  comments?: number;
  views?: number;
  fetchedAt?: number;
}

interface AnalyticsSummary {
  byPlatform: PlatformSummary[];
  posts: PostMetricsRow[];
}

function formatCount(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatDate(epochMs: number | undefined): string {
  if (epochMs === undefined) return '';
  return new Date(epochMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AnalyticsScreen() {
  const summary = useQuery(api.queries.getAnalyticsSummary) as AnalyticsSummary | undefined;
  const refreshPostMetrics = useAction(api.analytics.refreshPostMetrics);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshNote, setLastRefreshNote] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<7 | 28 | 90>(7);
  const [sortBy, setSortBy] = useState<'recent' | 'likes' | 'views'>('recent');

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    setLastRefreshNote(null);
    try {
      const result = await refreshPostMetrics({});
      setLastRefreshNote(
        `Updated ${result.updated} post${result.updated === 1 ? '' : 's'}${
          result.failed > 0 ? `, ${result.failed} failed` : ''
        }`
      );
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Could not refresh analytics.');
    } finally {
      setRefreshing(false);
    }
  }

  if (summary === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const rangePosts = summary.posts.filter((row) => (row.publishedAt ?? 0) >= cutoff);
  const sortedPosts = [...rangePosts].sort((a, b) => {
    if (sortBy === 'likes') return (b.likes ?? 0) - (a.likes ?? 0);
    if (sortBy === 'views') return (b.views ?? 0) - (a.views ?? 0);
    return (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  });
  const rangeSummaries = (['bluesky', 'facebook'] as MetricsPlatform[]).map((platform) => {
    const rows = rangePosts.filter((row) => row.platform === platform);
    return {
      platform,
      postCount: rows.length,
      totalLikes: rows.reduce((sum, row) => sum + (row.likes ?? 0), 0),
      totalReposts: rows.reduce((sum, row) => sum + (row.reposts ?? 0), 0),
      totalComments: rows.reduce((sum, row) => sum + (row.comments ?? 0), 0),
      totalViews: rows.reduce((sum, row) => sum + (row.views ?? 0), 0),
    };
  }).filter((entry) => entry.postCount > 0);
  const latestFetch = rangePosts.reduce((latest, row) => Math.max(latest, row.fetchedAt ?? 0), 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>Real engagement for your published posts.</Text>
        </View>
        <Pressable
          style={styles.refreshButton}
          onPress={handleRefresh}
          disabled={refreshing}
          android_ripple={{ color: color.onPrimary }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={color.onPrimary} />
          ) : (
            <>
              <MaterialCommunityIcons name="refresh" size={16} color={color.onPrimary} />
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </>
          )}
        </Pressable>
      </View>

      {refreshError ? (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={color.onErrorContainer} />
          <Text style={styles.errorText}>{refreshError}</Text>
        </View>
      ) : lastRefreshNote ? (
        <Text style={styles.refreshNote}>{lastRefreshNote}</Text>
      ) : null}

      <View style={styles.rangeRow}>
        {[7, 28, 90].map((days) => (
          <Pressable
            key={days}
            style={[styles.rangeChip, rangeDays === days && styles.rangeChipActive]}
            onPress={() => setRangeDays(days as 7 | 28 | 90)}
          >
            <Text style={[styles.rangeText, rangeDays === days && styles.rangeTextActive]}>{days} days</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.noticeBox}>
        <MaterialCommunityIcons name="information-outline" size={16} color={color.onSurfaceVariant} />
        <Text style={styles.noticeText}>
          Metrics are only available for Bluesky and Facebook right now — LinkedIn, YouTube,
          Instagram, Pinterest, and X don't expose reliable per-post analytics through this app's
          current setup.
        </Text>
      </View>

      {rangeSummaries.length === 0 ? (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="chart-line" size={36} color={color.onSurfaceFaint} />
          <Text style={styles.emptyText}>
            No measurable posts yet. Publish to Bluesky or Facebook, then tap Refresh.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryRow}>
            {rangeSummaries.map((entry) => (
              <View key={entry.platform} style={styles.summaryCard}>
                <View style={styles.summaryCardHeader}>
                  <PlatformBadge platform={entry.platform} size={24} />
                  <Text style={styles.summaryCardLabel}>{PLATFORM_LABELS[entry.platform]}</Text>
                </View>
                <Text style={styles.summaryCardBig}>{formatCount(entry.totalLikes)}</Text>
                <Text style={styles.summaryCardCaption}>likes</Text>
                <View style={styles.summaryCardStatsRow}>
                  {entry.totalReposts > 0 && (
                    <Text style={styles.summaryCardStat}>{formatCount(entry.totalReposts)} reposts</Text>
                  )}
                  {entry.totalComments > 0 && (
                    <Text style={styles.summaryCardStat}>{formatCount(entry.totalComments)} comments</Text>
                  )}
                  {entry.totalViews > 0 && (
                    <Text style={styles.summaryCardStat}>{formatCount(entry.totalViews)} views</Text>
                  )}
                </View>
                <Text style={styles.summaryCardPostCount}>
                  {entry.postCount} post{entry.postCount === 1 ? '' : 's'}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.asOfText}>
            Last {rangeDays} days{latestFetch > 0 ? ` · as of ${new Date(latestFetch).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
          </Text>

          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>By post</Text>
            <View style={styles.sortRow}>
              {(['recent', 'likes', 'views'] as const).map((sort) => (
                <Pressable key={sort} onPress={() => setSortBy(sort)} style={[styles.sortButton, sortBy === sort && styles.sortButtonActive]}>
                  <Text style={[styles.sortText, sortBy === sort && styles.sortTextActive]}>{sort}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.list}>
            {sortedPosts.map((row) => (
              <View key={row.platformPostId} style={styles.postRow}>
                <PlatformBadge platform={row.platform} size={28} />
                <View style={styles.postRowContent}>
                  <Text style={styles.postBrief} numberOfLines={1}>
                    {row.brief || 'Untitled post'}
                  </Text>
                  <View style={styles.postStatsRow}>
                    <Text style={styles.postStat}>{formatCount(row.likes)} likes</Text>
                    {row.reposts !== undefined && (
                      <Text style={styles.postStat}>{formatCount(row.reposts)} reposts</Text>
                    )}
                    {row.comments !== undefined && (
                      <Text style={styles.postStat}>{formatCount(row.comments)} comments</Text>
                    )}
                    {row.views !== undefined && (
                      <Text style={styles.postStat}>{formatCount(row.views)} views</Text>
                    )}
                    {row.publishedAt !== undefined && (
                      <Text style={styles.postDate}>{formatDate(row.publishedAt)}</Text>
                    )}
                  </View>
                </View>
                {row.url ? (
                  <Pressable
                    onPress={() => Linking.openURL(row.url!)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={16} color={color.onSurfaceFaint} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, paddingTop: space.xxl, paddingBottom: space.xxxl, gap: space.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  emptyText: { ...type.bodyMedium, color: color.onSurfaceFaint, textAlign: 'center' },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { ...type.headlineSmall, color: color.onBackground },
  subtitle: { ...type.bodyMedium, color: color.onSurfaceVariant, marginTop: 2 },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  refreshButtonText: { ...type.labelLarge, color: color.onPrimary, textTransform: 'none' },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.errorContainer,
    borderRadius: radius.sm,
    padding: space.md,
  },
  errorText: { ...type.bodyMedium, color: color.onErrorContainer, flex: 1 },
  refreshNote: { ...type.bodyMedium, color: color.onSurfaceVariant },
  rangeRow: { flexDirection: 'row', gap: space.sm },
  rangeChip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: color.surface },
  rangeChipActive: { backgroundColor: color.primaryContainer },
  rangeText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  rangeTextActive: { color: color.onPrimaryContainer },

  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.surfaceVariant,
    borderRadius: radius.sm,
    padding: space.md,
  },
  noticeText: { ...type.bodyMedium, color: color.onSurfaceVariant, flex: 1 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  summaryCard: {
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  summaryCardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  summaryCardLabel: { ...type.labelLarge, color: color.onSurface, textTransform: 'none' },
  summaryCardBig: { ...type.headlineSmall, color: color.onSurface },
  summaryCardCaption: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },
  summaryCardStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  summaryCardStat: { ...type.labelSmall, color: color.onSurfaceVariant, textTransform: 'none' },
  summaryCardPostCount: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none', marginTop: space.xs },
  asOfText: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },

  sectionTitle: { ...type.titleMedium, color: color.onSurface },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  sortRow: { flexDirection: 'row', gap: space.xs },
  sortButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: color.surface },
  sortButtonActive: { backgroundColor: color.surfaceRaised },
  sortText: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'capitalize' },
  sortTextActive: { color: color.onSurface },
  list: { gap: space.sm },
  postRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
  },
  postRowContent: { flex: 1, gap: 2 },
  postBrief: { ...type.bodyMedium, color: color.onSurface },
  postStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  postStat: { ...type.labelSmall, color: color.onSurfaceVariant, textTransform: 'none' },
  postDate: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },
});
