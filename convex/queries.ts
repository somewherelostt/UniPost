// STUB — owned by "root" per PLAN.md (pending after convex/lib/bluesky.ts and
// convex/lib/composio.ts land). The client-screens leaf (src/) wrote this file only so
// ComposeScreen and ReviewScreen have real Convex functions to call and typecheck against.
//
// `listPosts` and `getPost` match PLAN.md's contract exactly. Everything else here
// (generateUploadUrl, createPost, createPlatformPost, updatePlatformPost, getPlatformStatus)
// is NOT in PLAN.md's contract table — it exists because the ComposeScreen/ReviewScreen leaf
// instructions required something to call for file upload, post creation, and draft
// persistence, and no other leaf owns that surface. The integrator should review these against
// the final schema/publishPost.ts wiring and replace or extend as needed.
//
// `getPlatformStatus` in particular is a rough proxy (env-var presence) standing in for a real
// per-linked-account check — it never imports or names the Composio SDK, only checks for the
// presence of server-side env vars, so it does not leak the word "Composio" to the client.
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const slopFindingValidator = v.object({
  rule: v.string(),
  quote: v.string(),
  suggestion: v.string(),
  autoFixed: v.boolean(),
});

const platformValidator = v.union(
  v.literal('bluesky'),
  v.literal('linkedin'),
  v.literal('youtube'),
  v.literal('instagram'),
  v.literal('pinterest'),
  v.literal('facebook'),
  v.literal('twitter'),
  v.literal('threads')
);

const statusValidator = v.union(
  v.literal('draft'),
  v.literal('approved'),
  v.literal('scheduled'),
  v.literal('publishing'),
  v.literal('published'),
  v.literal('failed')
);

// Matches convex/schema.ts's `postMetrics.platform` union exactly — see
// convex/lib/analytics.ts's top comment for why this is narrower than `platformValidator` above.
const metricsPlatformValidator = v.union(v.literal('bluesky'), v.literal('facebook'));

export const listPosts = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const posts = await ctx.db.query('posts').order('desc').take(200);
    return await Promise.all(
      posts.map(async (post) => {
        const platformPosts = await ctx.db
          .query('platformPosts')
          .withIndex('by_post', (q) => q.eq('postId', post._id))
          .collect();
        return { ...post, platformPosts };
      })
    );
  },
});

export const getPost = query({
  args: { postId: v.id('posts') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return null;
    const platformPosts = await ctx.db
      .query('platformPosts')
      .withIndex('by_post', (q) => q.eq('postId', args.postId))
      .collect();
    return { ...post, platformPosts };
  },
});

// Single platform-post lookup, added for convex/publishPost.ts's scheduled dispatch path (it
// only has a platformPostId, not the parent postId, when a scheduled job wakes up).
export const getPlatformPost = query({
  args: { platformPostId: v.id('platformPosts') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.platformPostId);
  },
});

// STUB: standard Convex direct-upload pattern. The client calls this to get a one-time signed
// URL, POSTs the media blob to it, then gets a storageId back to save on the post.
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// STUB
export const createPost = mutation({
  args: {
    brief: v.string(),
    mediaType: v.union(v.literal('none'), v.literal('image'), v.literal('video')),
    mediaStorageId: v.optional(v.id('_storage')),
  },
  returns: v.id('posts'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('posts', { ...args, createdAt: Date.now() });
  },
});

// STUB: called once per platform right after generatePost + a client-side checkSlop pass.
export const createPlatformPost = mutation({
  args: {
    postId: v.id('posts'),
    platform: platformValidator,
    generatedText: v.string(),
    finalText: v.string(),
    youtubeTitle: v.optional(v.string()),
    slopFindings: v.array(slopFindingValidator),
  },
  returns: v.id('platformPosts'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('platformPosts', { ...args, status: 'draft' });
  },
});

// STUB: generic patch, used for regenerate, user edits, approval, and (by the publishPost.ts
// stub) marking publish progress/outcome.
export const updatePlatformPost = mutation({
  args: {
    platformPostId: v.id('platformPosts'),
    generatedText: v.optional(v.string()),
    finalText: v.optional(v.string()),
    youtubeTitle: v.optional(v.string()),
    generatedImageStorageId: v.optional(v.id('_storage')),
    slopFindings: v.optional(v.array(slopFindingValidator)),
    status: v.optional(statusValidator),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { platformPostId, ...patch } = args;
    await ctx.db.patch(platformPostId, patch);
    return null;
  },
});

// Flattens every platformPosts row across every post into one list, one item per publish EVENT
// (not grouped by parent post), for HistoryScreen's timeline view. Each item resolves whichever
// timestamp is meaningful for its own status — publishedAt once published, scheduledFor once
// scheduled, otherwise the platformPost's own _creationTime (there's no separate "failedAt"/
// "draftedAt" field, and _creationTime is specific to this platform event rather than the whole
// parent post, which matters once a post fans out to several platforms at different times) — then
// sorts desc by that resolved timestamp across the WHOLE set, not per-post.
export const listTimelineEvents = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    // Bounded the same way listPosts bounds `posts` above — no index buys anything here since the
    // sort key is a per-status resolved timestamp, not a single indexed column.
    const platformPosts = await ctx.db.query('platformPosts').order('desc').take(500);
    const events = await Promise.all(
      platformPosts.map(async (pp) => {
        const post = await ctx.db.get(pp.postId);
        const timestamp =
          pp.status === 'published' && pp.publishedAt !== undefined
            ? pp.publishedAt
            : pp.status === 'scheduled' && pp.scheduledFor !== undefined
              ? pp.scheduledFor
              : pp._creationTime;
        return {
          _id: pp._id,
          postId: pp.postId,
          platform: pp.platform,
          status: pp.status,
          url: pp.url,
          error: pp.error,
          scheduledFor: pp.scheduledFor,
          brief: post?.brief ?? '',
          timestamp,
        };
      })
    );
    return events.sort((a, b) => b.timestamp - a.timestamp);
  },
});

// STUB: rough proxy for per-platform connection status, driven by env-var presence only.
// Never imports or names the Composio SDK — the integrator should replace this with a real
// per-linked-account check once convex/lib/composio.ts exposes one.
export const getPlatformStatus = query({
  args: {},
  returns: v.object({
    bluesky: v.boolean(),
    linkedin: v.boolean(),
    youtube: v.boolean(),
  }),
  handler: async () => {
    return {
      bluesky: Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD),
      linkedin: Boolean(process.env.COMPOSIO_API_KEY),
      youtube: Boolean(process.env.COMPOSIO_API_KEY),
    };
  },
});

// Records one metrics poll for a published platform post. Called only from
// convex/analytics.ts's `refreshPostMetrics` action — every call inserts a new row rather than
// patching an existing one, so `postMetrics` keeps a full trajectory over time (spec-v1.md
// section 4 point 3), not just a single latest-value snapshot.
export const recordPostMetrics = mutation({
  args: {
    platformPostId: v.id('platformPosts'),
    platform: metricsPlatformValidator,
    likes: v.optional(v.number()),
    reposts: v.optional(v.number()),
    comments: v.optional(v.number()),
    views: v.optional(v.number()),
  },
  returns: v.id('postMetrics'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('postMetrics', { ...args, fetchedAt: Date.now() });
  },
});

// Aggregated view for AnalyticsScreen: a per-platform summary (post count + totals across
// whichever metrics that platform actually reports) plus a per-post breakdown list, each row
// carrying its most recently fetched metrics poll. Bounded the same way listTimelineEvents bounds
// `platformPosts` above — no index buys anything here since "published, has metrics" isn't a
// single indexed column combination.
export const getAnalyticsSummary = query({
  args: {},
  returns: v.object({
    byPlatform: v.array(
      v.object({
        platform: metricsPlatformValidator,
        postCount: v.number(),
        totalLikes: v.number(),
        totalReposts: v.number(),
        totalComments: v.number(),
        totalViews: v.number(),
      })
    ),
    posts: v.array(
      v.object({
        platformPostId: v.id('platformPosts'),
        postId: v.id('posts'),
        platform: metricsPlatformValidator,
        brief: v.string(),
        url: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
        likes: v.optional(v.number()),
        reposts: v.optional(v.number()),
        comments: v.optional(v.number()),
        views: v.optional(v.number()),
        fetchedAt: v.optional(v.number()),
      })
    ),
  }),
  handler: async (ctx) => {
    const platformPosts = await ctx.db.query('platformPosts').order('desc').take(500);
    const relevant = platformPosts.filter(
      (pp) => pp.status === 'published' && (pp.platform === 'bluesky' || pp.platform === 'facebook')
    );

    const rows = await Promise.all(
      relevant.map(async (pp) => {
        const post = await ctx.db.get(pp.postId);
        const latestMetrics = await ctx.db
          .query('postMetrics')
          .withIndex('by_platform_post', (q) => q.eq('platformPostId', pp._id))
          .order('desc')
          .first();

        return {
          platformPostId: pp._id,
          postId: pp.postId,
          platform: pp.platform as 'bluesky' | 'facebook',
          brief: post?.brief ?? '',
          url: pp.url,
          publishedAt: pp.publishedAt,
          likes: latestMetrics?.likes,
          reposts: latestMetrics?.reposts,
          comments: latestMetrics?.comments,
          views: latestMetrics?.views,
          fetchedAt: latestMetrics?.fetchedAt,
        };
      })
    );

    const byPlatformMap = new Map<
      'bluesky' | 'facebook',
      { postCount: number; totalLikes: number; totalReposts: number; totalComments: number; totalViews: number }
    >();
    for (const row of rows) {
      const entry = byPlatformMap.get(row.platform) ?? {
        postCount: 0,
        totalLikes: 0,
        totalReposts: 0,
        totalComments: 0,
        totalViews: 0,
      };
      entry.postCount += 1;
      entry.totalLikes += row.likes ?? 0;
      entry.totalReposts += row.reposts ?? 0;
      entry.totalComments += row.comments ?? 0;
      entry.totalViews += row.views ?? 0;
      byPlatformMap.set(row.platform, entry);
    }

    const byPlatform = Array.from(byPlatformMap.entries()).map(([platform, totals]) => ({
      platform,
      ...totals,
    }));

    rows.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

    return { byPlatform, posts: rows };
  },
});
