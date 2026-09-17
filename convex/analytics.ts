"use node";

// Manual "refresh" action for post analytics (docs/spec-v1.md section 4's ingestion step, without
// the cron — a background cron ingestion job is explicitly a nice-to-have for a later pass, not
// required here). Iterates every published platformPost on the platforms confirmed buildable in
// convex/lib/analytics.ts's top comment (bluesky, facebook), fetches fresh metrics, and records a
// new convex/schema.ts `postMetrics` row per successful fetch. Every poll is kept, not overwritten
// (matches spec-v1.md section 4 point 3), so AnalyticsScreen's per-post numbers always reflect the
// latest fetch via `getAnalyticsSummary`'s "most recent row" lookup.
import { action } from './_generated/server';
import { v } from 'convex/values';
import { api } from './_generated/api';
import { fetchBlueskyMetrics, fetchFacebookMetrics } from './lib/analytics';

const ANALYTICS_PLATFORMS = ['bluesky', 'facebook'] as const;
type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

function isAnalyticsPlatform(platform: string): platform is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(platform);
}

export const refreshPostMetrics = action({
  args: {},
  returns: v.object({
    updated: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx) => {
    const posts = await ctx.runQuery(api.queries.listPosts, {});

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const post of posts) {
      for (const platformPost of post.platformPosts as {
        _id: import('./_generated/dataModel').Id<'platformPosts'>;
        platform: string;
        status: string;
        url?: string;
      }[]) {
        if (platformPost.status !== 'published' || !platformPost.url || !isAnalyticsPlatform(platformPost.platform)) {
          skipped++;
          continue;
        }

        const metrics =
          platformPost.platform === 'bluesky'
            ? await fetchBlueskyMetrics(platformPost.url)
            : await fetchFacebookMetrics(platformPost.url);

        if (!metrics) {
          failed++;
          continue;
        }

        await ctx.runMutation(api.queries.recordPostMetrics, {
          platformPostId: platformPost._id,
          platform: platformPost.platform,
          ...metrics,
        });
        updated++;
      }
    }

    return { updated, skipped, failed };
  },
});
