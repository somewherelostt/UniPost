"use node";

/**
 * Thin wrapper around the Composio SDK for the two platforms Composio replaces custom OAuth
 * for: LinkedIn and YouTube. See docs/composio-setup.md for the one-time CLI setup this depends
 * on, and gates/composio.md for the verification evidence behind the choices made here.
 *
 * Hard requirement (see docs/spec-v0.md section 6, "no Composio branding anywhere"): nothing
 * that reaches a caller of this module may contain the word "Composio", a Composio tool slug,
 * or a raw Composio error string. Every catch block below rewraps into a generic,
 * platform-level message before returning.
 */
import { Composio, ComposioToolNotFoundError } from '@composio/core';

export type PublishResult = { success: boolean; url?: string; error?: string };

const DEFAULT_COMPOSIO_USER_ID = 'default';

// The LinkedIn "who am I" tool's exact slug is resolved from Composio's live tool catalog
// (this installed SDK version ships no local tool catalog — see docs/composio-setup.md,
// "Why the tool catalog isn't in this repo"). `LINKEDIN_GET_MY_INFO` follows the toolkit's
// own naming convention (`LINKEDIN_CREATE_LINKED_IN_POST` -> toolkit `linkedin`), confirmed
// against the CLI's documented slug convention; the bare `GET_MY_INFO` name from the task
// brief is kept as a fallback in case the catalog uses the unprefixed form.
const LINKEDIN_INFO_TOOL_SLUGS = ['LINKEDIN_GET_MY_INFO', 'GET_MY_INFO'];
const LINKEDIN_POST_TOOL_SLUG = 'LINKEDIN_CREATE_LINKED_IN_POST';
const LINKEDIN_COMMENTARY_MAX_LENGTH = 3000;

// Fix for the live "Forbidden. You don't have permission to create posts." error: LinkedIn's own
// rules forbid combining `w_member_social` (required by LINKEDIN_CREATE_LINKED_IN_POST) with
// `r_organization_admin` on the same auth config (confirmed at docs.composio.dev/toolkits/linkedin,
// fetched during this investigation: "LinkedIn restricts certain scope combinations... `w_member_
// social` and `r_organization_admin` cannot be used together"). Composio's shared/default LinkedIn
// auth config's exact scope list isn't published, so whether it actually includes the conflicting
// scope can't be confirmed directly — but this doesn't require registering a custom LinkedIn
// Developer App to fix either way: Composio's managed auth explicitly supports a scope override
// while still using Composio's own pre-approved app (confirmed at
// docs.composio.dev/docs/authentication/controlling-scopes: "Pass a `scopes` field in `credentials`
// to override the defaults while still using Composio's managed OAuth app" — format is "a
// comma-separated string"). The list below mirrors LinkedIn's two self-serve, no-review products —
// "Sign In with LinkedIn using OpenID Connect" (openid, profile, email — keeps LINKEDIN_GET_MY_INFO's
// profile lookup working) and "Share on LinkedIn" (w_member_social) — deliberately omitting any
// organization/admin scope so the documented conflict cannot occur.
//
// UNVERIFIED, see docs/composio-setup.md's LinkedIn section: (1) Composio's docs don't publish the
// managed app's current default scopes, so this can't confirm the conflict theory is the exact root
// cause, only that this is the documented code-level way to pin an explicit, non-conflicting scope
// set. (2) Composio's docs are explicit that scope changes on an auth config "affect new connections
// only... [existing accounts] keep the scopes they already granted until they reconnect" — so this
// fix does nothing for the already-connected account until it is disconnected and reconnected via
// this app's Accounts tab. (3) If posting still fails after a fresh reconnect, that means Composio's
// own shared LinkedIn app isn't provisioned with the underlying LinkedIn product at all, and only
// then would a genuinely custom LinkedIn Developer App (see docs/composio-setup.md) be required.
const LINKEDIN_OAUTH_SCOPES = 'openid,profile,email,w_member_social';
const LINKEDIN_SCOPED_AUTH_CONFIG_NAME = 'UniPost LinkedIn (w_member_social, no org-admin)';

// Same situation for YouTube: try the more common slug first, fall back to the multipart
// variant if the account's toolkit version only exposes that one.
const YOUTUBE_UPLOAD_TOOL_SLUGS = ['YOUTUBE_UPLOAD_VIDEO', 'YOUTUBE_MULTIPART_UPLOAD_VIDEO'];
const YOUTUBE_TOOLKIT_SLUG = 'youtube';

// Instagram + Pinterest tool slugs, confirmed a different way than LinkedIn/YouTube's slugs
// were: this installed @composio/core@0.18.0 ships no tool catalog for ANY toolkit (confirmed
// by grepping node_modules/@composio/core for "instagram"/"pinterest" — zero matches, same gap
// docs/composio-setup.md already documents for LinkedIn/YouTube), so there was no local source
// to grep. Instead these slugs and argument names were read directly off Composio's live,
// dated documentation (docs.composio.dev/toolkits/instagram and /toolkits/pinterest, fetched
// during this build) rather than guessed from general web search results — the same
// "trust the real catalog over assumption" standard the LinkedIn/YouTube comments hold to,
// just against the hosted catalog instead of the package source since the package has none.
// Real per-account verification still requires `composio execute <slug> --get-schema` once a
// live COMPOSIO_API_KEY lands, exactly as docs/composio-setup.md already prescribes.
const INSTAGRAM_TOOLKIT_SLUG = 'instagram';
const INSTAGRAM_INFO_TOOL_SLUGS = ['INSTAGRAM_GET_USER_INFO'];
// Current method first, deprecated method as fallback — Composio marks INSTAGRAM_CREATE_POST /
// INSTAGRAM_CREATE_MEDIA_CONTAINER deprecated in favor of the IG_USER_MEDIA pair below, but an
// older-pinned toolkit version on the connected account may only expose the deprecated pair.
const INSTAGRAM_CREATE_CONTAINER_TOOL_SLUGS = ['INSTAGRAM_POST_IG_USER_MEDIA', 'INSTAGRAM_CREATE_MEDIA_CONTAINER'];
const INSTAGRAM_PUBLISH_TOOL_SLUGS = ['INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', 'INSTAGRAM_CREATE_POST'];
const INSTAGRAM_CAPTION_MAX_LENGTH = 2200; // Instagram's real caption limit

// Verified live against the connected account (ca__lxfPq4T4pAu) by fetching
// INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH's real tool schema via `composio.tools.get` during this
// investigation: the tool's own description says "This action automatically waits for the
// container to finish processing before publishing... it will automatically poll for FINISHED
// status" — so the polling Meta's docs describe (GET .../{container-id}?fields=status_code in a
// loop) happens inside Composio's tool, not in this file. `max_wait_seconds` below is the real,
// actively-used knob for that internal poll (schema: default 60, range 0-300, "for videos/reels,
// use at least 60 seconds (default) or higher"); it was already being passed correctly here, not
// vestigial as suspected — kept at the schema's own default.
const INSTAGRAM_PUBLISH_MAX_WAIT_SECONDS = 60;

// Confirmed live against INSTAGRAM_POST_IG_USER_MEDIA's real tool schema (fetched via
// `composio.tools.get` during this investigation, same source as the note above): the tool's
// `media_type` field is an enum of exactly `['REELS', 'CAROUSEL', 'STORIES']` — 'VIDEO' is not a
// member and the schema says outright "'VIDEO' is deprecated and no longer supported - use
// 'REELS' for all video content." This file previously sent `media_type: 'VIDEO'` for every video
// post, a value the live schema documents as rejected — this was the confirmed root cause of
// every video/Reels publish attempt failing. 'REELS' is Instagram's real modern container type
// for short-form video (feed "VIDEO" posts were merged into Reels by Meta in 2024+, matching the
// schema's own wording).
const INSTAGRAM_VIDEO_MEDIA_TYPE = 'REELS';

// Confirmed live off the same INSTAGRAM_POST_IG_USER_MEDIA schema fetch: the `caption` field's
// description reads "Use HTML URL encoding for hashtags (# becomes %23)." Meta's Graph API has
// historically parsed a raw, unencoded '#' in a query-string-style caption parameter as a URL
// fragment delimiter, silently truncating everything after it — a real caption-corruption bug
// this file's previous unencoded `caption.slice(...)` call was exposed to for any caption
// containing a hashtag, independent of the media_type bug above.
function encodeInstagramCaptionHashtags(caption: string): string {
  return caption.replaceAll('#', '%23');
}

// Confirmed live off the same INSTAGRAM_GET_USER_INFO call that returns `igUserId` below: Meta's
// real Instagram Graph API `account_type` field on the IG User node is one of `BUSINESS`,
// `MEDIA_CREATOR` (Creator), or `PERSONAL` — the connected account (ca__lxfPq4T4pAu) came back
// `MEDIA_CREATOR` during this investigation, confirming it over the API's own content-publishing
// eligibility gate rather than assuming it. `PERSONAL` accounts are rejected by Instagram's API
// itself before any container is ever created; catching that here produces a distinguishable,
// specific log line and user-facing error instead of letting it surface later as an opaque
// container-creation permission failure.
const INSTAGRAM_PUBLISHABLE_ACCOUNT_TYPES = new Set(['BUSINESS', 'MEDIA_CREATOR']);

const PINTEREST_TOOLKIT_SLUG = 'pinterest';
const PINTEREST_LIST_BOARDS_TOOL_SLUGS = ['PINTEREST_LIST_BOARDS'];
const PINTEREST_CREATE_PIN_TOOL_SLUGS = ['PINTEREST_CREATE_PIN'];
const PINTEREST_TITLE_MAX_LENGTH = 100;
const PINTEREST_DESCRIPTION_MAX_LENGTH = 500;

// Facebook tool slugs, confirmed the same way as Instagram/Pinterest's (this installed
// @composio/core@0.18.0 ships no tool catalog for ANY toolkit — see the Instagram comment above
// and docs/composio-setup.md's "Why the tool catalog isn't in this repo"). Read directly off
// Composio's live documentation (docs.composio.dev/toolkits/facebook, fetched during this build):
// toolkit slug `FACEBOOK`, 43 tools listed, OAuth2, "Managed App" (Composio's own pre-approved
// app) available. The docs are explicit that "Only supports Facebook Pages, not Facebook Personal
// accounts" for every posting tool below — Meta's Graph API requires Page-level permissions to
// publish, not personal-profile permissions, confirming the task's suspicion; this is enforced by
// Meta's API itself; `page_id` is a required argument on every create-post tool, not this repo's
// choice. Current tool first, deprecated tool as fallback, same pattern as YouTube/Instagram.
//
// Google Business Profile (formerly Google My Business) was checked next, per the task's
// instruction to verify existence before implementing anything: docs.composio.dev/toolkits lists
// 1411 toolkits total (fetched during this build) and none is named "Google Business Profile,"
// "Google My Business," or "GMB" — the only Google toolkits present are Ads, Analytics, Maps, and
// Search Console. Four guessed slug variants (`googlebusiness`, `google_business`, `gmb`,
// `googlemybusiness`) all 404 directly against docs.composio.dev/toolkits/<slug>. Conclusion: no
// Google Business Profile toolkit exists on Composio as of this build. Per the task, this is not
// implemented — no `publishToGoogleBusiness`, no toolkit slug, no schema literal for it.
const FACEBOOK_TOOLKIT_SLUG = 'facebook';
const FACEBOOK_CREATE_POST_TOOL_SLUGS = ['FACEBOOK_CREATE_POST'];
const FACEBOOK_CREATE_PHOTO_POST_TOOL_SLUGS = ['FACEBOOK_CREATE_PHOTO_POST', 'FACEBOOK_UPLOAD_PHOTO'];
const FACEBOOK_CREATE_VIDEO_POST_TOOL_SLUGS = ['FACEBOOK_CREATE_VIDEO_POST', 'FACEBOOK_UPLOAD_VIDEO'];
const FACEBOOK_LIST_PAGES_TOOL_SLUGS = ['FACEBOOK_LIST_MANAGED_PAGES', 'FACEBOOK_GET_USER_PAGES'];

// Twitter/X tool slugs, confirmed the same way as Instagram/Pinterest/Facebook's: this installed
// @composio/core@0.18.0 ships no local catalog for this toolkit either (same "grep comes up
// empty" result as every toolkit above — confirmed by grepping node_modules/@composio/core for
// "twitter"; zero matches). Read directly off Composio's live docs
// (docs.composio.dev/toolkits/twitter, fetched during this build): toolkit slug `TWITTER`
// (Composio's docs display it uppercase; kept lowercase below to match this file's established
// convention for every other toolkit's `TOOLKIT_SLUG` entry, e.g. `linkedin`/`youtube`), post
// tool `TWITTER_CREATION_OF_A_POST` (fields include `text` and `media_media_ids`), media tool
// `TWITTER_UPLOAD_MEDIA`.
//
// IMPORTANT, verified not assumed (full trail in docs/composio-setup.md's Twitter/X section):
// Composio removed its managed/shared credentials for Twitter as of February 2026, following X's
// own move to pay-per-use API pricing ($0.015 per post created as of this build, on top of
// whatever Composio itself charges — a real per-post cost at the underlying platform level that
// none of the other four platforms in this file have). Every other toolkit here uses Composio's
// own pre-approved developer app; Twitter is the one exception where the account owner must first
// create their own X Developer App and register it as a custom Auth Config in Composio's
// dashboard (composio.dev/auth/twitter) before `composio link twitter` or this app's in-app
// "Connect" flow does anything. `getConnectUrl`/`isToolkitConnected` below still work identically
// for Twitter at the code level, since Composio remains the OAuth broker either way, but the
// zero-developer-console pitch in docs/spec-v0.md section 6 does not fully hold for this one
// platform — that section has been updated to say so rather than left silently wrong.
const TWITTER_TOOLKIT_SLUG = 'twitter';
const TWITTER_POST_TOOL_SLUG = 'TWITTER_CREATION_OF_A_POST';
const TWITTER_UPLOAD_MEDIA_TOOL_SLUGS = ['TWITTER_UPLOAD_MEDIA'];
const TWITTER_TEXT_MAX_LENGTH = 280; // standard-tier limit; generatePost.ts's shared Bluesky-style instruction already targets well under this

// Threads (Meta's threads.net app) was checked the same way as every toolkit above, and the
// answer is different in kind, not just degree: docs.composio.dev/toolkits/threads returns a
// live 404, and the full toolkit index (docs.composio.dev/toolkits — 1,355+ entries as of this
// build, fetched during this build) has no toolkit named "Threads," "Meta Threads," or any slug
// variant of either; only Instagram appears among Meta's apps in that index. A general web search
// turned up nothing beyond confirming Meta's own separate Threads API exists
// (graph.threads.net, gated by Tech Provider Verification) — Composio has simply not built an
// integration for it yet. This is NOT the same situation as Instagram's Meta App Review gap (a
// real toolkit with a review wall that might still work); there is no toolkit to call at all.
// Every other toolkit in this file, however uncertain on exact argument names, is at least
// confirmed to exist; fabricating a Threads tool slug that has never been confirmed anywhere
// would break that standard, so `publishToThreads` below is left honestly unimplemented instead
// of guessing. See docs/composio-setup.md's Threads section for the full trail and what would
// need to change for this to become real.

function getComposioClient(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured');
  }
  return new Composio({ apiKey });
}

function getComposioUserId(): string {
  return process.env.COMPOSIO_USER_ID ?? DEFAULT_COMPOSIO_USER_ID;
}

// 'threads' is deliberately excluded from this type — see the comment above this section's
// Threads constants block: no Composio toolkit exists for it, so there is no slug to authorize
// or check a connected account against. convex/connections.ts special-cases 'threads' before it
// ever reaches `getConnectUrl`/`isToolkitConnected` below.
type ComposioToolkit = 'linkedin' | 'youtube' | 'instagram' | 'pinterest' | 'facebook' | 'twitter';

const TOOLKIT_SLUG: Record<ComposioToolkit, string> = {
  linkedin: 'linkedin',
  youtube: YOUTUBE_TOOLKIT_SLUG,
  instagram: INSTAGRAM_TOOLKIT_SLUG,
  pinterest: PINTEREST_TOOLKIT_SLUG,
  facebook: FACEBOOK_TOOLKIT_SLUG,
  twitter: TWITTER_TOOLKIT_SLUG,
};

/**
 * Finds (or creates, on first call) the dedicated, scope-overridden LinkedIn auth config described
 * above the `LINKEDIN_OAUTH_SCOPES` constant, so `getConnectUrl` can request exactly
 * `openid,profile,email,w_member_social` instead of whatever this account's shared default
 * LinkedIn auth config currently requests. Still `type: 'use_composio_managed_auth'` — Composio's
 * own pre-approved LinkedIn app, not a custom developer app.
 */
async function getOrCreateLinkedInAuthConfigId(composio: Composio): Promise<string> {
  const existingConfigs = await composio.authConfigs.list({ toolkit: TOOLKIT_SLUG.linkedin });
  const existing = existingConfigs.items.find(item => item.name === LINKEDIN_SCOPED_AUTH_CONFIG_NAME);
  if (existing) {
    return existing.id;
  }
  const created = await composio.authConfigs.create(TOOLKIT_SLUG.linkedin, {
    type: 'use_composio_managed_auth',
    name: LINKEDIN_SCOPED_AUTH_CONFIG_NAME,
    credentials: { scopes: LINKEDIN_OAUTH_SCOPES },
  });
  return created.id;
}

/**
 * Starts an OAuth connection for the given toolkit and returns the URL the user completes it in.
 * This is the in-app "Connect" flow — the app opens `url` in the phone's browser, the user
 * approves LinkedIn/YouTube access there (Composio's own hosted consent screen, using Composio's
 * pre-approved developer app), and returns to UniPost once done. No CLI required for the account
 * owner to link a platform. LinkedIn is special-cased to authorize against the scope-corrected auth
 * config from `getOrCreateLinkedInAuthConfigId` above rather than whatever default config Composio
 * would otherwise pick — see the comment above `LINKEDIN_OAUTH_SCOPES` for why.
 */
export async function getConnectUrl(
  toolkit: ComposioToolkit
): Promise<{ url?: string; error?: string }> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();
    const authConfigId =
      toolkit === 'linkedin' ? await getOrCreateLinkedInAuthConfigId(composio) : undefined;
    const request = await composio.toolkits.authorize(userId, TOOLKIT_SLUG[toolkit], authConfigId);
    if (!request.redirectUrl) {
      logComposioFailure(`getConnectUrl:${toolkit}`, 'authorize() returned no redirectUrl');
      return { error: `Could not start the ${toolkit} connection` };
    }
    return { url: request.redirectUrl };
  } catch (error) {
    logComposioFailure(`getConnectUrl:${toolkit}`, error);
    return { error: `Could not start the ${toolkit} connection` };
  }
}

/**
 * Checks whether an ACTIVE connected account exists for the given toolkit — the real signal
 * behind the Connected/Not connected chip in ComposeScreen, replacing a mere env-var presence
 * check with an actual account-linked check.
 */
export async function isToolkitConnected(toolkit: ComposioToolkit): Promise<boolean> {
  try {
    if (!process.env.COMPOSIO_API_KEY) return false;
    const composio = getComposioClient();
    const userId = getComposioUserId();
    const result = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [TOOLKIT_SLUG[toolkit]],
      statuses: ['ACTIVE'],
    });
    return result.items.length > 0;
  } catch (error) {
    logComposioFailure(`isToolkitConnected:${toolkit}`, error);
    return false;
  }
}

/**
 * Removes the ACTIVE connected account for the given toolkit, permanently revoking that OAuth
 * connection. Looks the account up via the same `connectedAccounts.list()` call
 * `isToolkitConnected` already makes (there is no lookup-by-toolkit-slug delete on the SDK — only
 * `connectedAccounts.delete(id)`, keyed on the connected account's own id), then deletes it.
 * No connected account found is treated as a benign no-op (`{ success: true }`) rather than an
 * error, since the end state the caller wants — this toolkit not connected — already holds.
 */
export async function disconnectToolkit(toolkit: ComposioToolkit): Promise<{ success: boolean; error?: string }> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();
    const result = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [TOOLKIT_SLUG[toolkit]],
      statuses: ['ACTIVE'],
    });
    const connectedAccount = result.items[0];
    if (!connectedAccount) {
      return { success: true };
    }
    await composio.connectedAccounts.delete(connectedAccount.id);
    return { success: true };
  } catch (error) {
    logComposioFailure(`disconnectToolkit:${toolkit}`, error);
    return { success: false, error: `Could not disconnect ${toolkit}` };
  }
}

/**
 * Logs full operational detail server-side only. Never let the return value of this function's
 * caller forward `error` itself to a Convex client — that's the one place a raw Composio error
 * (which can contain the word "Composio", a tool slug, or backend error text) could leak.
 */
function logComposioFailure(context: string, error: unknown): void {
  console.error(`[composio] ${context} failed:`, error);
}

/**
 * Executes a Composio tool, trying each candidate slug in order and moving to the next only
 * when the current one doesn't exist for this account's toolkit version
 * (`ComposioToolNotFoundError`). Any other error (auth, validation, execution failure) is
 * rethrown immediately rather than masked by a fallback attempt.
 */
async function executeToolWithFallback(
  composio: Composio,
  slugs: string[],
  params: { userId: string; arguments: Record<string, unknown> }
) {
  let lastError: unknown;
  for (const slug of slugs) {
    try {
      // dangerouslySkipVersionCheck: this app doesn't pin toolkitVersions (hackathon scope),
      // so `version` resolves to "latest" and the SDK requires an explicit opt-in to proceed
      // without pinning — see the SDK's ToolExecuteParams docs (confirmed in
      // node_modules/@composio/core/src/composio.ts's `toolkitVersions` doc comment).
      return await composio.tools.execute(slug, {
        ...params,
        dangerouslySkipVersionCheck: true,
      });
    } catch (error) {
      lastError = error;
      if (error instanceof ComposioToolNotFoundError) {
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No tool slug matched: ${slugs.join(', ')}`);
}

/**
 * The GET_MY_INFO-equivalent tool's response shape isn't statically typed in the installed
 * package (tool schemas are fetched from Composio's backend at call time). This checks the
 * field names LinkedIn's identity APIs commonly use and accepts either a bare id or an
 * already-formed `urn:li:person:...` value.
 */
const LINKEDIN_INVALID_ID_SENTINELS = new Set(['private', 'restricted', 'redacted']);

function extractLinkedInAuthorUrnFromInfo(data: Record<string, unknown>): string | undefined {
  const candidateKeys = ['urn', 'author', 'sub', 'id', 'person_id', 'personId'];
  for (const key of candidateKeys) {
    const value = data[key];
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      !LINKEDIN_INVALID_ID_SENTINELS.has(value.toLowerCase())
    ) {
      return value.startsWith('urn:li:person:') ? value : `urn:li:person:${value}`;
    }
  }
  return undefined;
}

/**
 * LINKEDIN_GET_MY_INFO calls LinkedIn's legacy /v2/me endpoint, which — under the
 * OpenID-Connect-only scopes this app requests (openid, profile, email, w_member_social; no
 * legacy r_liteprofile) — returns the literal string "private" for `id` instead of a real
 * member id (confirmed live against a real connected account: LINKEDIN_GET_MY_INFO returned
 * `{"id":"private",...}`). Posting with that value builds an invalid
 * `urn:li:person:private`, which LinkedIn's Posts API rejects with "Forbidden. You don't have
 * permission to create posts." — a confusing error that looks like a scope problem but is
 * actually just a garbage author URN. The real member id is the OIDC `sub` claim from
 * LinkedIn's own `/v2/userinfo` endpoint (confirmed live: returns a real, usable `sub`), which
 * no Composio tool exposes directly — so it's fetched here via Composio's raw HTTP proxy
 * (`tools.proxyExecute`) against the same connected account, used only as a fallback when the
 * normal info-tool path doesn't yield a usable id.
 */
async function resolveLinkedInAuthorUrn(
  composio: Composio,
  userId: string,
  infoData: Record<string, unknown>
): Promise<string> {
  const fromInfoTool = extractLinkedInAuthorUrnFromInfo(infoData);
  if (fromInfoTool) {
    return fromInfoTool;
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: ['linkedin'],
    statuses: ['ACTIVE'],
  });
  const connectedAccountId = accounts.items?.[0]?.id;
  if (!connectedAccountId) {
    throw new Error('No active LinkedIn connection found to resolve the author id from');
  }

  const userInfo = await composio.tools.proxyExecute({
    connectedAccountId,
    endpoint: '/v2/userinfo',
    method: 'GET',
  });
  const sub = (userInfo.data as Record<string, unknown> | undefined)?.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('Could not determine the LinkedIn author id from either profile lookup path');
  }
  return `urn:li:person:${sub}`;
}

/**
 * Best-effort extraction of a shareable URL from a tool's response payload. Returns undefined
 * (the contract's `url` is optional) rather than guessing at a URL shape the payload doesn't
 * actually contain.
 */
function extractUrlFromResult(data: Record<string, unknown>): string | undefined {
  for (const key of ['url', 'link', 'permalink', 'permalink_url', 'postUrl', 'videoUrl']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Builds the "View post" permalink from a LinkedIn post creation response.
 *
 * `extractUrlFromResult`'s generic key list (url/link/permalink/...) never matches here — confirmed
 * live: a real published LinkedIn post's stored `platformPosts` row had no `url` field at all. Root
 * cause: LinkedIn's `POST /rest/posts` API returns 201 Created with the new post's URN in the
 * `x-restli-id` response header, not a generic URL field in the body (standard LinkedIn REST API
 * behavior, not documented in Composio's own toolkit docs page).
 *
 * The fix does not require switching off `tools.execute()` (which would lose the schema-driven
 * `images` staging added above) or moving to `proxyExecute` to read raw headers ourselves: fetching
 * this tool's own output schema (`composio.tools.getRawComposioTools({ tools:
 * ['LINKEDIN_CREATE_LINKED_IN_POST'] }).outputParameters.$defs.CreateLinkedInPostResponse`,
 * confirmed live against this account) shows Composio's backend already reads that header for us —
 * `x_restli_id` is the response schema's ONLY `required` field, documented exactly as: "Contains the
 * Post ID URN in the format urn:li:share:{ID} or urn:li:ugcPost:{ID}. This is the primary identifier
 * returned when creating a post." So it always lands in `postResult.data.x_restli_id`, independent of
 * whether LinkedIn's raw response body is empty. `data.id` (present when LinkedIn's `$returnEntity`
 * default returns the full entity in the body too) is kept as a fallback in the same urn format.
 *
 * `https://www.linkedin.com/feed/update/<urn>/` is LinkedIn's standard public permalink pattern for
 * both urn:li:share and urn:li:ugcPost ids — the same pattern LinkedIn's own "Copy link to post"
 * produces.
 */
function extractLinkedInPostUrl(data: Record<string, unknown>): string | undefined {
  for (const key of ['x_restli_id', 'id']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return `https://www.linkedin.com/feed/update/${value}/`;
    }
  }
  return undefined;
}

/**
 * Publishes a text post to LinkedIn via Composio's LINKEDIN_CREATE_LINKED_IN_POST tool, with an
 * optional image attachment. `LINKEDIN_CREATE_LINKED_IN_POST`'s `images` argument (confirmed live
 * against this account's tool schema via `composio.tools.get('default', { tools:
 * ['LINKEDIN_CREATE_LINKED_IN_POST'] })`) takes an array of `FileUploadable` descriptors
 * (`{name, mimetype, s3key}`, `file_uploadable: true`, up to 20) — the exact same shape
 * `composio.files.upload()` already returns (its `FileUploadData` return type is `{name,
 * mimetype, s3key}`, see `node_modules/@composio/core/src/types/files.types.ts`), so this follows
 * `publishToYouTube`'s staging pattern: `composio.files.upload({ file: url, toolSlug,
 * toolkitSlug })` turns a fetchable Convex storage URL into a staged descriptor with no local
 * fetch/buffer step, then that descriptor is passed straight through as `images: [staged]`.
 * `mediaUrl` is optional — LinkedIn, like Bluesky/Facebook/Twitter, allows text-only posts.
 * Requires a LinkedIn account already linked via `composio link linkedin` (see
 * docs/composio-setup.md).
 */
export async function publishToLinkedIn(text: string, mediaUrl?: string): Promise<PublishResult> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();

    const infoResult = await executeToolWithFallback(composio, LINKEDIN_INFO_TOOL_SLUGS, {
      userId,
      arguments: {},
    });
    if (!infoResult.successful) {
      logComposioFailure('LinkedIn profile lookup', infoResult.error);
      return { success: false, error: 'Could not publish to LinkedIn' };
    }

    const authorUrn = await resolveLinkedInAuthorUrn(composio, userId, infoResult.data);

    const postArgs: Record<string, unknown> = {
      author: authorUrn,
      commentary: text.slice(0, LINKEDIN_COMMENTARY_MAX_LENGTH),
      visibility: 'PUBLIC',
    };
    if (mediaUrl) {
      const stagedImage = await composio.files.upload({
        file: mediaUrl,
        toolSlug: LINKEDIN_POST_TOOL_SLUG,
        toolkitSlug: TOOLKIT_SLUG.linkedin,
      });
      postArgs.images = [stagedImage];
    }

    const postResult = await executeToolWithFallback(composio, [LINKEDIN_POST_TOOL_SLUG], {
      userId,
      arguments: postArgs,
    });
    if (!postResult.successful) {
      logComposioFailure('LinkedIn post creation', postResult.error);
      return { success: false, error: 'Could not publish to LinkedIn' };
    }

    return { success: true, url: extractLinkedInPostUrl(postResult.data) };
  } catch (error) {
    logComposioFailure('publishToLinkedIn', error);
    return { success: false, error: 'Could not publish to LinkedIn' };
  }
}

/**
 * Publishes a video to YouTube via Composio's video-upload tool, set to `unlisted` visibility
 * (safer default than public for a hackathon demo). `videoUrl` must be a URL the Composio
 * backend can fetch (a Convex file-storage URL works); `composio.files.upload()` accepts a URL
 * directly and stages it with Composio, so this module never downloads the video bytes itself.
 * Requires a YouTube account already linked via `composio link youtube` (see
 * docs/composio-setup.md).
 */
export async function publishToYouTube(
  title: string,
  description: string,
  videoUrl: string
): Promise<PublishResult> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();

    let lastError: unknown;
    for (const toolSlug of YOUTUBE_UPLOAD_TOOL_SLUGS) {
      try {
        // Stage the remote video with Composio's file store. `file` accepts a fetchable URL
        // (confirmed in node_modules/@composio/core/src/models/Files.node.ts's `upload()` doc
        // comment: "params.file - The path to the file to upload, a URL of the file, or a File
        // object"), so no local fetch/buffer step is needed here.
        const stagedVideo = await composio.files.upload({
          file: videoUrl,
          toolSlug,
          toolkitSlug: YOUTUBE_TOOLKIT_SLUG,
        });

        const result = await composio.tools.execute(toolSlug, {
          userId,
          arguments: {
            video: stagedVideo,
            title,
            description,
            privacyStatus: 'unlisted',
          },
          dangerouslySkipVersionCheck: true,
        });

        if (!result.successful) {
          logComposioFailure('YouTube upload', result.error);
          return { success: false, error: 'Could not publish to YouTube' };
        }

        return { success: true, url: extractUrlFromResult(result.data) };
      } catch (error) {
        lastError = error;
        if (error instanceof ComposioToolNotFoundError) {
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`No YouTube upload tool slug matched: ${YOUTUBE_UPLOAD_TOOL_SLUGS.join(', ')}`);
  } catch (error) {
    logComposioFailure('publishToYouTube', error);
    return { success: false, error: 'Could not publish to YouTube' };
  }
}

/**
 * Same shape as `extractLinkedInAuthorUrn` — the Instagram Business Account id isn't statically
 * typed either, so this checks the field names INSTAGRAM_GET_USER_INFO's response commonly uses.
 */
function extractInstagramUserId(data: Record<string, unknown>): string {
  const candidateKeys = ['ig_user_id', 'id', 'user_id', 'userId'];
  for (const key of candidateKeys) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  throw new Error('Could not determine the Instagram business account id from the profile lookup response');
}

/**
 * Reads the profile lookup's `account_type` field (see `INSTAGRAM_PUBLISHABLE_ACCOUNT_TYPES`
 * above for the confirmed-live field values) and returns it verbatim, or `undefined` if the
 * response doesn't carry one. Kept separate from `extractInstagramUserId` so a missing/unknown
 * account type degrades to "can't confirm eligibility" rather than blocking the id lookup.
 */
function extractInstagramAccountType(data: Record<string, unknown>): string | undefined {
  const value = data.account_type ?? data.accountType;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Extracts the media container id a create-container call returns, for the publish step. */
function extractContainerId(data: Record<string, unknown>): string {
  const candidateKeys = ['creation_id', 'id', 'container_id', 'containerId'];
  for (const key of candidateKeys) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  throw new Error('Could not determine the Instagram media container id from the creation response');
}

/**
 * Instagram's container-creation tool needs to know whether to set `image_url` or `video_url`
 * (they are different arguments, not one field with a type flag). `publishToInstagram` now takes
 * an explicit `mediaType` from the post's own schema field (see `publishPost.ts`'s `dispatch()`),
 * so this HEAD-request sniff is only a defensive fallback for the case where that hint is missing
 * or `'none'` despite a media URL being present — it should not be hit in normal operation.
 * Convex storage URLs have no file extension (`ctx.storage.getUrl()` returns an opaque
 * `/api/storage/<id>` path), so this issues a HEAD request and reads the real `Content-Type`.
 * Defaults to 'image' if the request fails, since a stalled HEAD request shouldn't block the
 * whole publish attempt.
 */
async function detectInstagramMediaKindByContentType(mediaUrl: string): Promise<'image' | 'video'> {
  try {
    const response = await fetch(mediaUrl, { method: 'HEAD' });
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.startsWith('video/') ? 'video' : 'image';
  } catch {
    return 'image';
  }
}

/** Prefers the app's own tracked `mediaType`; falls back to content-type sniffing (see above). */
async function resolveInstagramMediaKind(
  mediaUrl: string,
  mediaType: 'none' | 'image' | 'video'
): Promise<'image' | 'video'> {
  if (mediaType === 'image' || mediaType === 'video') {
    return mediaType;
  }
  return detectInstagramMediaKindByContentType(mediaUrl);
}

/**
 * Publishes a feed post, image Reel-eligible video, or Reel to Instagram via Composio's two-step
 * container flow: create a media container (image or video/Reels), then publish it. Instagram has
 * no text-only post type, so this always requires `mediaUrl` — enforced by the caller (see
 * publishPost.ts's dispatch, which returns an error before this function is ever called if no
 * media was attached). Requires an Instagram **Business or Creator** account linked via
 * `composio link instagram` (see docs/composio-setup.md — personal accounts are rejected by
 * Instagram's own API, not by this code); confirmed eligible live below rather than assumed.
 */
export async function publishToInstagram(
  caption: string,
  mediaUrl: string,
  mediaType: 'none' | 'image' | 'video'
): Promise<PublishResult> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();

    const infoResult = await executeToolWithFallback(composio, INSTAGRAM_INFO_TOOL_SLUGS, {
      userId,
      arguments: {},
    });
    if (!infoResult.successful) {
      logComposioFailure('Instagram profile lookup: tool call unsuccessful', infoResult.error ?? infoResult.data);
      return { success: false, error: 'Could not publish to Instagram' };
    }
    const igUserId = extractInstagramUserId(infoResult.data);

    const accountType = extractInstagramAccountType(infoResult.data);
    if (accountType !== undefined && !INSTAGRAM_PUBLISHABLE_ACCOUNT_TYPES.has(accountType)) {
      // Distinct from every other failure branch below: this is an account-eligibility problem,
      // not a code bug or a transient API failure — no retry or code change fixes it, the
      // Instagram account itself must be converted to Business or Creator (Settings > Account
      // type) before publishing can ever succeed.
      logComposioFailure(`Instagram profile lookup: account type '${accountType}' is not eligible for content publishing`, accountType);
      return { success: false, error: 'Instagram account must be a Business or Creator account to publish' };
    }

    const mediaKind = await resolveInstagramMediaKind(mediaUrl, mediaType);
    const containerArgs: Record<string, unknown> = {
      ig_user_id: igUserId,
      caption: encodeInstagramCaptionHashtags(caption.slice(0, INSTAGRAM_CAPTION_MAX_LENGTH)),
    };
    if (mediaKind === 'video') {
      containerArgs.video_url = mediaUrl;
      containerArgs.media_type = INSTAGRAM_VIDEO_MEDIA_TYPE;
    } else {
      containerArgs.image_url = mediaUrl;
    }

    const containerResult = await executeToolWithFallback(composio, INSTAGRAM_CREATE_CONTAINER_TOOL_SLUGS, {
      userId,
      arguments: containerArgs,
    });
    if (!containerResult.successful) {
      logComposioFailure(`Instagram container creation (${mediaKind}): tool call unsuccessful`, containerResult.error ?? containerResult.data);
      return { success: false, error: 'Could not publish to Instagram' };
    }
    const creationId = extractContainerId(containerResult.data);

    const publishResult = await executeToolWithFallback(composio, INSTAGRAM_PUBLISH_TOOL_SLUGS, {
      userId,
      arguments: {
        ig_user_id: igUserId,
        creation_id: creationId,
        max_wait_seconds: INSTAGRAM_PUBLISH_MAX_WAIT_SECONDS,
      },
    });
    if (!publishResult.successful) {
      // The tool's own schema documents error 9007 ("media not ready") as the specific signal
      // for "the container was still processing when max_wait_seconds ran out" — surfaced as its
      // own log line so a real processing timeout (raise INSTAGRAM_PUBLISH_MAX_WAIT_SECONDS, or
      // retry) is distinguishable from every other publish-step API failure.
      const errorText = JSON.stringify(publishResult.error ?? publishResult.data ?? '');
      const isProcessingTimeout = errorText.includes('9007') || /still processing|not ready|in progress/i.test(errorText);
      logComposioFailure(
        isProcessingTimeout
          ? 'Instagram publish: container still processing after max_wait_seconds'
          : 'Instagram publish: tool call unsuccessful',
        publishResult.error ?? publishResult.data
      );
      return { success: false, error: 'Could not publish to Instagram' };
    }

    return { success: true, url: extractUrlFromResult(publishResult.data) };
  } catch (error) {
    logComposioFailure('publishToInstagram', error);
    return { success: false, error: 'Could not publish to Instagram' };
  }
}

/**
 * Pulls the first board id out of a PINTEREST_LIST_BOARDS response.
 *
 * Field name confirmed, not guessed: Pinterest's own API v5 OpenAPI spec
 * (github.com/pinterest/api-description, `GET /boards` operation, fetched during this
 * investigation) documents the response body as `{ bookmark: string | null, items: Board[] }` —
 * a flat, required `items` array at the top level, no extra wrapping layer. The installed
 * `@composio/core@0.18.0`'s `ToolExecuteResponse.data` type is `Record<string, unknown>` (see
 * `node_modules/@composio/core/dist/customTool.types-*.d.mts`'s `ToolExecuteResponseSchema`),
 * meaning `data` carries the toolkit's raw API response through unchanged rather than nesting it
 * further — so `result.data.items` is the confirmed-correct path, matching the first candidate
 * this function already checked. `boards`/`data` are kept as defensive fallbacks only, in case a
 * future toolkit version changes shape. Each `Board.id` (the spec's example: `'549755885175'`) is
 * a plain top-level string field, matching `first?.id` below.
 *
 * Returns a discriminated outcome instead of a bare `string | undefined` so the caller can log —
 * and eventually surface to the end user — "this account has zero boards" as a distinct case from
 * "the response didn't look like a board list at all," rather than collapsing both into one silent
 * `undefined`.
 */
type PinterestBoardListOutcome =
  | { kind: 'found'; boardId: string }
  | { kind: 'empty' }
  | { kind: 'unrecognized-shape' };

function resolveBoardIdFromListResult(data: Record<string, unknown>): PinterestBoardListOutcome {
  const list = (data.items ?? data.boards ?? data.data) as unknown;
  if (!Array.isArray(list)) {
    return { kind: 'unrecognized-shape' };
  }
  if (list.length === 0) {
    return { kind: 'empty' };
  }
  const first = list[0] as Record<string, unknown> | undefined;
  const id = first?.id;
  if (typeof id === 'string' && id.length > 0) {
    return { kind: 'found', boardId: id };
  }
  return { kind: 'unrecognized-shape' };
}

/**
 * Pinterest's PINTEREST_CREATE_PIN requires a `board_id` that has no equivalent in this app's
 * `publishToPinterest(title, description, mediaUrl, link)` contract (there is no per-post board
 * picker in ComposeScreen — out of scope for this build, see docs/composio-setup.md). Resolved
 * as: an explicit `PINTEREST_BOARD_ID` env var if set, otherwise the first board returned by
 * PINTEREST_LIST_BOARDS for the linked account. If neither exists (the account has zero boards),
 * publishing fails with a clear error rather than guessing a board id.
 *
 * Returns a user-facing `error` string (not just logs it) once the failure reason is known, so
 * `publishToPinterest` can tell "your account has no boards yet" apart from a generic failure —
 * a real, plausible scenario for any newly connected or personal Pinterest account, since
 * Pinterest doesn't create a default board the way some platforms do.
 */
async function resolvePinterestBoardId(
  composio: Composio,
  userId: string
): Promise<{ boardId: string } | { error: string }> {
  const envBoardId = process.env.PINTEREST_BOARD_ID;
  if (envBoardId) return { boardId: envBoardId };

  try {
    const result = await executeToolWithFallback(composio, PINTEREST_LIST_BOARDS_TOOL_SLUGS, {
      userId,
      arguments: {},
    });
    if (!result.successful) {
      // Distinguishing this from "zero boards" and from the shape-mismatch case below is the
      // whole point of this leaf's own gate — this branch was silent before, making all three
      // failure modes indistinguishable from the caller's generic "no board id resolved" message.
      logComposioFailure('Pinterest board lookup: tool call unsuccessful', result.error ?? result.data);
      return { error: 'Could not publish to Pinterest' };
    }
    const outcome = resolveBoardIdFromListResult(result.data);
    if (outcome.kind === 'found') {
      return { boardId: outcome.boardId };
    }
    if (outcome.kind === 'empty') {
      logComposioFailure('Pinterest board lookup: account has zero boards', result.data);
      return { error: 'Your Pinterest account has no boards yet. Create one in Pinterest and try again.' };
    }
    logComposioFailure('Pinterest board lookup: no board id in response shape', result.data);
    return { error: 'Could not publish to Pinterest' };
  } catch (error) {
    logComposioFailure('Pinterest board lookup: threw', error);
    return { error: 'Could not publish to Pinterest' };
  }
}

/**
 * Publishes a pin to Pinterest via Composio's PINTEREST_CREATE_PIN tool. Pins require an image
 * (or video) — enforced by the caller, same as Instagram. `media_source` is Pinterest API v5's
 * documented shape for pointing at a hosted image by URL (confirmed against Pinterest's own
 * `create-boards-and-pins` docs, since — like Instagram/Pinterest generally — the installed SDK
 * ships no local schema for this tool): `{ source_type: 'image_url', url: <mediaUrl> }`.
 *
 * Re-audited 2026-08-30 while investigating a report of Pinterest posts not showing their
 * attached image, independent of this comment's original citation: `composio.tools.get('default',
 * { tools: ['PINTEREST_CREATE_PIN'] })` against a live COMPOSIO_API_KEY returns `media_source` as a
 * `oneOf` (ImageBase64Source | ImageUrlSource | CarouselBase64Source | CarouselUrlSource |
 * VideoIdSource) where `ImageUrlSource` requires exactly `{ source_type: 'image_url', url }` —
 * no `composio.files.upload()` staging, unlike `publishToLinkedIn`/`publishToYouTube`/
 * `publishToTwitter`'s file-uploadable arguments. Cross-checked against Pinterest's own public API
 * spec (github.com/pinterest/api-description, `PinMediaSourceImageURL` schema): identical shape,
 * `required: [source_type, url]`. The code below already matched both sources exactly before this
 * re-audit; no change was needed to the media-attach call itself. `mediaUrl` is a Convex storage
 * URL (`ctx.storage.getUrl()`, publicly fetchable with no auth token — see `dispatch()` in
 * publishPost.ts), the same kind of URL already confirmed working for YouTube's/Twitter's staged
 * uploads, so Pinterest's own servers fetching it directly for `image_url` should work the same
 * way once the account has at least one board (see `resolvePinterestBoardId` above for that
 * separate, already-diagnosed blocker).
 *
 * One unrelated latent bug found during this re-audit and left unfixed (out of scope — this pass
 * is about the image-attach path only): `PINTEREST_DESCRIPTION_MAX_LENGTH` below is set to 500,
 * but both the live Composio schema and Pinterest's own spec cap `description` at 800 characters,
 * so descriptions between 501-800 characters are truncated more aggressively than Pinterest itself
 * requires.
 */
export async function publishToPinterest(
  title: string,
  description: string,
  mediaUrl: string,
  link?: string
): Promise<PublishResult> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();

    const boardResolution = await resolvePinterestBoardId(composio, userId);
    if ('error' in boardResolution) {
      // resolvePinterestBoardId already logged the specific reason (tool call failed, zero
      // boards, or unrecognized response shape) before returning here.
      return { success: false, error: boardResolution.error };
    }
    const boardId = boardResolution.boardId;

    const pinArgs: Record<string, unknown> = {
      board_id: boardId,
      title: title.slice(0, PINTEREST_TITLE_MAX_LENGTH),
      description: description.slice(0, PINTEREST_DESCRIPTION_MAX_LENGTH),
      media_source: { source_type: 'image_url', url: mediaUrl },
    };
    if (link) {
      pinArgs.link = link;
    }

    const result = await executeToolWithFallback(composio, PINTEREST_CREATE_PIN_TOOL_SLUGS, {
      userId,
      arguments: pinArgs,
    });
    if (!result.successful) {
      logComposioFailure('Pinterest pin creation', result.error);
      return { success: false, error: 'Could not publish to Pinterest' };
    }

    return { success: true, url: extractUrlFromResult(result.data) };
  } catch (error) {
    logComposioFailure('publishToPinterest', error);
    return { success: false, error: 'Could not publish to Pinterest' };
  }
}

/** Pulls the first page id out of a FACEBOOK_LIST_MANAGED_PAGES-shaped response, whatever field it lists under. */
function resolvePageIdFromListResult(data: Record<string, unknown>): string | undefined {
  const list = (data.data ?? data.pages ?? data.items) as unknown;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0] as Record<string, unknown> | undefined;
    const id = first?.id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  return undefined;
}

/**
 * Facebook's create-post tools all require a `page_id` this app's schema has no field for (there
 * is no per-post page picker in ComposeScreen — same out-of-scope call already made for
 * Pinterest's board_id, see `resolvePinterestBoardId` above). Resolved the same way: an explicit
 * `FACEBOOK_PAGE_ID` env var if set, otherwise the first page returned by
 * FACEBOOK_LIST_MANAGED_PAGES (current tool; FACEBOOK_GET_USER_PAGES as a deprecated fallback) for
 * the linked account. If neither exists (the account manages zero Pages), publishing fails with a
 * clear error rather than guessing — this also happens to be where a personal-profile-only account
 * would fail, since a personal profile manages no Pages.
 */
async function resolveFacebookPageId(composio: Composio, userId: string): Promise<string | undefined> {
  const envPageId = process.env.FACEBOOK_PAGE_ID;
  if (envPageId) return envPageId;

  try {
    const result = await executeToolWithFallback(composio, FACEBOOK_LIST_PAGES_TOOL_SLUGS, {
      userId,
      arguments: {},
    });
    if (!result.successful) return undefined;
    return resolvePageIdFromListResult(result.data);
  } catch (error) {
    logComposioFailure('Facebook page lookup', error);
    return undefined;
  }
}

/**
 * Same HEAD-request Content-Type check as `detectInstagramMediaKind` above, duplicated rather
 * than shared because Facebook's photo/video tools take different argument names than
 * Instagram's (`url`/`file_url` vs `image_url`/`video_url`), not because the detection logic
 * itself differs. Defaults to 'image' if the request fails, same reasoning as Instagram's.
 */
async function detectFacebookMediaKind(mediaUrl: string): Promise<'image' | 'video'> {
  try {
    const response = await fetch(mediaUrl, { method: 'HEAD' });
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.startsWith('video/') ? 'video' : 'image';
  } catch {
    return 'image';
  }
}

/**
 * FACEBOOK_CREATE_POST's documented response only confirms a composite `PageID_PostID` id is
 * returned (needed for FACEBOOK_GET_POST lookups), not a ready-made permalink field — unlike
 * LinkedIn/YouTube/Instagram/Pinterest's tools, which return an actual URL.
 * `extractUrlFromResult` is tried first in case a future toolkit version adds `permalink_url`
 * directly; if not, this falls back to constructing `https://www.facebook.com/<id>`, which is a
 * valid permalink for that composite id format on Facebook's own site.
 */
function extractFacebookUrl(data: Record<string, unknown>): string | undefined {
  const direct = extractUrlFromResult(data);
  if (direct) return direct;
  const id = data.id ?? data.post_id;
  return typeof id === 'string' && id.length > 0 ? `https://www.facebook.com/${id}` : undefined;
}

/**
 * Publishes a post to a Facebook Page via Composio. Unlike Instagram/Pinterest, Facebook Pages
 * support text-only posts (`FACEBOOK_CREATE_POST`, no media required) as well as photo
 * (`FACEBOOK_CREATE_PHOTO_POST`) and video (`FACEBOOK_CREATE_VIDEO_POST`) posts — matching
 * LinkedIn's text-only-allowed pattern rather than Instagram/Pinterest's media-required one, per
 * `docs.composio.dev/toolkits/facebook`'s parameter tables (`message` is the only required
 * content field on the text tool; `page_id` is required on all three). Requires a Facebook
 * **Page** already linked via `composio link facebook` (see docs/composio-setup.md) — Meta's
 * Graph API rejects posting from a personal profile outright, confirmed in Composio's own docs
 * ("Only supports Facebook Pages, not Facebook Personal accounts"), not something this code
 * enforces itself.
 */
export async function publishToFacebook(text: string, mediaUrl?: string): Promise<PublishResult> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();

    const pageId = await resolveFacebookPageId(composio, userId);
    if (!pageId) {
      logComposioFailure(
        'publishToFacebook',
        'No Facebook Page id resolved — set FACEBOOK_PAGE_ID or link an account that manages at least one Page'
      );
      return { success: false, error: 'Could not publish to Facebook' };
    }

    if (!mediaUrl) {
      const result = await executeToolWithFallback(composio, FACEBOOK_CREATE_POST_TOOL_SLUGS, {
        userId,
        arguments: { page_id: pageId, message: text, published: true },
      });
      if (!result.successful) {
        logComposioFailure('Facebook post creation', result.error);
        return { success: false, error: 'Could not publish to Facebook' };
      }
      return { success: true, url: extractFacebookUrl(result.data) };
    }

    const mediaKind = await detectFacebookMediaKind(mediaUrl);
    if (mediaKind === 'video') {
      const result = await executeToolWithFallback(composio, FACEBOOK_CREATE_VIDEO_POST_TOOL_SLUGS, {
        userId,
        arguments: { page_id: pageId, file_url: mediaUrl, description: text, published: true },
      });
      if (!result.successful) {
        logComposioFailure('Facebook video post creation', result.error);
        return { success: false, error: 'Could not publish to Facebook' };
      }
      return { success: true, url: extractFacebookUrl(result.data) };
    }

    const result = await executeToolWithFallback(composio, FACEBOOK_CREATE_PHOTO_POST_TOOL_SLUGS, {
      userId,
      arguments: { page_id: pageId, url: mediaUrl, message: text, published: true },
    });
    if (!result.successful) {
      logComposioFailure('Facebook photo post creation', result.error);
      return { success: false, error: 'Could not publish to Facebook' };
    }
    return { success: true, url: extractFacebookUrl(result.data) };
  } catch (error) {
    logComposioFailure('publishToFacebook', error);
    return { success: false, error: 'Could not publish to Facebook' };
  }
}

/**
 * Extracts a media id from TWITTER_UPLOAD_MEDIA's response, for passing into
 * TWITTER_CREATION_OF_A_POST's `media_media_ids`. The response shape isn't statically typed in
 * the installed package any more than LinkedIn's or Instagram's are (see those functions above),
 * so this checks the field names Twitter's own media-upload API commonly uses.
 */
function extractTwitterMediaId(data: Record<string, unknown>): string {
  const candidateKeys = ['media_id_string', 'media_id', 'id'];
  for (const key of candidateKeys) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  throw new Error('Could not determine the Twitter media id from the upload response');
}

/**
 * Publishes a post to Twitter/X via Composio's TWITTER_CREATION_OF_A_POST tool, with optional
 * media. Requires a Twitter account connected through a custom Auth Config using the account
 * owner's own X Developer credentials — see the comment above `TWITTER_TOOLKIT_SLUG` and
 * docs/composio-setup.md's Twitter/X section for why Composio no longer supplies a shared app for
 * this one platform the way it does for LinkedIn/YouTube/Instagram/Pinterest/Facebook. `text` is
 * defensively truncated to X's standard 280-character limit even though generatePost.ts's
 * Bluesky-shared prompt instruction already targets well under that.
 *
 * Media field name caveat (same class of gap as `LINKEDIN_CREATE_LINKED_IN_POST`'s argument names
 * beyond author/commentary/visibility, documented above): `TWITTER_UPLOAD_MEDIA`'s exact input
 * field for a staged file was not confirmed against a live COMPOSIO_API_KEY during this build —
 * `media` is the best-effort name used below. Run `composio execute TWITTER_UPLOAD_MEDIA
 * --get-schema` before a real demo that includes media (see docs/composio-setup.md).
 */
export async function publishToTwitter(text: string, mediaUrl?: string): Promise<PublishResult> {
  try {
    const composio = getComposioClient();
    const userId = getComposioUserId();

    const postArgs: Record<string, unknown> = {
      text: text.slice(0, TWITTER_TEXT_MAX_LENGTH),
    };

    if (mediaUrl) {
      // Stage the remote file with Composio's file store, same confirmed pattern as
      // publishToYouTube's video upload above (`composio.files.upload()` accepts a fetchable URL
      // directly; this module never downloads the media bytes itself).
      const stagedMedia = await composio.files.upload({
        file: mediaUrl,
        toolSlug: TWITTER_UPLOAD_MEDIA_TOOL_SLUGS[0],
        toolkitSlug: TWITTER_TOOLKIT_SLUG,
      });

      const uploadResult = await executeToolWithFallback(composio, TWITTER_UPLOAD_MEDIA_TOOL_SLUGS, {
        userId,
        arguments: { media: stagedMedia },
      });
      if (!uploadResult.successful) {
        logComposioFailure('Twitter media upload', uploadResult.error);
        return { success: false, error: 'Could not publish to Twitter' };
      }
      postArgs.media_media_ids = [extractTwitterMediaId(uploadResult.data)];
    }

    const postResult = await executeToolWithFallback(composio, [TWITTER_POST_TOOL_SLUG], {
      userId,
      arguments: postArgs,
    });
    if (!postResult.successful) {
      logComposioFailure('Twitter post creation', postResult.error);
      return { success: false, error: 'Could not publish to Twitter' };
    }

    return { success: true, url: extractUrlFromResult(postResult.data) };
  } catch (error) {
    logComposioFailure('publishToTwitter', error);
    return { success: false, error: 'Could not publish to Twitter' };
  }
}

/**
 * Threads has no Composio toolkit to call — verified, not assumed; see the comment block above
 * this section (near the Twitter constants) and docs/composio-setup.md's Threads section for the
 * full trail (docs.composio.dev/toolkits/threads 404s, and the full toolkit index has no Threads
 * entry at all as of this build). This function exists only so publishPost.ts's dispatch table
 * can treat every platform uniformly as `(text, mediaUrl?) => Promise<PublishResult>`; it never
 * touches the Composio SDK, because there is nothing there to call. It returns a clear,
 * platform-level error rather than throwing, so a demo that includes Threads fails the same
 * visible way a real publish failure would instead of crashing the action.
 */
export async function publishToThreads(_text: string, _mediaUrl?: string): Promise<PublishResult> {
  return { success: false, error: 'Threads publishing is not available yet' };
}
