# Scheduling feature — build plan

Tier: real feature, no placeholders. Orchestrated (unlazy v2). Written while the Instagram/
Pinterest leaf is still mid-flight and actively editing `schema.ts` / `publishPost.ts` /
`generatePost.ts` / `checkSlop.ts` / `connections.ts` / `composio.ts` / `types.ts` / `theme.ts` /
`PlatformBadge.tsx` / `ComposeScreen.tsx` — none of the contracts below get implemented against
those files until that leaf commits, to avoid two agents racing writes to the same file on disk.
`HistoryScreen.tsx`, `ReviewScreen.tsx`, and net-new files are NOT touched by that leaf and are
safe to build against now.

## Goal

Let the user schedule a post for the future instead of publishing immediately, with full
flexibility: all selected platforms at once, one platform alone, or any subset (2-3) at a shared
time. Resolved design: this is ONE mechanism (a per-platform-post scheduled time), not three modes
— scheduling two platforms "at the same time" is just setting the same timestamp on both, which a
single "apply this time to every selected card" convenience action makes as easy as a dedicated
bulk mode would be, without three separate code paths to maintain.

## Contracts (locked — implement exactly this once the schema file is free)

### Schema addition (to `convex/schema.ts`, added AFTER the Instagram/Pinterest leaf's platform
union change lands — do not repeat or revert that change, only add the fields below to the
existing `platformPosts` table)

```ts
platformPosts: defineTable({
  // ...existing fields unchanged (postId, platform, generatedText, finalText, youtubeTitle,
  // slopFindings, status, url, error, publishedAt)...
  scheduledFor: v.optional(v.number()),      // epoch ms; present only when status === 'scheduled'
  scheduledFunctionId: v.optional(v.string()), // Convex scheduler job id, so a cancel can call ctx.scheduler.cancel()
}),
```

`status` union gains one literal: `v.literal('scheduled')`, inserted between `'approved'` and
`'publishing'` in the existing union (`draft | approved | scheduled | publishing | published |
failed`).

### `convex/schedulePost.ts` (new file)

```ts
export const schedulePlatformPosts = mutation({
  args: {
    // one timestamp per platformPostId being scheduled together — a caller doing "same time for
    // all" just passes the same value N times; this is the one mechanism covering every UI mode
    items: v.array(v.object({ platformPostId: v.id('platformPosts'), scheduledFor: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const item of args.items) {
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
```

Note `ctx.scheduler.runAt` returns a scheduled-function id (`Id<'_scheduled_functions'>`) —
confirm the exact return type against the installed `convex` package version before implementing;
do not assume without checking, same discipline as the Composio integration work.

### `convex/publishPost.ts` (extend, once free to edit)

Extract the existing per-platform dispatch body (currently inline in the `publishPost` action's
loop) into a standalone **internal** action so both the interactive publish path and the scheduled
path call the identical logic — no duplicated dispatch code:

```ts
export const publishScheduledPlatformPost = internalAction({
  args: { platformPostId: v.id('platformPosts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    // fetch the platformPost + its parent post, resolve media URL, call dispatch(), patch result
    // — identical body to one iteration of the existing publishPost loop, factored out so both
    // call sites (interactive publishPost action, and this scheduled one) share one implementation
  },
});
```

The public `publishPost` action keeps its current signature and behavior for immediate publishing
— scheduling is an alternative path into the same dispatch logic, not a replacement for it.

### Client UI contracts

- `src/screens/ReviewScreen.tsx`: each platform card gets a "Publish now" / "Schedule" segmented
  choice. Choosing Schedule reveals a date+time picker for that card. An "Apply this time to all
  selected cards" button copies one card's chosen time to every other card currently in Schedule
  mode — this single control is what satisfies "schedule for all platforms at the same time" and
  "two or three platforms at the same time" without separate UI modes. The existing "Publish to N
  platforms" button becomes "Publish / Schedule N platforms" and, per card, calls either the
  existing immediate-publish path or `schedulePlatformPosts` with that card's chosen time.
- `src/screens/HistoryScreen.tsx`: a `'scheduled'` status row shows the scheduled time (formatted,
  e.g. "Scheduled for Aug 31, 6:00 PM") instead of a generic status label, plus a "Cancel" action
  calling `cancelSchedule`.
- `src/components/StatusPill.tsx`: add a `scheduled` entry to `CONFIG` (icon: `calendar-clock`,
  a distinct color — reuse `color.info` since `color.warning`/`color.success`/`color.error` are
  already meaningfully claimed by other statuses).
- Date/time picker: use `@react-native-community/datetimepicker` (the standard Expo-compatible
  package, confirm current version compatible with Expo SDK 54 via `npx expo install` rather than
  a bare `npm install`, matching how every other native-module dependency in this project was
  added) — install this ONLY after confirming no other in-flight leaf is mid-`npm install`
  (check `git status` on `package.json`/`package-lock.json` first).

## Leaves (dispatch once the shared files above are free — check `git log` shows the Instagram/
Pinterest commit landed first)

| Leaf | Files | Depends on |
|---|---|---|
| Backend: schema addition + schedulePost.ts + publishPost.ts refactor | `convex/schema.ts`, `convex/schedulePost.ts` (new), `convex/publishPost.ts` | Instagram/Pinterest commit landed |
| ReviewScreen scheduling UI | `src/screens/ReviewScreen.tsx`, install datetimepicker | Backend leaf's exact function names (can start against the contract above, adjust if backend leaf's actual signature differs at merge) |
| HistoryScreen scheduled display + cancel | `src/screens/HistoryScreen.tsx`, `src/components/StatusPill.tsx` | Backend leaf's `cancelSchedule` signature |

StatusPill.tsx is shared between the ReviewScreen and HistoryScreen leaves' concerns but is a
small, additive, low-conflict edit (one new object key) — assign it to the HistoryScreen leaf
since that's where the cancel affordance also needs pill-adjacent UI, and have the ReviewScreen
leaf import it read-only.
