import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Platform as RNPlatform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { checkSlop } from '../../convex/checkSlop';
import type { Id } from '../../convex/_generated/dataModel';
import { PLATFORM_LABELS, PLATFORMS_ALLOWING_HASHTAGS, type Platform, type PlatformPost } from '../types';
import { color, radius, space, touchTarget, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';
import StatusPill from '../components/StatusPill';

interface ReviewScreenProps {
  postId: Id<'posts'>;
  platforms: Platform[];
  onPublished: () => void;
}

// Per-card publish mode. Absence of a key in the `mode` map below means 'now' — every card
// starts there, matching the screen's pre-scheduling behavior when the user never touches the
// toggle. One mechanism (a chosen time per card, in this map) covers every scheduling shape the
// product needs: all platforms, one platform, a subset, or different times per platform — see
// PLAN-scheduling.md.
type PublishMode = 'now' | 'schedule';

const DEFAULT_SCHEDULE_LEAD_MS = 60 * 60 * 1000; // seed the picker an hour out — just a starting point, not a constraint

function formatScheduledFor(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ReviewScreen({ postId, platforms, onPublished }: ReviewScreenProps) {
  const post = useQuery(api.queries.getPost, { postId });
  const generatePost = useAction(api.generatePost.generatePost);
  const updatePlatformPost = useMutation(api.queries.updatePlatformPost);
  const publishPost = useAction(api.publishPost.publishPost);
  const schedulePlatformPosts = useMutation(api.schedulePost.schedulePlatformPosts);

  const [editedText, setEditedText] = useState<Record<string, string>>({});
  const [editedTitle, setEditedTitle] = useState<Record<string, string>>({});
  const [regeneratingId, setRegeneratingId] = useState<Id<'platformPosts'> | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Record<string, PublishMode>>({});
  const [scheduledTime, setScheduledTime] = useState<Record<string, number>>({});
  const [iosPickerFor, setIosPickerFor] = useState<Id<'platformPosts'> | null>(null);

  useEffect(() => {
    if (!post) return;
    setEditedText((prev) => {
      const next = { ...prev };
      for (const pp of post.platformPosts) {
        if (!(pp._id in next)) next[pp._id] = pp.finalText;
      }
      return next;
    });
    setEditedTitle((prev) => {
      const next = { ...prev };
      for (const pp of post.platformPosts) {
        if (pp.youtubeTitle !== undefined && !(pp._id in next)) next[pp._id] = pp.youtubeTitle;
      }
      return next;
    });
  }, [post]);

  if (post === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (post === null) {
    return (
      <View style={styles.centered}>
        <MaterialCommunityIcons name="file-question-outline" size={36} color={color.onSurfaceFaint} />
        <Text style={styles.emptyText}>Draft not found.</Text>
      </View>
    );
  }

  const orderedPlatformPosts = [...post.platformPosts].sort(
    (a, b) => platforms.indexOf(a.platform) - platforms.indexOf(b.platform)
  );

  function modeFor(platformPostId: string): PublishMode {
    return mode[platformPostId] ?? 'now';
  }

  function openTimePicker(platformPostId: Id<'platformPosts'>) {
    const seed = scheduledTime[platformPostId] ?? Date.now() + DEFAULT_SCHEDULE_LEAD_MS;

    if (RNPlatform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: new Date(seed),
        mode: 'date',
        minimumDate: new Date(),
        onChange: (dateEvent, selectedDate) => {
          if (dateEvent.type !== 'set' || !selectedDate) return;
          DateTimePickerAndroid.open({
            value: selectedDate,
            mode: 'time',
            onChange: (timeEvent, selectedTime) => {
              if (timeEvent.type !== 'set' || !selectedTime) return;
              const combined = new Date(selectedDate);
              combined.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
              setScheduledTime((prev) => ({ ...prev, [platformPostId]: combined.getTime() }));
            },
          });
        },
      });
      return;
    }

    setIosPickerFor((prev) => (prev === platformPostId ? null : platformPostId));
  }

  // The single control that satisfies "same time for several platforms" (set one card's time,
  // then apply it to every other card currently in Schedule mode) without a separate bulk-mode
  // UI — untouched cards, and cards left in "Publish now", are unaffected.
  function applyTimeToAll(sourcePlatformPostId: Id<'platformPosts'>) {
    const sourceTime = scheduledTime[sourcePlatformPostId];
    if (sourceTime === undefined) return;
    setScheduledTime((prev) => {
      const next = { ...prev };
      for (const pp of orderedPlatformPosts) {
        if (modeFor(pp._id) === 'schedule') next[pp._id] = sourceTime;
      }
      return next;
    });
  }

  async function handleRegenerate(pp: PlatformPost) {
    setError(null);
    setRegeneratingId(pp._id);
    try {
      const avoid = pp.slopFindings.map((finding) => finding.quote);
      const { generatedText, youtubeTitle } = await generatePost({
        brief: post!.brief,
        platform: pp.platform,
        avoid,
      });
      const { cleanedText, findings } = checkSlop(
        generatedText,
        PLATFORMS_ALLOWING_HASHTAGS.includes(pp.platform)
      );
      await updatePlatformPost({
        platformPostId: pp._id,
        generatedText,
        finalText: cleanedText,
        youtubeTitle,
        slopFindings: findings,
        status: 'draft',
      });
      setEditedText((prev) => ({ ...prev, [pp._id]: cleanedText }));
      if (youtubeTitle !== undefined) {
        setEditedTitle((prev) => ({ ...prev, [pp._id]: youtubeTitle }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not regenerate ${pp.platform}.`);
    } finally {
      setRegeneratingId(null);
    }
  }

  async function handlePublish() {
    setError(null);

    const scheduleGroup = orderedPlatformPosts.filter((pp) => modeFor(pp._id) === 'schedule');
    const nowGroup = orderedPlatformPosts.filter((pp) => modeFor(pp._id) === 'now');

    const missingTime = scheduleGroup.find((pp) => scheduledTime[pp._id] === undefined);
    if (missingTime) {
      setError(`Pick a date and time for ${PLATFORM_LABELS[missingTime.platform]} before scheduling.`);
      return;
    }
    const pastTime = scheduleGroup.find((pp) => (scheduledTime[pp._id] as number) <= Date.now());
    if (pastTime) {
      setError(`Scheduled time for ${PLATFORM_LABELS[pastTime.platform]} must be in the future.`);
      return;
    }

    setPublishing(true);
    try {
      await Promise.all(
        orderedPlatformPosts.map((pp) =>
          updatePlatformPost({
            platformPostId: pp._id,
            finalText: editedText[pp._id] ?? pp.finalText,
            youtubeTitle: pp.platform === 'youtube' ? editedTitle[pp._id] ?? pp.youtubeTitle : undefined,
            status: 'approved',
          })
        )
      );

      if (scheduleGroup.length > 0) {
        await schedulePlatformPosts({
          items: scheduleGroup.map((pp) => ({
            platformPostId: pp._id,
            scheduledFor: scheduledTime[pp._id] as number,
          })),
        });
      }

      if (nowGroup.length > 0) {
        await publishPost({
          postId: post!._id,
          platforms: nowGroup.map((pp) => pp.platform),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish. Try again.');
    } finally {
      setPublishing(false);
    }
  }

  const scheduleCount = orderedPlatformPosts.filter((pp) => modeFor(pp._id) === 'schedule').length;
  const nowCount = orderedPlatformPosts.length - scheduleCount;
  const publishLabel =
    scheduleCount === 0
      ? `Publish to ${nowCount} platform${nowCount === 1 ? '' : 's'}`
      : nowCount === 0
        ? `Schedule ${scheduleCount} platform${scheduleCount === 1 ? '' : 's'}`
        : `Publish ${nowCount} & schedule ${scheduleCount}`;
  const publishIcon: keyof typeof MaterialCommunityIcons.glyphMap =
    nowCount === 0 && scheduleCount > 0 ? 'calendar-clock' : 'send-outline';

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.sectionLabel}>Your brief</Text>
        <Text style={styles.brief}>{post.brief}</Text>
      </View>

      {orderedPlatformPosts.map((pp) => {
        const autoFixed = pp.slopFindings.filter((f) => f.autoFixed);
        const flagged = pp.slopFindings.filter((f) => !f.autoFixed);
        const isRegenerating = regeneratingId === pp._id;
        const cardMode = modeFor(pp._id);
        const cardScheduledTime = scheduledTime[pp._id];

        return (
          <View key={pp._id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <PlatformBadge platform={pp.platform} size={26} />
                <Text style={styles.cardPlatform}>{PLATFORM_LABELS[pp.platform]}</Text>
              </View>
              <StatusPill status={pp.status} />
            </View>

            {pp.platform === 'youtube' ? (
              <TextInput
                style={styles.titleInput}
                placeholder="Video title"
                placeholderTextColor={color.onSurfaceFaint}
                value={editedTitle[pp._id] ?? ''}
                onChangeText={(value) => setEditedTitle((prev) => ({ ...prev, [pp._id]: value }))}
              />
            ) : null}

            <TextInput
              style={styles.textInput}
              multiline
              placeholderTextColor={color.onSurfaceFaint}
              value={editedText[pp._id] ?? pp.finalText}
              onChangeText={(value) => setEditedText((prev) => ({ ...prev, [pp._id]: value }))}
            />

            {autoFixed.length > 0 ? (
              <View style={styles.autoFixedNote}>
                <MaterialCommunityIcons name="auto-fix" size={13} color={color.onSurfaceFaint} />
                <Text style={styles.autoFixedText}>
                  Cleaned up automatically: {autoFixed.map((f) => `"${f.quote}"`).join(', ')}
                </Text>
              </View>
            ) : null}

            {flagged.map((finding, index) => (
              <View key={`${finding.rule}-${index}`} style={styles.warningChip}>
                <View style={styles.warningHeader}>
                  <MaterialCommunityIcons name="alert-outline" size={13} color={color.warning} />
                  <Text style={styles.warningRule}>{finding.rule}</Text>
                </View>
                <Text style={styles.warningQuote}>&ldquo;{finding.quote}&rdquo;</Text>
                <Text style={styles.warningSuggestion}>{finding.suggestion}</Text>
              </View>
            ))}

            {pp.status === 'failed' && pp.error ? (
              <View style={styles.inlineError}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={color.onErrorContainer} />
                <Text style={styles.inlineErrorText}>{pp.error}</Text>
              </View>
            ) : null}
            {pp.status === 'published' && pp.url ? (
              <Pressable
                style={styles.viewPostButton}
                onPress={() => Linking.openURL(pp.url!)}
                android_ripple={{ color: color.onPrimaryContainer }}
              >
                <MaterialCommunityIcons name="open-in-new" size={14} color={color.onPrimaryContainer} />
                <Text style={styles.viewPostButtonText}>View on {PLATFORM_LABELS[pp.platform]}</Text>
              </Pressable>
            ) : null}

            <View style={styles.scheduleModule}>
              <View style={styles.modeRow}>
                <Pressable
                  style={[styles.modeButton, cardMode === 'now' && styles.modeButtonActive]}
                  onPress={() => setMode((prev) => ({ ...prev, [pp._id]: 'now' }))}
                  hitSlop={{ top: 6, bottom: 6 }}
                  android_ripple={{ color: color.outline }}
                >
                  <Text style={[styles.modeButtonText, cardMode === 'now' && styles.modeButtonTextActive]}>
                    Publish now
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.modeButton, cardMode === 'schedule' && styles.modeButtonActive]}
                  onPress={() => setMode((prev) => ({ ...prev, [pp._id]: 'schedule' }))}
                  hitSlop={{ top: 6, bottom: 6 }}
                  android_ripple={{ color: color.outline }}
                >
                  <Text style={[styles.modeButtonText, cardMode === 'schedule' && styles.modeButtonTextActive]}>
                    Schedule
                  </Text>
                </Pressable>
              </View>

              {cardMode === 'schedule' ? (
                <View style={styles.scheduleControls}>
                  <Pressable
                    style={styles.timePickerButton}
                    onPress={() => openTimePicker(pp._id)}
                    hitSlop={{ top: 6, bottom: 6 }}
                    android_ripple={{ color: color.outline }}
                  >
                    <MaterialCommunityIcons name="calendar-clock" size={15} color={color.onSurfaceVariant} />
                    <Text style={styles.timePickerButtonText}>
                      {cardScheduledTime !== undefined ? formatScheduledFor(cardScheduledTime) : 'Pick date & time'}
                    </Text>
                  </Pressable>

                  {RNPlatform.OS === 'ios' && iosPickerFor === pp._id ? (
                    <View style={styles.iosPickerWrap}>
                      <DateTimePicker
                        value={new Date(cardScheduledTime ?? Date.now() + DEFAULT_SCHEDULE_LEAD_MS)}
                        mode="datetime"
                        display="spinner"
                        themeVariant="dark"
                        minimumDate={new Date()}
                        onChange={(_event, selectedDate) => {
                          if (selectedDate) {
                            setScheduledTime((prev) => ({ ...prev, [pp._id]: selectedDate.getTime() }));
                          }
                        }}
                      />
                    </View>
                  ) : null}

                  {cardScheduledTime !== undefined ? (
                    <Pressable
                      style={styles.applyAllButton}
                      onPress={() => applyTimeToAll(pp._id)}
                      hitSlop={{ top: 8, bottom: 8 }}
                      android_ripple={{ color: color.outline }}
                    >
                      <MaterialCommunityIcons name="content-copy" size={13} color={color.onSurfaceVariant} />
                      <Text style={styles.applyAllButtonText}>Apply this time to all</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <Pressable
              style={styles.regenerateButton}
              onPress={() => handleRegenerate(pp)}
              disabled={isRegenerating}
              hitSlop={{ top: 6, bottom: 6 }}
              android_ripple={{ color: color.outline }}
            >
              {isRegenerating ? (
                <ActivityIndicator size="small" color={color.onSurfaceVariant} />
              ) : (
                <>
                  <MaterialCommunityIcons name="refresh" size={15} color={color.onSurfaceVariant} />
                  <Text style={styles.regenerateButtonText}>Regenerate</Text>
                </>
              )}
            </Pressable>
          </View>
        );
      })}

      {error ? (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={color.onErrorContainer} />
          <Text style={styles.inlineErrorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.publishButton, publishing && styles.publishButtonDisabled]}
        onPress={handlePublish}
        disabled={publishing}
        android_ripple={{ color: color.onPrimary }}
      >
        {publishing ? (
          <ActivityIndicator color={color.onPrimary} />
        ) : (
          <>
            <MaterialCommunityIcons name={publishIcon} size={18} color={color.onPrimary} />
            <Text style={styles.publishButtonText}>{publishLabel}</Text>
          </>
        )}
      </Pressable>

      <Pressable style={styles.doneButton} onPress={onPublished}>
        <Text style={styles.doneButtonText}>View history</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, paddingTop: space.xxl, gap: space.lg, paddingBottom: space.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  emptyText: { ...type.bodyMedium, color: color.onSurfaceFaint },
  sectionLabel: { ...type.labelMedium, color: color.onSurfaceVariant, marginBottom: space.xs },
  brief: { ...type.titleMedium, color: color.onSurface },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardPlatform: { ...type.titleMedium, color: color.onSurface },
  titleInput: {
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    padding: space.md,
    fontSize: 14,
    fontWeight: '600',
    color: color.onSurface,
  },
  textInput: {
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    padding: space.md,
    fontSize: 14,
    color: color.onSurface,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  autoFixedNote: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  autoFixedText: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none', fontStyle: 'italic', flex: 1 },
  warningChip: {
    backgroundColor: color.warningContainer,
    borderRadius: radius.sm,
    padding: space.sm,
    gap: 2,
  },
  warningHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  warningRule: { ...type.labelSmall, color: color.warning },
  warningQuote: { ...type.bodyMedium, fontSize: 13, color: color.onWarningContainer },
  warningSuggestion: { ...type.labelSmall, color: color.onWarningContainer, textTransform: 'none', opacity: 0.85 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  inlineErrorText: { ...type.bodyMedium, fontSize: 13, color: color.onErrorContainer, flex: 1 },
  viewPostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    backgroundColor: color.primaryContainer,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    minHeight: 32,
  },
  viewPostButtonText: { ...type.labelMedium, color: color.onPrimaryContainer, textTransform: 'none' },
  // Groups the publish-mode toggle and its schedule fields into one visually distinct module —
  // a tonal step up from the card's own surface, so the scheduling controls read as one cohesive
  // unit nested in the card instead of loose pressables trailing after the slop warnings.
  scheduleModule: {
    marginTop: space.xs,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: space.xs,
    backgroundColor: color.surfaceVariant,
    borderRadius: radius.pill,
    padding: 3,
    alignSelf: 'flex-start',
  },
  modeButton: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    minHeight: 30,
    justifyContent: 'center',
  },
  modeButtonActive: { backgroundColor: color.primary },
  modeButtonText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  modeButtonTextActive: { color: color.onPrimary },
  scheduleControls: { gap: space.sm },
  timePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 36,
  },
  timePickerButtonText: { ...type.labelMedium, color: color.onSurface, textTransform: 'none' },
  iosPickerWrap: {
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  applyAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  applyAllButtonText: { ...type.labelSmall, color: color.onSurfaceVariant, textTransform: 'none' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.errorContainer,
    borderRadius: radius.sm,
    padding: space.md,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 36,
  },
  regenerateButtonText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: touchTarget + 8,
  },
  publishButtonDisabled: { opacity: 0.5 },
  publishButtonText: { ...type.labelLarge, color: color.onPrimary, textTransform: 'none', fontSize: 15 },
  doneButton: { alignItems: 'center', padding: space.md, minHeight: touchTarget, justifyContent: 'center' },
  doneButtonText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
});
