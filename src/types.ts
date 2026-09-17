import type { Doc } from '../convex/_generated/dataModel';

export type Platform = Doc<'platformPosts'>['platform'];
export type MediaType = Doc<'posts'>['mediaType'];
export type PlatformPostStatus = Doc<'platformPosts'>['status'];
export type SlopFinding = Doc<'platformPosts'>['slopFindings'][number];

export type Post = Doc<'posts'>;
export type PlatformPost = Doc<'platformPosts'>;

// The narrower platform set convex/lib/analytics.ts confirmed buildable for real post metrics —
// see that file's top comment for the platform-by-platform evidence. Deliberately not `Platform`
// (every platform this app can post to); this is only the ones it can also measure.
export type MetricsPlatform = Doc<'postMetrics'>['platform'];

export interface PostWithPlatformPosts extends Post {
  platformPosts: PlatformPost[];
}

export const PLATFORMS: Platform[] = [
  'bluesky',
  'linkedin',
  'youtube',
  'instagram',
  'pinterest',
  'facebook',
  'twitter',
  'threads',
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  facebook: 'Facebook',
  twitter: 'X (Twitter)',
  threads: 'Threads',
};

// Every platform except Bluesky needs an explicit "Connect" step (server-side auth broker, kept
// out of src/ entirely per the no-third-party-branding-in-the-UI rule) — deriving this from
// Platform instead of hand-listing it keeps ComposeScreen's connection-status types from
// drifting the next time a platform is added.
export type ConnectablePlatform = Exclude<Platform, 'bluesky'>;

// Platforms where checkSlop's hashtag ban is relaxed to "no generic hashtags" instead of
// "no hashtags at all" — see convex/checkSlop.ts and docs/spec-v0.md section 5 for why
// Instagram/Pinterest are the exception.
//
// Judgment call (Twitter/X and Threads, documented rather than silently decided): both platforms
// have real hashtag culture, but neither is anywhere near as discovery/hashtag-dependent as
// Instagram/Pinterest, where hashtags are a primary search mechanism. For the account this app is
// built for, tacking hashtags onto a tweet or a Threads post reads as noise, not reach — so both
// are left OUT of this list and stay under the universal anti-slop hashtag ban, matching
// LinkedIn/Bluesky/YouTube/Facebook rather than Instagram/Pinterest. Revisit if that account's
// actual usage pattern changes.
export const PLATFORMS_ALLOWING_HASHTAGS: Platform[] = ['instagram', 'pinterest'];

// Platforms listed for completeness but with no working publish path at all right now — not a
// setup gap (like Twitter/X needing the account owner's own Developer App), a real absence: no
// connector integration exists for Threads (checked against the full toolkit index of the
// service this app brokers connections through, not assumed). Connecting can never succeed, so
// both Compose and Accounts exclude these platforms entirely rather than offer a dead-end Connect
// button.
export const PLATFORMS_NOT_YET_AVAILABLE: Platform[] = ['threads'];
