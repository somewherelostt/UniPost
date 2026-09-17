"use node";

/**
 * Post-performance metrics fetchers for the platforms confirmed buildable in this pass — see
 * docs/spec-v1.md sections 2-4 for the original plan and constraint. That doc's own union was
 * `bluesky | youtube`; this file ships `bluesky | facebook` instead, based on evidence gathered
 * directly against this repo's data, not the doc's aspiration:
 *
 * - **Bluesky**: fully buildable. `lib/bluesky.ts`'s `publishToBluesky` stores a real
 *   `https://bsky.app/profile/<handle>/post/<rkey>` URL on `platformPosts.url`, and Bluesky's
 *   public AppView API (`public.api.bsky.app`) returns like/repost/reply counts for any post with
 *   no auth beyond resolving the handle to a DID — same zero-extra-credential shape spec-v1.md
 *   section 2 already described.
 *
 * - **Facebook**: buildable too, for a reason spec-v1.md didn't anticipate (it never considered
 *   Facebook, added to this project after that doc was written). Composio's Facebook toolkit has
 *   real analytics tools (`FACEBOOK_GET_POST_REACTIONS`, `FACEBOOK_GET_POST_INSIGHTS`,
 *   `FACEBOOK_GET_COMMENTS` — confirmed against docs.composio.dev/toolkits/facebook, fetched
 *   during this build), and — unlike every other Composio platform in this app —
 *   `composio.ts`'s `publishToFacebook` is guaranteed to leave a usable post id behind: its
 *   `extractFacebookUrl` helper falls back to constructing `https://www.facebook.com/<id>` from
 *   the raw `PageID_PostID` composite Facebook's Graph API returns, specifically because that
 *   toolkit's create-post tools don't return a permalink field. That fallback is exactly the
 *   `post_id` / `object_id` shape Facebook's reactions/comments edges expect, so it round-trips.
 *
 * - **YouTube**: NOT included, despite spec-v1.md wanting it and Composio genuinely having a
 *   working tool for it (`YOUTUBE_GET_VIDEO_DETAILS_BATCH`, confirmed against
 *   docs.composio.dev/toolkits/youtube — takes a batch of video ids, returns `statistics` with
 *   viewCount/likeCount/commentCount). The blocker is upstream of this file: `composio.ts`'s
 *   `publishToYouTube` returns `extractUrlFromResult(result.data)`, which only checks generic
 *   `url`/`link`/`permalink`/`permalink_url`/`postUrl`/`videoUrl` keys — none of which the YouTube
 *   Data API v3 upload response actually has (confirmed against the same docs page: the upload
 *   tool's response is the raw `videos.insert` payload, keyed by `id`/`snippet`/`status`, no url
 *   field at all). So `platformPosts.url` is never populated for a YouTube post today, and with no
 *   video id persisted anywhere else on `platformPosts` (schema changes to that table are out of
 *   scope for this task), there is nothing to hand `YOUTUBE_GET_VIDEO_DETAILS_BATCH` for any post
 *   published so far. This is a real, confirmed gap in `publishToYouTube`'s return value, not a
 *   missing Composio capability — fixing it means having that function capture
 *   `result.data.id` into a real `https://youtube.com/watch?v=<id>` URL, which is a one-line
 *   change to `composio.ts` this task could not make (two other agents are editing that file
 *   concurrently for unrelated bugs). Flagged here rather than silently worked around.
 *
 * - **LinkedIn**: excluded per spec-v1.md section 2's own already-established finding (personal
 *   post engagement sits behind LinkedIn's Marketing Developer Platform, not available here) —
 *   not re-litigated.
 *
 * - **Instagram / Pinterest / Twitter**: each has a real, confirmed Composio analytics tool
 *   (`INSTAGRAM_GET_IG_MEDIA_INSIGHTS`, `PINTEREST_GET_PIN_ANALYTICS` / `PINTEREST_GET_PIN`,
 *   `TWITTER_POST_LOOKUP_BY_POST_ID` — all confirmed against their respective
 *   docs.composio.dev/toolkits/<name> pages), but all three hit the same class of gap YouTube
 *   does, one level worse: none of `publishToInstagram`, `publishToPinterest`, or
 *   `publishToTwitter` in `composio.ts` has a guaranteed URL-reconstruction fallback the way
 *   Facebook's does — their create/publish tools' responses don't carry a url-shaped field either,
 *   so `extractUrlFromResult` returns `undefined` for these platforms too, with no fallback
 *   construction to recover a media/pin/tweet id from. Same root cause as YouTube, same fix
 *   location (each platform's publish function in `composio.ts` would need to persist its own
 *   media/pin/tweet id), same reason it's out of scope here.
 */
import { Composio } from '@composio/core';

export type MetricsResult = {
  likes?: number;
  reposts?: number;
  comments?: number;
  views?: number;
} | null;

const BLUESKY_PUBLIC_API = 'https://public.api.bsky.app';

function parseBlueskyPostUrl(url: string): { handle: string; rkey: string } | null {
  const match = url.match(/^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (!match) return null;
  return { handle: match[1], rkey: match[2] };
}

/**
 * Fetches like/repost/reply counts for a published Bluesky post from Bluesky's public,
 * unauthenticated AppView API. `postUrl` is the `https://bsky.app/profile/<handle>/post/<rkey>`
 * URL `lib/bluesky.ts`'s `publishToBluesky` already stores on `platformPosts.url`.
 */
export async function fetchBlueskyMetrics(postUrl: string): Promise<MetricsResult> {
  try {
    const parsed = parseBlueskyPostUrl(postUrl);
    if (!parsed) {
      console.error('[analytics] fetchBlueskyMetrics: could not parse handle/rkey from', postUrl);
      return null;
    }

    const resolveRes = await fetch(
      `${BLUESKY_PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(parsed.handle)}`
    );
    if (!resolveRes.ok) {
      console.error('[analytics] fetchBlueskyMetrics: resolveHandle failed', resolveRes.status);
      return null;
    }
    const resolved = (await resolveRes.json()) as { did?: string };
    if (!resolved.did) return null;

    const atUri = `at://${resolved.did}/app.bsky.feed.post/${parsed.rkey}`;
    const postsRes = await fetch(
      `${BLUESKY_PUBLIC_API}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(atUri)}`
    );
    if (!postsRes.ok) {
      console.error('[analytics] fetchBlueskyMetrics: getPosts failed', postsRes.status);
      return null;
    }
    const data = (await postsRes.json()) as {
      posts?: { likeCount?: number; repostCount?: number; replyCount?: number }[];
    };
    const post = data.posts?.[0];
    if (!post) return null;

    return {
      likes: post.likeCount ?? 0,
      reposts: post.repostCount ?? 0,
      comments: post.replyCount ?? 0,
    };
  } catch (error) {
    console.error('[analytics] fetchBlueskyMetrics failed:', error);
    return null;
  }
}

// Deliberately NOT imported from convex/lib/composio.ts, which two other agents are actively
// editing for unrelated LinkedIn/Pinterest bugs right now — this duplicates just the one-line
// client-init pattern documented there (`getComposioClient`) to stay fully decoupled from that
// file, per this task's own instruction.
function getAnalyticsComposioClient(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured');
  }
  return new Composio({ apiKey });
}

function getAnalyticsComposioUserId(): string {
  return process.env.COMPOSIO_USER_ID ?? 'default';
}

function parseFacebookPostId(url: string): string | null {
  // Matches the exact fallback shape composio.ts's `extractFacebookUrl` guarantees when the
  // create-post tool's response has no permalink field: `https://www.facebook.com/<PageID_PostID>`.
  const match = url.match(/^https:\/\/www\.facebook\.com\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Same defensive-field-name-search pattern composio.ts uses throughout (e.g.
 * `extractLinkedInAuthorUrn`, `extractInstagramUserId`) — Composio's tool-result payload shapes
 * aren't statically typed in this installed package, only confirmed via live docs, not a live
 * call (no COMPOSIO_API_KEY available during this build). Facebook's Graph API reactions edge
 * called with `summary=total_count` returns `{ data: [...], summary: { total_count } }`; this
 * checks that shape first and falls back to counting the raw `data` list.
 */
function extractSummaryTotal(data: Record<string, unknown>): number {
  const summary = data.summary as Record<string, unknown> | undefined;
  if (summary && typeof summary.total_count === 'number') {
    return summary.total_count;
  }
  const list = data.data;
  if (Array.isArray(list)) return list.length;
  return 0;
}

/**
 * Fetches reaction (as "likes") and comment counts for a published Facebook Page post via
 * Composio's `FACEBOOK_GET_POST_REACTIONS` and `FACEBOOK_GET_COMMENTS` tools. `postUrl` is the
 * `https://www.facebook.com/<PageID_PostID>` URL `composio.ts`'s `publishToFacebook` guarantees
 * (see this file's top comment). Never lets a raw Composio error or the word "Composio" reach the
 * caller, matching the hard rule every other Composio-touching module in this project follows.
 */
export async function fetchFacebookMetrics(postUrl: string): Promise<MetricsResult> {
  try {
    const postId = parseFacebookPostId(postUrl);
    if (!postId) {
      console.error('[analytics] fetchFacebookMetrics: could not parse post id from', postUrl);
      return null;
    }

    const composio = getAnalyticsComposioClient();
    const userId = getAnalyticsComposioUserId();

    const [reactionsResult, commentsResult] = await Promise.all([
      composio.tools.execute('FACEBOOK_GET_POST_REACTIONS', {
        userId,
        arguments: { post_id: postId, summary: 'total_count' },
        dangerouslySkipVersionCheck: true,
      }),
      composio.tools.execute('FACEBOOK_GET_COMMENTS', {
        userId,
        arguments: { object_id: postId, filter: 'stream' },
        dangerouslySkipVersionCheck: true,
      }),
    ]);

    if (!reactionsResult.successful && !commentsResult.successful) {
      console.error(
        '[analytics] fetchFacebookMetrics: both reactions and comments calls failed',
        reactionsResult.error,
        commentsResult.error
      );
      return null;
    }

    return {
      likes: reactionsResult.successful ? extractSummaryTotal(reactionsResult.data) : undefined,
      comments: commentsResult.successful ? extractSummaryTotal(commentsResult.data) : undefined,
    };
  } catch (error) {
    console.error('[analytics] fetchFacebookMetrics failed:', error);
    return null;
  }
}
