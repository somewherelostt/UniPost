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
} from '../types';
import { color, radius, space, touchTarget, type } from '../theme';
import PlatformBadge from '../components/PlatformBadge';

interface ComposeScreenProps {
  onGenerated: (postId: Id<'posts'>, platforms: Platform[]) => void;
}

export default function ComposeScreen({ onGenerated }: ComposeScreenProps) {
  const [brief, setBrief] = useState('');
  const [mediaUri, setMediaUri] = useState<string | undefined>();
  const [mediaMimeType, setMediaMimeType] = useState<string | undefined>();
  const [mediaType, setMediaType] = useState<MediaType>('none');
  const [selected, setSelected] = useState<Set<Platform>>(new Set(['bluesky']));
  const [generating, setGenerating] = useState(false);
  const [postingDirectly, setPostingDirectly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformStatus = useQuery(api.queries.getPlatformStatus);
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
      // leave connectionStatus as-is; the chip falls back to "Not connected" until this succeeds
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

      await Promise.all(
        platforms.map(async (platform) => {
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

  // Compose only offers platform *selection* now — connecting and disconnecting accounts moved to
  // the dedicated Accounts tab. Chosen approach: hide not-yet-connected platforms entirely rather
  // than show them muted with a "Connect in Accounts tab" hint. This is the simplest, most literal
  // reading of "only allow user to select platform they want to compose post for" — a platform you
  // can't post to has no business occupying space on this screen, and the Accounts tab is one tap
  // away for anyone who wants to add one. Still-loading platforms (isConnected === undefined) stay
  // visible with a spinner so the list doesn't visibly shrink then grow back on every screen open.
  const comingSoonSet = new Set(PLATFORMS_NOT_YET_AVAILABLE);
  const availablePlatforms = PLATFORMS.filter(
    (platform) => !comingSoonSet.has(platform) && !(platform !== 'bluesky' && isConnected(platform) === false)
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.title}>UniPost</Text>
        <Text style={styles.subtitle}>Create once. Publish everywhere.</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="What do you want to post?"
        placeholderTextColor={color.onSurfaceFaint}
        multiline
        value={brief}
        onChangeText={setBrief}
      />

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
        <Pressable style={styles.secondaryButton} onPress={pickMedia}>
          <MaterialCommunityIcons name="image-plus" size={16} color={color.onSurfaceVariant} />
          <Text style={styles.secondaryButtonText}>Add photo or video</Text>
        </Pressable>
      )}

      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Platforms</Text>
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
        <View style={styles.chipRow}>
          {availablePlatforms.map((platform) => {
            const isSelected = selected.has(platform);
            const pending = platform !== 'bluesky' && isConnected(platform) === undefined;
            return (
              <Pressable
                key={platform}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => togglePlatform(platform)}
                hitSlop={{ top: 6, bottom: 6 }}
                android_ripple={{ color: color.outline }}
              >
                <PlatformBadge platform={platform} size={20} />
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                  {PLATFORM_LABELS[platform]}
                </Text>
                {pending ? (
                  <ActivityIndicator size="small" color={color.onSurfaceFaint} />
                ) : isSelected ? (
                  <MaterialCommunityIcons name="check" size={14} color={color.onPrimaryContainer} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

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
              Post as-is to {selected.size} platform{selected.size === 1 ? '' : 's'}
            </Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, paddingTop: space.xxl, gap: space.lg, paddingBottom: space.xxxl },
  title: { ...type.headlineSmall, color: color.onBackground },
  subtitle: { ...type.bodyMedium, color: color.onSurfaceVariant, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.lg,
    minHeight: 110,
    fontSize: 16,
    color: color.onSurface,
    textAlignVertical: 'top',
  },
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  sectionLabel: { ...type.labelMedium, color: color.onSurfaceVariant },
  refreshButton: { width: touchTarget / 2, height: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.outline,
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  chipSelected: { borderColor: 'transparent', backgroundColor: color.primaryContainer },
  chipLabel: { ...type.labelLarge, color: color.onSurface, textTransform: 'none' },
  chipLabelSelected: { color: color.onPrimaryContainer },
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
