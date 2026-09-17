"use node";

// Client-facing actions for the in-app "Connect" flow. LinkedIn/YouTube are Composio-backed
// (see lib/composio.ts); Bluesky needs no connection flow since it authenticates with a static
// handle + app password already set as Convex env vars.
import { action } from './_generated/server';
import { v } from 'convex/values';
import { disconnectToolkit, getConnectUrl, isToolkitConnected } from './lib/composio';

export const getPlatformConnectUrl = action({
  args: {
    platform: v.union(
      v.literal('linkedin'),
      v.literal('youtube'),
      v.literal('instagram'),
      v.literal('pinterest'),
      v.literal('facebook'),
      v.literal('twitter'),
      v.literal('threads')
    ),
  },
  returns: v.object({ url: v.optional(v.string()), error: v.optional(v.string()) }),
  handler: async (_ctx, args) => {
    // 'threads' is short-circuited here rather than passed into lib/composio.ts's getConnectUrl:
    // there is no Composio toolkit for Threads (verified, not assumed — see the comment above
    // TWITTER_TOOLKIT_SLUG in lib/composio.ts and docs/composio-setup.md's Threads section), so
    // there is no toolkit slug to authorize against in the first place.
    if (args.platform === 'threads') {
      return { error: 'Threads connection is not available yet' };
    }
    return getConnectUrl(args.platform);
  },
});

export const checkConnections = action({
  args: {},
  returns: v.object({
    linkedin: v.boolean(),
    youtube: v.boolean(),
    instagram: v.boolean(),
    pinterest: v.boolean(),
    facebook: v.boolean(),
    twitter: v.boolean(),
    threads: v.boolean(),
  }),
  handler: async () => {
    const [linkedin, youtube, instagram, pinterest, facebook, twitter] = await Promise.all([
      isToolkitConnected('linkedin'),
      isToolkitConnected('youtube'),
      isToolkitConnected('instagram'),
      isToolkitConnected('pinterest'),
      isToolkitConnected('facebook'),
      isToolkitConnected('twitter'),
    ]);
    // threads: always false — no Composio toolkit exists to check a connected account against
    // (see the comment in getPlatformConnectUrl above).
    return { linkedin, youtube, instagram, pinterest, facebook, twitter, threads: false };
  },
});

// The six Composio-backed platforms, shared by every action below that needs to loop over "every
// platform that could plausibly be connected or disconnected". Bluesky is never in this list — it
// authenticates via a static handle + app password in Convex env vars, not a Composio connection,
// so there is nothing to disconnect. Threads is never in this list either — no Composio toolkit
// exists for it (see the comment in getPlatformConnectUrl above), so it is handled as a fixed
// no-op wherever it needs a response at all.
const COMPOSIO_BACKED_PLATFORMS = ['linkedin', 'youtube', 'instagram', 'pinterest', 'facebook', 'twitter'] as const;

const disconnectablePlatform = v.union(
  v.literal('linkedin'),
  v.literal('youtube'),
  v.literal('instagram'),
  v.literal('pinterest'),
  v.literal('facebook'),
  v.literal('twitter'),
  v.literal('threads')
);

export const disconnectPlatform = action({
  args: { platform: disconnectablePlatform },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (_ctx, args) => {
    // Threads has no Composio toolkit to disconnect from — nothing was ever connected, so this is
    // a benign no-op rather than an error (same reasoning as getPlatformConnectUrl's short-circuit
    // above, mirrored for the opposite direction).
    if (args.platform === 'threads') {
      return { success: true };
    }
    return disconnectToolkit(args.platform);
  },
});

export const disconnectAllPlatforms = action({
  args: {},
  returns: v.object({ success: v.boolean(), errors: v.array(v.string()) }),
  handler: async () => {
    const results = await Promise.all(COMPOSIO_BACKED_PLATFORMS.map((platform) => disconnectToolkit(platform)));
    const errors = results.filter((result) => !result.success).map((result) => result.error ?? 'Unknown error');
    return { success: errors.length === 0, errors };
  },
});

// Data shape designed for a future where a platform can hold more than one connected account
// (see docs/spec-v1-postbridge-parity.md section 1, "Multiple accounts per platform"): an array of
// per-platform records, each holding its own `accounts` array, instead of a flat boolean map. Today
// Composio's fixed `getComposioUserId()` means at most one connected account per toolkit, so
// `accounts` is always empty (not connected) or holds exactly one entry (connected) — this is the
// seam where a future "add another account for this platform" action would append additional
// entries rather than requiring a shape change.
export const listConnections = action({
  args: {},
  returns: v.array(
    v.object({
      platform: v.union(
        v.literal('linkedin'),
        v.literal('youtube'),
        v.literal('instagram'),
        v.literal('pinterest'),
        v.literal('facebook'),
        v.literal('twitter')
      ),
      accounts: v.array(v.object({ label: v.string(), connected: v.boolean() })),
    })
  ),
  handler: async () => {
    const connectedFlags = await Promise.all(COMPOSIO_BACKED_PLATFORMS.map((platform) => isToolkitConnected(platform)));
    return COMPOSIO_BACKED_PLATFORMS.map((platform, index) => ({
      platform,
      accounts: connectedFlags[index] ? [{ label: 'Default', connected: true }] : [],
    }));
  },
});
