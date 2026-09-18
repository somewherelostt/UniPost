// New file per PLAN-scheduling.md. One mechanism covers every scheduling mode the UI offers —
// all platforms at once, one platform alone, or any subset at a shared time — because it's just
// a timestamp per platformPostId; "same time for several platforms" is the caller passing that
// same timestamp for each of them, not a separate code path.
import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

export const schedulePlatformPosts = mutation({
  args: {
    items: v.array(v.object({ platformPostId: v.id('platformPosts'), scheduledFor: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const item of args.items) {
      const existing = await ctx.db.get(item.platformPostId);
      if (existing?.scheduledFunctionId) {
        await ctx.scheduler.cancel(existing.scheduledFunctionId as Id<'_scheduled_functions'>);
      }
      const functionId = await ctx.scheduler.runAt(
        item.scheduledFor,
        internal.publishPost.publishScheduledPlatformPost,
        { platformPostId: item.platformPostId }
      );
      await ctx.db.patch(item.platformPostId, {
        status: 'scheduled',
        scheduledFor: item.scheduledFor,
        scheduledFunctionId: functionId,
      });
    }
    return null;
  },
});

export const cancelSchedule = mutation({
  args: { platformPostId: v.id('platformPosts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pp = await ctx.db.get(args.platformPostId);
    if (pp?.scheduledFunctionId) {
      await ctx.scheduler.cancel(pp.scheduledFunctionId as Id<'_scheduled_functions'>);
    }
    await ctx.db.patch(args.platformPostId, {
      status: 'approved',
      scheduledFor: undefined,
      scheduledFunctionId: undefined,
    });
    return null;
  },
});
