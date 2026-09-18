import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PLATFORM_LABELS } from '../types';
import type { Platform, PlatformPostStatus } from '../types';
import { color, radius, space, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';

const ICON_SIZE = 30;
const ROW_GAP = space.md;

interface TimelineEvent {
  _id: Id<'platformPosts'>;
  postId: Id<'posts'>;
  platform: Platform;
  status: PlatformPostStatus;
  url?: string;
  error?: string;
  scheduledFor?: number;
  brief: string;
  timestamp: number;
}

// "Scheduled for Aug 31, 6:00 PM" — matches the format PLAN-scheduling.md calls out by example.
function formatScheduledFor(epochMs: number): string {
  const formatted = new Date(epochMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Scheduled for ${formatted}`;
}

function absoluteDate(epochMs: number): string {
  const date = new Date(epochMs);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

// Relative within the last 7 days ("Just now" / "3h ago" / "2d ago"), an absolute short date
// beyond that. A scheduled event's timestamp can sit in the future (scheduledFor), which "N ago"
// can't describe honestly — those always fall back to the absolute date instead.
function formatEventTimestamp(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  if (diffMs < 0) return absoluteDate(epochMs);

  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'Just now';
  if (diffHour < 1) return `${diffMin}m ago`;
  if (diffDay < 1) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return absoluteDate(epochMs);
}

// Verb per status, matching the reference's varied-verb descriptions ("imported" / "met with" /
// "emailed"). Platform name is the bolded segment, standing in for the reference's bolded actor.
function descriptionSegments(status: PlatformPostStatus, platformLabel: string): { text: string; bold: boolean }[] {
  switch (status) {
    case 'draft':
      return [{ text: 'Draft for ', bold: false }, { text: platformLabel, bold: true }];
    case 'approved':
      return [{ text: 'Approved for ', bold: false }, { text: platformLabel, bold: true }];
    case 'scheduled':
      return [{ text: 'Scheduled for ', bold: false }, { text: platformLabel, bold: true }];
    case 'publishing':
      return [{ text: 'Publishing to ', bold: false }, { text: platformLabel, bold: true }];
    case 'published':
      return [{ text: 'Published to ', bold: false }, { text: platformLabel, bold: true }];
    case 'failed':
      return [{ text: platformLabel, bold: true }, { text: ' post failed', bold: false }];
  }
}

interface HistoryScreenProps {
  onEdit: (postId: Id<'posts'>, platforms: Platform[]) => void;
}

type HistoryFilter = 'all' | 'published' | 'failed';

export default function HistoryScreen({ onEdit }: HistoryScreenProps) {
  const events = useQuery(api.queries.listTimelineEvents) as TimelineEvent[] | undefined;
  const publishPost = useAction(api.publishPost.publishPost);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [retryingId, setRetryingId] = useState<Id<'platformPosts'> | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (events === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  const historyEvents = events.filter(
    (event) => event.status !== 'scheduled' && (filter === 'all' || event.status === filter)
  );

  async function handleRetry(event: TimelineEvent) {
    setRetryError(null);
    setRetryingId(event._id);
    try {
      await publishPost({ postId: event.postId, platforms: [event.platform] });
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Could not retry this post.');
    } finally {
      setRetryingId(null);
    }
  }

  if (events.filter((event) => event.status !== 'scheduled').length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.emptyContainer}>
        <Text style={styles.title}>History</Text>
        <View style={styles.centered}>
          <MaterialCommunityIcons name="history" size={36} color={color.onSurfaceFaint} />
          <Text style={styles.emptyTitle}>Nothing published yet</Text>
          <Text style={styles.emptyText}>Your first published post will appear here.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>History</Text>
      <View style={styles.filterRow}>
        {(['all', 'published', 'failed'] as HistoryFilter[]).map((item) => (
          <Pressable
            key={item}
            style={[styles.filterChip, filter === item && styles.filterChipActive]}
            onPress={() => setFilter(item)}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {item[0].toUpperCase() + item.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
      {retryError ? <View style={styles.errorBanner}><Text style={styles.errorText}>{retryError}</Text></View> : null}
      {historyEvents.length === 0 ? (
        <View style={styles.filteredEmpty}><Text style={styles.emptyText}>No {filter} posts yet.</Text></View>
      ) : null}
      <View>
        {historyEvents.map((ev, index) => {
          const isFirst = index === 0;
          const isLast = index === historyEvents.length - 1;
          const platformLabel = PLATFORM_LABELS[ev.platform];

          return (
            <View key={ev._id} style={[styles.row, !isLast && { marginBottom: ROW_GAP }]}>
              <View style={styles.iconColumn}>
                {!isFirst && <View style={[styles.line, styles.lineAboveIcon]} />}
                <PlatformBadge platform={ev.platform} size={ICON_SIZE} />
                {!isLast && <View style={[styles.line, styles.lineBelowIcon]} />}
              </View>

              <View style={styles.content}>
                <View style={styles.descriptionRow}>
                  <Text style={styles.description} numberOfLines={1}>
                    {descriptionSegments(ev.status, platformLabel).map((seg, i) => (
                      <Text key={i} style={seg.bold ? styles.descriptionBold : undefined}>
                        {seg.text}
                      </Text>
                    ))}
                  </Text>
                  <Text style={styles.timestamp}>{formatEventTimestamp(ev.timestamp)}</Text>
                </View>

                <Text style={styles.brief} numberOfLines={1}>
                  {ev.brief}
                </Text>

                {ev.status === 'failed' && ev.error && (
                  <View style={styles.failureBlock}>
                    <Text style={styles.detailText}>{ev.error}</Text>
                    <View style={styles.failureActions}>
                      <Pressable
                        style={styles.retryButton}
                        onPress={() => handleRetry(ev)}
                        disabled={retryingId === ev._id}
                      >
                        {retryingId === ev._id ? (
                          <ActivityIndicator size="small" color={color.onPrimary} />
                        ) : (
                          <><MaterialCommunityIcons name="refresh" size={14} color={color.onPrimary} /><Text style={styles.retryText}>Retry</Text></>
                        )}
                      </Pressable>
                      <Pressable style={styles.editButton} onPress={() => onEdit(ev.postId, [ev.platform])}>
                        <MaterialCommunityIcons name="pencil-outline" size={14} color={color.onSurfaceVariant} />
                        <Text style={styles.editText}>Edit draft</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {ev.status === 'published' && ev.url && (
                  <Pressable
                    style={styles.viewPostButton}
                    onPress={() => Linking.openURL(ev.url!)}
                    hitSlop={{ top: 8, bottom: 8 }}
                    android_ripple={{ color: color.onPrimaryContainer }}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={13} color={color.onPrimaryContainer} />
                    <Text style={styles.viewPostButtonText}>View post</Text>
                  </Pressable>
                )}

              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, paddingTop: space.xxl, paddingBottom: space.xxxl },
  emptyContainer: { flexGrow: 1, padding: space.xl, paddingTop: space.xxl, paddingBottom: space.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  emptyTitle: { ...type.titleMedium, color: color.onSurface },
  emptyText: { ...type.bodyMedium, color: color.onSurfaceFaint },
  title: { ...type.headlineSmall, color: color.onBackground, marginBottom: space.lg },
  filterRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  filterChip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: color.surface },
  filterChipActive: { backgroundColor: color.primaryContainer },
  filterText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  filterTextActive: { color: color.onPrimaryContainer },
  filteredEmpty: { padding: space.xxl, alignItems: 'center' },
  errorBanner: { backgroundColor: color.errorContainer, borderRadius: radius.sm, padding: space.md, marginBottom: space.lg },
  errorText: { ...type.bodyMedium, color: color.onErrorContainer },

  row: { flexDirection: 'row' },
  iconColumn: { width: ICON_SIZE, alignItems: 'center' },
  // Fixed-height segment exactly matching ROW_GAP so it bridges flush from the previous row's
  // trailing line into this row's icon, keeping the line visually continuous across rows despite
  // each row owning only its own top/bottom half.
  lineAboveIcon: { height: ROW_GAP },
  lineBelowIcon: { flex: 1 },
  line: { width: 2, backgroundColor: color.outline },

  content: { flex: 1, marginLeft: space.md, gap: 2 },
  descriptionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  description: { ...type.bodyMedium, color: color.onSurfaceVariant, flex: 1 },
  descriptionBold: { color: color.onSurface, fontWeight: '700' },
  timestamp: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },
  brief: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },

  detailText: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },
  failureBlock: { gap: space.sm, marginTop: space.xs },
  failureActions: { flexDirection: 'row', gap: space.sm },
  retryButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.primary, borderRadius: radius.sm, paddingHorizontal: space.md },
  retryText: { ...type.labelMedium, color: color.onPrimary, textTransform: 'none' },
  editButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: space.md },
  editText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  viewPostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    backgroundColor: color.primaryContainer,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    marginTop: 2,
  },
  viewPostButtonText: { ...type.labelSmall, color: color.onPrimaryContainer, textTransform: 'none' },
  scheduledRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  // Neutral outline, not error tokens: cancelling a schedule is a deliberate user action, not a
  // failure state — reusing color.error here would read as if something had gone wrong.
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
  },
  cancelButtonText: { ...type.labelSmall, color: color.onSurfaceVariant, textTransform: 'none' },
});
