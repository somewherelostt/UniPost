"use node";

// Root-owned integration point per PLAN.md. Dispatches each selected platform to the matching
// implementation: Bluesky calls lib/bluesky.ts directly (no third-party auth broker), LinkedIn
// and YouTube go through lib/composio.ts (see docs/spec-v0.md section 6 for why). Media, when
// present, is resolved from Convex file storage to a fetchable URL once and reused across every
// platform that needs it.
import { action, internalAction, type ActionCtx } from './_generated/server';
import { v } from 'convex/values';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { publishToBluesky } from './lib/bluesky';
import {
  publishToFacebook,
  publishToInstagram,
  publishToLinkedIn,
  publishToPinterest,
  publishToThreads,
  publishToTwitter,
  publishToYouTube,
} from './lib/composio';
import { generateFallbackImage } from './lib/imageGen';

// Matches `dispatch()`'s own platform union below, not the (potentially wider, still-evolving)
// schema union — this file's dispatch table only knows how to handle the platforms it has a
// `case` for, independent of how many platform literals the schema itself lists.
type DispatchablePlatform =
  | 'bluesky'
  | 'linkedin'
  | 'youtube'
  | 'instagram'
  | 'pinterest'
  | 'facebook'
  | 'twitter'
  | 'threads';

export const publishPost = action({
  args: {
    postId: v.id('posts'),
    platforms: v.array(
      v.union(
        v.literal('bluesky'),
        v.literal('linkedin'),
        v.literal('youtube'),
        v.literal('instagram'),
        v.literal('pinterest'),
        v.literal('facebook'),
        v.literal('twitter'),
        v.literal('threads')
      )
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const post = await ctx.runQuery(api.queries.getPost, { postId: args.postId });
    if (!post) return null;

    const mediaUrl = post.mediaStorageId
      ? await ctx.storage.getUrl(post.mediaStorageId)
      : null;

    for (const platform of args.platforms) {
      const platformPost = post.platformPosts.find(
        (pp: { platform: string }) => pp.platform === platform
      );
      if (!platformPost) continue;

      await publishOnePlatformPost(ctx, platformPost, mediaUrl, post.mediaType);
    }

    return null;
  },
});

// Extracted so the interactive `publishPost` loop above and the scheduled dispatch below share
// one implementation instead of two copies of "mark publishing, dispatch, record result" — see
// PLAN-scheduling.md. Takes an already-resolved platformPost row and media URL rather than
// looking them up itself, since the two call sites resolve those differently (one already has
// the whole post's platformPosts loaded, the other only starts with a platformPostId).
async function publishOnePlatformPost(
  ctx: ActionCtx,
  platformPost: {
    _id: Id<'platformPosts'>;
    platform: DispatchablePlatform;
    finalText: string;
    youtubeTitle?: string;
  },
  mediaUrl: string | null,
  mediaType: 'none' | 'image' | 'video'
): Promise<void> {
  await ctx.runMutation(api.queries.updatePlatformPost, {
    platformPostId: platformPost._id,
    status: 'publishing',
  });

  const result = await dispatch(ctx, platformPost.platform, platformPost, mediaUrl, mediaType);

  await ctx.runMutation(api.queries.updatePlatformPost, {
    platformPostId: platformPost._id,
    status: result.success ? 'published' : 'failed',
    url: result.url,
    error: result.error,
    publishedAt: result.success ? Date.now() : undefined,
  });
}

// Scheduled counterpart to the interactive `publishPost` action above, called by
// `ctx.scheduler.runAt` from `convex/schedulePost.ts` at the user-chosen time. Internal only —
// the scheduler is the sole caller, a client can never invoke this directly.
export const publishScheduledPlatformPost = internalAction({
  args: { platformPostId: v.id('platformPosts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const platformPost = await ctx.runQuery(api.queries.getPlatformPost, {
      platformPostId: args.platformPostId,
    });
    if (!platformPost) return null;

    const post = await ctx.runQuery(api.queries.getPost, { postId: platformPost.postId });
    if (!post) return null;

    const mediaUrl = post.mediaStorageId ? await ctx.storage.getUrl(post.mediaStorageId) : null;

    await publishOnePlatformPost(ctx, platformPost, mediaUrl, post.mediaType);
    return null;
  },
});

async function dispatch(
  ctx: ActionCtx,
  platform: DispatchablePlatform,
  platformPost: { _id: Id<'platformPosts'>; finalText: string; youtubeTitle?: string },
  mediaUrl: string | null,
  mediaType: 'none' | 'image' | 'video'
): Promise<{ success: boolean; url?: string; error?: string }> {
  switch (platform) {
    case 'bluesky':
      return publishToBluesky(platformPost.finalText, mediaUrl ?? undefined);
    case 'linkedin':
      // LinkedIn allows text-only posts, matching Bluesky/Facebook/Twitter's optional-media
      // pattern rather than YouTube/Instagram/Pinterest's media-required one.
      return publishToLinkedIn(platformPost.finalText, mediaUrl ?? undefined);
    case 'youtube':
      if (!mediaUrl) {
        return { success: false, error: 'YouTube requires a video — none was attached to this post' };
      }
      return publishToYouTube(
        platformPost.youtubeTitle ?? 'Untitled',
        platformPost.finalText,
        mediaUrl
      );
    case 'instagram': {
      // Instagram has no text-only post type, unlike Bluesky/LinkedIn/Facebook/Twitter/Threads
      // above. Rather than hard-failing when no media was attached, generate a fallback image
      // from the post's own caption text and publish with that instead. Scoped to this one
      // platform only: Pinterest and YouTube also require media below, and keep their existing
      // hard-fail behavior, since a user picking those platforms chose ones where the media IS
      // the point (a pin's photo, a video upload) rather than an accessory to text.
      let instagramMediaUrl = mediaUrl;
      // Tracks what kind of media is actually being sent, which can diverge from the post's own
      // `mediaType` field below (`generateFallbackImage` always produces an image, even when the
      // post itself was 'none').
      let instagramMediaType: 'none' | 'image' | 'video' = mediaType;
      if (!instagramMediaUrl) {
        try {
          const storageId = await generateFallbackImage(ctx, platformPost.finalText);
          await ctx.runMutation(api.queries.updatePlatformPost, {
            platformPostId: platformPost._id,
            generatedImageStorageId: storageId,
          });
          instagramMediaUrl = await ctx.storage.getUrl(storageId);
          instagramMediaType = 'image';
        } catch (error) {
          console.error('dispatch: Instagram fallback image generation failed', error);
          return {
            success: false,
            error: 'Instagram requires a photo or video, and generating a fallback image failed',
          };
        }
        if (!instagramMediaUrl) {
          return {
            success: false,
            error: 'Instagram requires a photo or video, and the generated fallback image could not be stored',
          };
        }
      }
      return publishToInstagram(platformPost.finalText, instagramMediaUrl, instagramMediaType);
    }
    case 'pinterest':
      if (!mediaUrl) {
        return { success: false, error: 'Pinterest requires a photo' };
      }
      // Reuses the `youtubeTitle` field as the generic "platform title" for any platform with a
      // title/body split in its schema row (currently youtube and pinterest) — see the matching
      // comment in generatePost.ts for why this doesn't get its own `pinterestTitle` column.
      return publishToPinterest(
        platformPost.youtubeTitle ?? 'Untitled',
        platformPost.finalText,
        mediaUrl
      );
    case 'facebook':
      // Facebook Pages allow text-only posts, matching LinkedIn's pattern rather than
      // Instagram/Pinterest/YouTube's media-required one — no media guard here.
      return publishToFacebook(platformPost.finalText, mediaUrl ?? undefined);
    case 'twitter':
      // Bluesky/LinkedIn/Facebook's optional-media pattern, not YouTube/Instagram/Pinterest's
      // required-media one — a tweet is valid text-only.
      return publishToTwitter(platformPost.finalText, mediaUrl ?? undefined);
    case 'threads':
      // Same optional-media pattern as Twitter/Bluesky. publishToThreads always returns a clear
      // failure right now (no Composio toolkit exists for Threads yet — see the comment above
      // publishToThreads in lib/composio.ts), so this case exists for dispatch-table uniformity,
      // not because publishing actually succeeds today.
      return publishToThreads(platformPost.finalText, mediaUrl ?? undefined);
  }
}
