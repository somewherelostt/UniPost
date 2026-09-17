import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  posts: defineTable({
    brief: v.string(),
    mediaType: v.union(v.literal('none'), v.literal('image'), v.literal('video')),
    mediaStorageId: v.optional(v.id('_storage')),
    createdAt: v.number(),
  }),

  platformPosts: defineTable({
    postId: v.id('posts'),
    platform: v.union(
      v.literal('bluesky'),
      v.literal('linkedin'),
      v.literal('youtube'),
      v.literal('instagram'),
      v.literal('pinterest'),
      v.literal('facebook'),
      v.literal('twitter'),
      v.literal('threads')
    ),
    generatedText: v.string(),
    finalText: v.string(),
    youtubeTitle: v.optional(v.string()),
    // Set only when this platform post went out with no user-attached media and a fallback
    // image was generated from its text (currently Instagram only — see the `instagram` case
    // in publishPost.ts's dispatch()). Lives on the platform post, not the shared parent post's
    // `mediaStorageId`, so the fallback image never leaks into a different platform's publish
    // attempt on a later retry of the same post.
    generatedImageStorageId: v.optional(v.id('_storage')),
    slopFindings: v.array(
      v.object({
        rule: v.string(),
        quote: v.string(),
        suggestion: v.string(),
        autoFixed: v.boolean(),
      })
    ),
    status: v.union(
      v.literal('draft'),
      v.literal('approved'),
      v.literal('scheduled'),
      v.literal('publishing'),
      v.literal('published'),
      v.literal('failed')
    ),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    scheduledFor: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.string()),
  }).index('by_post', ['postId']),

  // Analytics ingestion (docs/spec-v1.md section 3-4), scoped down from that doc's aspirational
  // bluesky+youtube union to exactly the platforms actually confirmed buildable in this pass —
  // see convex/lib/analytics.ts's top comment for the platform-by-platform evidence trail.
  // Every poll is kept (not overwritten), so a future reflection job can see engagement
  // trajectory over time, matching spec-v1.md section 4 point 3.
  postMetrics: defineTable({
    platformPostId: v.id('platformPosts'),
    platform: v.union(v.literal('bluesky'), v.literal('facebook')),
    likes: v.optional(v.number()),
    reposts: v.optional(v.number()),
    comments: v.optional(v.number()),
    views: v.optional(v.number()),
    fetchedAt: v.number(),
  }).index('by_platform_post', ['platformPostId']),
});
