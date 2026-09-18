import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { checkSlop } from '../../convex/checkSlop';
import type { Id } from '../../convex/_generated/dataModel';
import {
  PLATFORMS,
  PLATFORM_LABELS,
  PLATFORMS_ALLOWING_HASHTAGS,
  PLATFORMS_NOT_YET_AVAILABLE,
  type ConnectablePlatform,
  type MediaType,
  type Platform,
  type PlatformPost,
} from '../types';
import { color, radius, space, touchTarget, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';

interface ComposeScreenProps {
  onGenerated: (postId: Id<'posts'>, platforms: Platform[]) => void;
  onOpenAccounts: () => void;
  onOpenDraft: (postId: Id<'posts'>, platforms: Platform[]) => void;
}

const STARTER_BRIEFS = ['What I shipped this week', 'A lesson from a bug', 'A behind-the-scenes update'];

const DISCONNECTED_STATUS: Record<ConnectablePlatform, boolean> = {
  linkedin: false,
  youtube: false,
  instagram: false,
  pinterest: false,
  facebook: false,
  twitter: false,
  threads: false,
};

export default function ComposeScreen({ onGenerated, onOpenAccounts, onOpenDraft }: ComposeScreenProps) {
  const [brief, setBrief] = useState('');
  const [mediaUri, setMediaUri] = useState<string | undefined>();
  const [mediaMimeType, setMediaMimeType] = useState<string | undefined>();
  const [mediaType, setMediaType] = useState<MediaType>('none');
  const [selected, setSelected] = useState<Set<Platform>>(new Set(['bluesky']));
  const [generating, setGenerating] = useState(false);
  const [postingDirectly, setPostingDirectly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<
    Partial<Record<Platform, 'queued' | 'writing' | 'ready' | 'failed'>>
  >({});
  const [dismissedOnboarding, setDismissedOnboarding] = useState(false);

  const platformStatus = useQuery(api.queries.getPlatformStatus);
  const posts = useQuery(api.queries.listPosts);
  const generateUploadUrl = useMutation(api.queries.generateUploadUrl);
  const createPost = useMutation(api.queries.createPost);
  const createPlatformPost = useMutation(api.queries.createPlatformPost);
  const generatePost = useAction(api.generatePost.generatePost);
  const checkConnections = useAction(api.connections.checkConnections);

  const [connectionStatus, setConnectionStatus] = useState<Record<ConnectablePlatform, boolean> | null>(
    null
  );
  const [checkingConnections, setCheckingConnections] = useState(false);

  const refreshConnections = useCallback(async () => {
    setCheckingConnections(true);
    try {
      setConnectionStatus(await checkConnections({}));
    } catch {
      // A broker/network failure must not make disconnected destinations look selectable.
      // Preserve a previously confirmed state, but fail closed on the first check.
      setConnectionStatus((previous) => previous ?? DISCONNECTED_STATUS);
    } finally {
      setCheckingConnections(false);
    }
  }, [checkConnections]);

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((platform) => isConnected(platform) !== false));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformStatus, connectionStatus]);

  function isConnected(platform: Platform): boolean | undefined {
    if (platform === 'bluesky') return platformStatus?.bluesky;
    return connectionStatus?.[platform];
  }

  async function pickMedia() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setMediaUri(asset.uri);
    setMediaMimeType(asset.mimeType);
    setMediaType(asset.type === 'video' ? 'video' : 'image');
  }

  function clearMedia() {
    setMediaUri(undefined);
    setMediaMimeType(undefined);
    setMediaType('none');
  }

  function togglePlatform(platform: Platform) {
    if (isConnected(platform) !== true) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(platform) ? next.delete(platform) : next.add(platform);
      return next;
    });
  }

  async function uploadMedia(): Promise<Id<'_storage'> | undefined> {
    if (!mediaUri) return undefined;
    const uploadUrl = await generateUploadUrl();
    const fileResponse = await fetch(mediaUri);
    const blob = await fileResponse.blob();
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': mediaMimeType ?? blob.type ?? 'application/octet-stream' },
      body: blob,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Media upload failed (${uploadResponse.status})`);
    }
    const { storageId } = (await uploadResponse.json()) as { storageId: Id<'_storage'> };
    return storageId;
  }

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const mediaStorageId = await uploadMedia();
      const postId = await createPost({ brief, mediaType, mediaStorageId });
      const platforms = Array.from(selected);
      setGenerationProgress(Object.fromEntries(platforms.map((platform) => [platform, 'queued'])));

      await Promise.all(
        platforms.map(async (platform) => {
          setGenerationProgress((prev) => ({ ...prev, [platform]: 'writing' }));
          try {
            const { generatedText, youtubeTitle } = await generatePost({ brief, platform });
            const { cleanedText, findings } = checkSlop(
              generatedText,
              PLATFORMS_ALLOWING_HASHTAGS.includes(platform)
            );
            await createPlatformPost({
              postId,
              platform,
              generatedText,
              finalText: cleanedText,
              youtubeTitle,
              slopFindings: findings,
            });
            setGenerationProgress((prev) => ({ ...prev, [platform]: 'ready' }));
          } catch (platformError) {
            setGenerationProgress((prev) => ({ ...prev, [platform]: 'failed' }));
            throw platformError;
          }
        })
      );

      onGenerated(postId, platforms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate drafts. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function handlePostDirectly() {
    setError(null);
    setPostingDirectly(true);
    try {
      const mediaStorageId = await uploadMedia();
      const postId = await createPost({ brief, mediaType, mediaStorageId });
      const platforms = Array.from(selected);

      await Promise.all(
        platforms.map(async (platform) => {
          const { cleanedText, findings } = checkSlop(brief, PLATFORMS_ALLOWING_HASHTAGS.includes(platform));
          await createPlatformPost({
            postId,
            platform,
            generatedText: brief,
            finalText: cleanedText,
            slopFindings: findings,
          });
        })
      );

      onGenerated(postId, platforms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post. Try again.');
    } finally {
      setPostingDirectly(false);
    }
  }

  const busy = generating || postingDirectly;
  const canGenerate = brief.trim().length > 0 && selected.size > 0 && !busy;
  const canPostDirectly = brief.trim().length > 0 && selected.size > 0 && !busy;

  // Keep every supported destination discoverable here. Connected services can be selected;
  // disconnected services act as a clear route into Accounts instead of silently disappearing.
  const comingSoonSet = new Set(PLATFORMS_NOT_YET_AVAILABLE);
  const availablePlatforms = PLATFORMS.filter((platform) => !comingSoonSet.has(platform));
  const hasConnectedDestination = Boolean(
    platformStatus?.bluesky || Object.values(connectionStatus ?? {}).some(Boolean)
  );
  const connectionCheckFinished = platformStatus !== undefined && connectionStatus !== null;
  const draftPosts = (posts ?? []).filter((post) =>
    post.platformPosts.some((platformPost: PlatformPost) => platformPost.status === 'draft' || platformPost.status === 'approved')
  );
  const latestDraft = draftPosts[0];

  if (connectionCheckFinished && !hasConnectedDestination && !dismissedOnboarding) {
    return (
      <View style={styles.welcomeScreen}>
        <View style={styles.welcomeMark}>
          <MaterialCommunityIcons name="source-branch" size={24} color={color.onPrimaryContainer} />
        </View>
        <Text style={styles.welcomeTitle}>Create once.{`\n`}Publish everywhere.</Text>
        <Text style={styles.welcomeText}>
          Write one idea. UniPost adapts it for each platform — and you approve every word before it goes out.
        </Text>
        <View style={styles.welcomePlatforms}>
          {PLATFORMS.filter((platform) => !comingSoonSet.has(platform)).map((platform) => (
            <View key={platform} style={styles.welcomePlatformChip}>
              <PlatformBadge platform={platform} size={20} />
              <Text style={styles.welcomePlatformText}>{PLATFORM_LABELS[platform]}</Text>
            </View>
          ))}
        </View>
        <Pressable style={styles.welcomePrimary} onPress={onOpenAccounts}>
          <Text style={styles.welcomePrimaryText}>Connect a destination</Text>
        </Pressable>
        <Pressable style={styles.welcomeSecondary} onPress={() => setDismissedOnboarding(true)}>
          <Text style={styles.welcomeSecondaryText}>Skip for now</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.composeHeader}>
        <View>
          <Text style={styles.title}>Compose</Text>
        </View>
        {latestDraft ? (
          <Pressable
            style={styles.draftsButton}
            onPress={() => onOpenDraft(
              latestDraft._id,
              latestDraft.platformPosts
                .filter((platformPost: PlatformPost) => platformPost.status === 'draft' || platformPost.status === 'approved')
                .map((platformPost: PlatformPost) => platformPost.platform)
            )}
          >
            <Text style={styles.draftsButtonText}>Drafts · {draftPosts.length}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.eyebrow}>WHAT'S THE IDEA?</Text>
      <TextInput
        style={styles.input}
        placeholder="What do you want to post?"
        placeholderTextColor={color.onSurfaceFaint}
        multiline
        value={brief}
        onChangeText={setBrief}
      />

      {brief.trim().length === 0 ? (
        <View style={styles.starterRow}>
          {STARTER_BRIEFS.map((starter) => (
            <Pressable key={starter} style={styles.starterChip} onPress={() => setBrief(starter)}>
              <MaterialCommunityIcons name="creation" size={13} color={color.onPrimaryContainer} />
              <Text style={styles.starterText}>{starter}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>MEDIA</Text>
        <Text style={styles.optionalLabel}>Optional</Text>
      </View>

      {mediaUri ? (
        <View style={styles.mediaBlock}>
          {mediaType === 'image' ? (
            <Image source={{ uri: mediaUri }} style={styles.preview} />
          ) : (
            <View style={[styles.preview, styles.videoPreview]}>
              <MaterialCommunityIcons name="movie-play-outline" size={28} color={color.onSurfaceVariant} />
              <Text style={styles.videoPreviewText}>Video selected</Text>
            </View>
          )}
          <Pressable style={styles.secondaryButton} onPress={clearMedia}>
            <MaterialCommunityIcons name="close" size={16} color={color.onSurfaceVariant} />
            <Text style={styles.secondaryButtonText}>Remove media</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.mediaActions}>
          <Pressable style={styles.mediaButton} onPress={pickMedia}>
            <MaterialCommunityIcons name="plus" size={16} color={color.onSurface} />
            <Text style={styles.mediaButtonText}>Photo</Text>
          </Pressable>
          <Pressable style={styles.mediaButton} onPress={pickMedia}>
            <MaterialCommunityIcons name="plus" size={16} color={color.onSurface} />
            <Text style={styles.mediaButtonText}>Video</Text>
          </Pressable>
        </View>
      )}

      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Destinations · {selected.size}</Text>
          <View style={styles.sectionActions}>
            <Pressable style={styles.manageButton} onPress={onOpenAccounts}>
              <Text style={styles.manageButtonText}>Manage</Text>
            </Pressable>
            <Pressable
              onPress={refreshConnections}
              disabled={checkingConnections}
              hitSlop={8}
              style={styles.refreshButton}
            >
              {checkingConnections ? (
                <ActivityIndicator size="small" color={color.onSurfaceFaint} />
              ) : (
                <MaterialCommunityIcons name="refresh" size={16} color={color.onSurfaceFaint} />
              )}
            </Pressable>
          </View>
        </View>
        <View style={styles.chipRow}>
          {availablePlatforms.map((platform) => {
            const isSelected = selected.has(platform);
            const connected = isConnected(platform);
            const pending = platform !== 'bluesky' && connected === undefined;
            return (
              <Pressable
                key={platform}
                style={[styles.chip, isSelected && styles.chipSelected, connected === false && styles.chipDisconnected]}
                onPress={() => connected === false ? onOpenAccounts() : togglePlatform(platform)}
                hitSlop={{ top: 6, bottom: 6 }}
                android_ripple={{ color: color.outline }}
              >
                <PlatformBadge platform={platform} size={20} />
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                  {PLATFORM_LABELS[platform]}{connected === false ? ' · connect' : ''}
                </Text>
                {pending ? (
                  <ActivityIndicator size="small" color={color.onSurfaceFaint} />
                ) : isSelected ? (
                  <MaterialCommunityIcons name="check" size={14} color={color.onPrimaryContainer} />
                ) : null}
              </Pressable>
            );
          })}
          <Pressable
            style={styles.addPlatformChip}
            onPress={onOpenAccounts}
            accessibilityRole="button"
            accessibilityLabel="Connect another platform"
            accessibilityHint="Opens the Accounts page"
            android_ripple={{ color: color.outline, borderless: true }}
          >
            <MaterialCommunityIcons name="plus" size={22} color={color.onSurfaceVariant} />
          </Pressable>
        </View>
        {mediaType === 'none' && (selected.has('youtube') || selected.has('pinterest')) ? (
          <View style={styles.advisoryRow}>
            <MaterialCommunityIcons name="information-outline" size={15} color={color.info} />
            <Text style={styles.advisoryText}>YouTube and Pinterest require media before publishing.</Text>
          </View>
        ) : null}
      </View>

      {generating ? (
        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>Adapting your brief</Text>
          <Text style={styles.progressSubtitle}>You’ll review every draft before anything publishes.</Text>
          {Array.from(selected).map((platform) => {
            const state = generationProgress[platform] ?? 'queued';
            return (
              <View key={platform} style={styles.progressRow}>
                <PlatformBadge platform={platform} size={22} />
                <Text style={styles.progressPlatform}>{PLATFORM_LABELS[platform]}</Text>
                <Text style={[styles.progressState, state === 'ready' && styles.progressReady, state === 'failed' && styles.progressFailed]}>
                  {state === 'writing' ? 'Writing…' : state === 'ready' ? 'Ready' : state === 'failed' ? 'Failed' : 'Queued'}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={color.onErrorContainer} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.generateButton, !canGenerate && styles.generateButtonDisabled]}
        onPress={handleGenerate}
        disabled={!canGenerate}
        android_ripple={{ color: color.onPrimary }}
      >
        {generating ? (
          <ActivityIndicator color={color.onPrimary} />
        ) : (
          <>
            <MaterialCommunityIcons name="creation" size={18} color={color.onPrimary} />
            <Text style={styles.generateButtonText}>
              Generate for {selected.size} platform{selected.size === 1 ? '' : 's'}
            </Text>
          </>
        )}
      </Pressable>

      {!busy && selected.size === 0 ? (
        <Text style={styles.disabledReason}>Connect and select at least one destination to continue.</Text>
      ) : null}

      <Pressable
        style={[styles.postDirectlyButton, !canPostDirectly && styles.generateButtonDisabled]}
        onPress={handlePostDirectly}
        disabled={!canPostDirectly}
        android_ripple={{ color: color.outline }}
      >
        {postingDirectly ? (
          <ActivityIndicator color={color.onSurface} />
        ) : (
          <>
            <MaterialCommunityIcons name="send-outline" size={18} color={color.onSurface} />
            <Text style={styles.postDirectlyButtonText}>
              Use my own copy for {selected.size} platform{selected.size === 1 ? '' : 's'}
            </Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  welcomeScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    paddingBottom: space.xxxl,
    gap: space.md,
  },
  welcomeMark: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.primaryContainer,
    marginBottom: space.xs,
  },
  welcomeTitle: { ...type.headlineSmall, color: color.onBackground, textAlign: 'center', lineHeight: 32 },
  welcomeText: { ...type.bodyMedium, color: color.onSurfaceVariant, textAlign: 'center', maxWidth: 330 },
  welcomePlatforms: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginVertical: space.sm },
  welcomePlatformChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: color.outline, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: space.sm },
  welcomePlatformText: { ...type.labelSmall, color: color.onSurfaceVariant, textTransform: 'none' },
  welcomePrimary: { width: '100%', minHeight: touchTarget + 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: color.primary, marginTop: space.sm },
  welcomePrimaryText: { ...type.labelLarge, color: color.onPrimary, textTransform: 'none' },
  welcomeSecondary: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  welcomeSecondaryText: { ...type.labelMedium, color: color.onSurfaceFaint, textTransform: 'none' },
  container: { padding: space.lg, paddingTop: space.xl, gap: space.md, paddingBottom: space.xxxl },
  composeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  title: { ...type.headlineSmall, color: color.onBackground },
  subtitle: { ...type.bodyMedium, color: color.onSurfaceVariant, marginTop: 2 },
  eyebrow: { ...type.labelSmall, color: color.onSurfaceFaint, letterSpacing: 0.8, marginTop: space.xs },
  draftsButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: color.surface, borderRadius: radius.sm },
  draftsButtonText: { ...type.labelMedium, color: color.onPrimaryContainer, textTransform: 'none' },
  input: {
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.background,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 96,
    fontSize: 16,
    color: color.onSurface,
    textAlignVertical: 'top',
  },
  starterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.xs },
  starterChip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.background,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
  },
  starterText: { ...type.labelMedium, color: color.onSurfaceVariant, textTransform: 'none' },
  mediaBlock: { gap: space.sm },
  preview: { width: '100%', height: 200, borderRadius: radius.md },
  videoPreview: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceVariant, gap: space.xs },
  videoPreviewText: { ...type.bodyMedium, color: color.onSurfaceVariant },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.sm,
    minHeight: touchTarget,
    paddingHorizontal: space.lg,
  },
  secondaryButtonText: { ...type.labelLarge, color: color.onSurfaceVariant, textTransform: 'none' },
  mediaActions: { flexDirection: 'row', gap: space.sm, marginTop: -space.sm },
  mediaButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
  },
  mediaButtonText: { ...type.labelMedium, color: color.onSurface, textTransform: 'none' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  sectionLabel: { ...type.labelMedium, color: color.onSurfaceVariant },
  optionalLabel: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none' },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  manageButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.sm },
  manageButtonText: { ...type.labelMedium, color: color.onPrimaryContainer, textTransform: 'none' },
  refreshButton: { width: touchTarget / 2, height: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: space.sm,
  },
  chipSelected: { borderColor: 'transparent', backgroundColor: color.primaryContainer },
  chipDisconnected: { opacity: 0.52 },
  chipLabel: { ...type.labelLarge, color: color.onSurface, textTransform: 'none' },
  chipLabelSelected: { color: color.onPrimaryContainer },
  addPlatformChip: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.pill,
  },
  advisoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs, marginTop: space.sm },
  advisoryText: { ...type.labelSmall, color: color.onSurfaceVariant, textTransform: 'none', flex: 1 },
  progressCard: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  progressTitle: { ...type.titleMedium, color: color.onSurface },
  progressSubtitle: { ...type.bodyMedium, color: color.onSurfaceVariant },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  progressPlatform: { ...type.bodyMedium, color: color.onSurface, flex: 1 },
  progressState: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'uppercase' },
  progressReady: { color: color.success },
  progressFailed: { color: color.error },
  disabledReason: { ...type.labelSmall, color: color.onSurfaceFaint, textTransform: 'none', textAlign: 'center', marginTop: -space.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.errorContainer,
    borderRadius: radius.sm,
    padding: space.md,
  },
  errorText: { ...type.bodyMedium, color: color.onErrorContainer, flex: 1 },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.primary,
    borderRadius: radius.md,
    minHeight: touchTarget + 8,
  },
  generateButtonDisabled: { opacity: 0.4 },
  generateButtonText: { ...type.labelLarge, color: color.onPrimary, textTransform: 'none', fontSize: 15 },
  postDirectlyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.md,
    minHeight: touchTarget + 8,
  },
  postDirectlyButtonText: { ...type.labelLarge, color: color.onSurface, textTransform: 'none', fontSize: 15 },
});
