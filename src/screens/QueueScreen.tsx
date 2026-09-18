import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PLATFORM_LABELS, type Platform } from '../types';
import { color, radius, space, touchTarget, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';

interface QueueEvent {
  _id: Id<'platformPosts'>;
  postId: Id<'posts'>;
  platform: Platform;
  status: string;
  scheduledFor?: number;
  brief: string;
}

interface QueueScreenProps {
  onEdit: (postId: Id<'posts'>, platforms: Platform[]) => void;
}

function dayLabel(epochMs: number): string {
  const date = new Date(epochMs);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function relativeLabel(epochMs: number): string {
  const minutes = Math.max(0, Math.round((epochMs - Date.now()) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hr${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export default function QueueScreen({ onEdit }: QueueScreenProps) {
  const events = useQuery(api.queries.listTimelineEvents) as QueueEvent[] | undefined;
  const cancelSchedule = useMutation(api.schedulePost.cancelSchedule);
  const [confirmingId, setConfirmingId] = useState<Id<'platformPosts'> | null>(null);
  const [cancellingId, setCancellingId] = useState<Id<'platformPosts'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (events === undefined) {
    return <View style={styles.centered}><ActivityIndicator color={color.primary} /></View>;
  }

  const scheduled = events
    .filter((event) => event.status === 'scheduled' && event.scheduledFor !== undefined)
    .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));

  async function handleCancel(event: QueueEvent) {
    setError(null);
    setCancellingId(event._id);
    try {
      await cancelSchedule({ platformPostId: event._id });
      setConfirmingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel this scheduled post.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View>
        <Text style={styles.title}>Queue</Text>
        <Text style={styles.subtitle}>{scheduled.length} upcoming post{scheduled.length === 1 ? '' : 's'}</Text>
      </View>

      {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}

      {scheduled.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={38} color={color.onSurfaceFaint} />
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.emptyText}>Choose Schedule while reviewing a draft and it will appear here.</Text>
        </View>
      ) : (
        scheduled.map((event, index) => {
          const scheduledFor = event.scheduledFor as number;
          const showDay = index === 0 || dayLabel(scheduledFor) !== dayLabel(scheduled[index - 1].scheduledFor as number);
          const confirming = confirmingId === event._id;
          return (
            <View key={event._id}>
              {showDay ? <Text style={styles.dayLabel}>{dayLabel(scheduledFor)}</Text> : null}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <PlatformBadge platform={event.platform} size={30} />
                  <View style={styles.timeBlock}>
                    <Text style={styles.time}>{timeLabel(scheduledFor)}</Text>
                    <Text style={styles.relative}>{relativeLabel(scheduledFor)}</Text>
                  </View>
                  <View style={styles.queuedBadge}><Text style={styles.queuedBadgeText}>Queued</Text></View>
                </View>
                <Text style={styles.platform}>{PLATFORM_LABELS[event.platform]}</Text>
                <Text style={styles.brief} numberOfLines={2}>{event.brief || 'Untitled post'}</Text>
                {confirming ? (
                  <View style={styles.confirmRow}>
                    <Text style={styles.confirmText}>Cancel this scheduled post?</Text>
                    <Pressable style={styles.tertiaryButton} onPress={() => setConfirmingId(null)}><Text style={styles.tertiaryText}>Keep</Text></Pressable>
                    <Pressable style={styles.cancelConfirmButton} onPress={() => handleCancel(event)} disabled={cancellingId === event._id}>
                      {cancellingId === event._id ? <ActivityIndicator size="small" color={color.onError} /> : <Text style={styles.cancelConfirmText}>Cancel post</Text>}
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <Pressable style={styles.actionButton} onPress={() => onEdit(event.postId, [event.platform])}>
                      <MaterialCommunityIcons name="pencil-outline" size={15} color={color.onSurfaceVariant} />
                      <Text style={styles.actionText}>Edit</Text>
                    </Pressable>
                    <Pressable style={styles.actionButton} onPress={() => onEdit(event.postId, [event.platform])}>
                      <MaterialCommunityIcons name="calendar-edit" size={15} color={color.onSurfaceVariant} />
                      <Text style={styles.actionText}>Reschedule</Text>
                    </Pressable>
                    <Pressable style={styles.actionButton} onPress={() => setConfirmingId(event._id)}>
                      <MaterialCommunityIcons name="close" size={15} color={color.error} />
                      <Text style={[styles.actionText, { color: color.error }]}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.headlineSmall, color: color.onBackground },
  subtitle: { ...type.bodyMedium, color: color.onSurfaceVariant, marginTop: 2 },
  dayLabel: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'uppercase', marginTop: space.sm },
  card: { borderTopWidth: 1, borderTopColor: color.outlineFaint, paddingVertical: space.md, gap: space.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  timeBlock: { flex: 1 },
  time: { ...type.titleMedium, color: color.onSurface },
  relative: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },
  queuedBadge: { backgroundColor: color.primaryContainer, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 4 },
  queuedBadgeText: { ...type.labelSmall, color: color.onPrimaryContainer, textTransform: 'uppercase' },
  platform: { ...type.labelMedium, color: color.onSurfaceVariant },
  brief: { ...type.bodyMedium, color: color.onSurface },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  actionButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: color.surfaceRaised },
  actionText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  confirmText: { ...type.bodyMedium, color: color.onSurface, flexGrow: 1 },
  tertiaryButton: { minHeight: 40, paddingHorizontal: space.md, justifyContent: 'center' },
  tertiaryText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  cancelConfirmButton: { minHeight: 40, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: color.error },
  cancelConfirmText: { ...type.labelMedium, color: color.onError, textTransform: 'none' },
  emptyState: { alignItems: 'center', padding: space.xxxl, gap: space.sm },
  emptyTitle: { ...type.titleMedium, color: color.onSurface },
  emptyText: { ...type.bodyMedium, color: color.onSurfaceVariant, textAlign: 'center' },
  errorBanner: { backgroundColor: color.errorContainer, borderRadius: radius.sm, padding: space.md },
  errorText: { ...type.bodyMedium, color: color.onErrorContainer },
});
