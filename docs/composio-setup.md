# Composio setup (LinkedIn + YouTube + Instagram + Pinterest + Facebook + Twitter/X)

`convex/lib/composio.ts` uses Composio (composio.dev) so this app never hand-builds OAuth for
LinkedIn, YouTube, Instagram, Pinterest, Facebook, or Twitter/X. Composio ships its own
pre-approved, pre-reviewed developer apps for five of those six platforms — you connect your own
account to Composio's app once, and the SDK publishes on your behalf from then on. **Instagram is
the exception to "pre-approved means frictionless"** — read that platform's section below before
assuming it works like the others. Facebook has its own hard requirement too (a Page, not a
personal profile) — see the Facebook section below. **Twitter/X is a bigger exception: Composio no
longer provides a shared app for it at all** — see the Twitter/X section below before assuming
"link and go" works the way it does for the other four.

**Threads (Meta's threads.net app) has no Composio toolkit and is not implemented** — see the
Threads section below for the full verification trail. This is a different situation from every
platform above: there is no tool to call, not just extra friction to work around.

**Google Business Profile (formerly Google My Business) was evaluated and does not exist as a
Composio toolkit** — see "Google Business Profile" below for the full verification trail. It is
not implemented anywhere in this app.

This is a one-time setup on the machine (or CI) that will run `npx convex env set
COMPOSIO_API_KEY ...` and eventually call `publishToLinkedIn` / `publishToYouTube`.

## 1. Install the Composio CLI

The CLI is **not** an npm package — it ships as a standalone binary via a shell installer
(confirmed against the `ComposioHQ/composio` GitHub repo's root README, since `@composio/cli` is
marked `"private": true` in its own `package.json` and is not published to npm):

```bash
curl -fsSL https://composio.dev/install | sh
```

This puts `composio` on your `PATH`. Open a new terminal (or re-source your shell rc file), then
confirm it installed:

```bash
composio version
```

## 2. Log in

```bash
composio login
```

This opens a browser consent screen for your Composio account (not LinkedIn/YouTube yet — this
just authenticates the CLI). Grab your API key from https://dashboard.composio.dev/settings once
logged in; you'll need it for step 4.

## 3. Link LinkedIn, YouTube, Instagram, Pinterest, and Facebook

```bash
composio link linkedin
composio link youtube
composio link instagram
composio link pinterest
composio link facebook
```

Each `link` command opens a browser OAuth consent screen for that platform, using Composio's own
approved app (you never create your own LinkedIn, Google Cloud, Meta, or Pinterest developer app
for this). Approve each with the account you want the app publishing from. **For Instagram, the
account must already be a Business or Creator account** (see the Instagram section below) —
Composio's connect flow will fail on a personal account, not because of anything in this repo.
**For Facebook, approve with a Page you manage, not just your personal profile** (see the Facebook
section below) — Meta's Graph API rejects publishing from a personal profile outright.

Verify all five are connected:

```bash
composio connections list
```

**Twitter/X is a separate step, not part of the block above** — `composio link twitter` will not
work until you've registered your own X Developer credentials as a custom Auth Config in
Composio's dashboard first (see the Twitter/X section below; this is the one platform in this app
where Composio's own pre-approved app does not apply). **Threads has no link step at all** — there
is no Composio toolkit to connect to (see the Threads section below).

## 4. Set the API key for Convex

The app reads `COMPOSIO_API_KEY` from Convex's server-side environment (never a client-side
`EXPO_PUBLIC_*` variable, and never a repo table — see docs/spec-v0.md section 6):

```bash
npx convex env set COMPOSIO_API_KEY <your-key-from-dashboard.composio.dev>
```

Optional: if you connected LinkedIn/YouTube under a Composio user id other than the CLI's default
profile, also set:

```bash
npx convex env set COMPOSIO_USER_ID <your-composio-user-id>
```

`convex/lib/composio.ts` defaults `COMPOSIO_USER_ID` to `'default'`, which matches the profile
`composio login` / `composio link` set up above.

Optional: to pin which Pinterest board pins publish to (recommended — otherwise the first board on
the linked account is used, see the Pinterest section below):

```bash
npx convex env set PINTEREST_BOARD_ID <board-id-from-your-pinterest-account>
```

Optional: to pin which Facebook Page posts publish to (recommended — otherwise the first Page the
linked account manages is used, see the Facebook section below):

```bash
npx convex env set FACEBOOK_PAGE_ID <page-id-from-your-facebook-page>
```

## LinkedIn

**Known failure mode (found in live testing, not theoretical):** posting can fail with
`Forbidden. You don't have permission to create posts.` even though the account shows as
connected. Confirmed against Composio's own LinkedIn toolkit docs: `LINKEDIN_CREATE_LINKED_IN_POST`
requires the `w_member_social` scope, and Composio's documentation explicitly warns that
`w_member_social` and `r_organization_admin` "cannot be used together" on the same auth
config — if Composio's shared/default LinkedIn auth config requests a scope set that includes or
conflicts with organization-admin-adjacent scopes, `w_member_social` may not actually be granted,
which reads to the API exactly like this Forbidden error.

**Fix shipped in code — no custom LinkedIn Developer App needed.** The original plan here was to
register a personal LinkedIn Developer App and a custom Composio auth config, on the assumption
that only a fully custom app can control scopes. That assumption was wrong: Composio's managed auth
supports a documented scope override while still using Composio's own pre-approved LinkedIn app
(confirmed at `docs.composio.dev/docs/authentication/controlling-scopes`: *"Pass a `scopes` field in
`credentials` to override the defaults while still using Composio's managed OAuth app"*). `getConnectUrl`
in `convex/lib/composio.ts` now special-cases `linkedin`: before calling `composio.toolkits.authorize`,
it finds or creates a dedicated auth config named `UniPost LinkedIn (w_member_social, no org-admin)`
with `credentials.scopes` pinned to `openid,profile,email,w_member_social` — the scopes behind
LinkedIn's two self-serve, no-review products ("Sign In with LinkedIn using OpenID Connect" for the
profile lookup `LINKEDIN_GET_MY_INFO` needs, and "Share on LinkedIn" for posting) — and deliberately
omits any organization/admin scope, so the documented conflict cannot occur. See the comment block
above `LINKEDIN_OAUTH_SCOPES` in `convex/lib/composio.ts` for the full trail.

**This does not retroactively fix an already-connected account.** Composio's docs are explicit that
a scope change on an auth config "affect[s] new connections only... [existing accounts] keep the
scopes they already granted until they reconnect." To pick up the new scopes:

1. In the app's Accounts tab, disconnect LinkedIn.
2. Reconnect LinkedIn. This now runs through the corrected auth config automatically — no manual
   Composio dashboard steps, no personal LinkedIn Developer App.
3. Re-test posting.

**Still unverified end-to-end** (no live `COMPOSIO_API_KEY` + real reconnect + real publish attempt
was run to confirm this): the exact default scope set on Composio's shared LinkedIn auth config was
never published anywhere it could be checked, so the conflict theory itself is plausible but not
directly confirmed — only that this override is the documented, code-level way to pin an explicit,
non-conflicting scope set. **If posting still fails with the same Forbidden error after a fresh
disconnect/reconnect**, that means Composio's own shared LinkedIn app isn't provisioned with the
underlying LinkedIn product at all (a limitation of Composio's app registration with LinkedIn, not
of the scopes requested), and only then would a genuinely custom LinkedIn Developer App be the real
fix:

1. Create your own LinkedIn app at https://www.linkedin.com/developers/apps.
2. Add the **Share on LinkedIn** product only (self-serve, no review) — do not add any
   organization/admin products to this app, to avoid the scope conflict above.
3. In the Composio dashboard: click **Create Auth Config**, select **LinkedIn** from the toolkit
   sidebar, confirm **OAuth2** is selected, check **"Use your own developer authentication,"** paste
   the LinkedIn app's Client ID and Client Secret into their fields, then click **Create LinkedIn
   Auth Config**. Optionally set scopes under the config's **Manage Auth Config** tab. Copy the
   resulting `ac_...` auth config id.
4. Before this becomes real code, `convex/lib/composio.ts`'s `getOrCreateLinkedInAuthConfigId`
   would need to use that fixed `ac_...` id (e.g. via an env var) instead of creating its own
   managed-auth config, and the LinkedIn Developer Portal's OAuth 2.0 redirect URI would need to be
   set to `https://backend.composio.dev/api/v3/toolkits/auth/callback`.

## Instagram

**Account requirement (hard, not optional):** Composio's Instagram toolkit only accepts
**Business or Creator** Instagram accounts — a personal account is rejected outright, before any
of this app's code runs. If `composio link instagram` fails immediately, this is almost always
why; convert the account in the Instagram app first (Settings > Account type).

**Meta App Review finding (verified, not assumed):** the task behind this build asked explicitly
whether Composio's pre-approved app sidesteps Meta's own review requirement the way it does for
LinkedIn/YouTube's developer consoles. It does **not**, fully. What was actually confirmed by
reading Composio's own Instagram toolkit page (`composio.dev/toolkits/instagram`, fetched during
this build):
- Composio says you "can get started immediately using Composio's built-in Instagram app," but
  recommends "configuring your own OAuth credentials" for production — implying the shared app has
  scale or reliability limits Composio doesn't fully spell out publicly.
- General Meta rules still apply underneath Composio's layer: `instagram_business_content_publish`
  (the permission that lets an app publish media) needs **Advanced Access**, which needs Meta App
  Review plus Business Verification, for any account other than the developer's own. Publishing to
  your own account in development mode (added as an Instagram Tester) does not need review; scaling
  past that, even through Composio, likely still runs into Meta's review wall on Composio's app,
  not this repo's.
- Conclusion for this build: for the single-account hackathon use case (the owner's account,
  already a tester-equivalent relationship via Composio's shared app), this should work without an
  additional review step. It has **not** been verified against a real connected account and real
  API key in this environment — treat it as the same class of open gap as LinkedIn's field-name gap
  above, not as confirmed-working. If `composio link instagram` or a publish call fails with a
  permission error mentioning `instagram_business_content_publish` or "advanced access," that is
  Meta's review wall surfacing through Composio, not a bug in `convex/lib/composio.ts`.

**Tool flow implemented:** Instagram has no single "create a post" call — it is create a media
container, then publish that container (`INSTAGRAM_POST_IG_USER_MEDIA` then
`INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`, with the deprecated `INSTAGRAM_CREATE_MEDIA_CONTAINER` /
`INSTAGRAM_CREATE_POST` pair as fallback slugs). See the comment block above
`INSTAGRAM_TOOLKIT_SLUG` in `convex/lib/composio.ts` for exactly how these slugs were confirmed
(Composio's live docs, not the installed package — see "Why the tool catalog isn't in this repo"
below, which turned out to apply to every toolkit, not just LinkedIn/YouTube).

**Live failure found in testing, root-caused (2026-08-30):** video/Reels publishing was failing.
Root cause confirmed by fetching `INSTAGRAM_POST_IG_USER_MEDIA`'s real tool schema live
(`composio.tools.get`) against the connected account (`ca__lxfPq4T4pAu`): its `media_type` field
is an enum of exactly `REELS` / `CAROUSEL` / `STORIES` — `VIDEO`, which `convex/lib/composio.ts`
was sending for every video post, is not a member, and the schema says outright "'VIDEO' is
deprecated and no longer supported - use 'REELS' for all video content." Fixed by sending
`media_type: 'REELS'` for video/Reels content. Same live schema fetch also surfaced two more real
gaps, both fixed in the same pass: (1) the `caption` field's own docs require URL-encoding `#` to
`%23` (Meta's API otherwise truncates a caption at the first raw hashtag) — `publishToInstagram`
now does this encoding; (2) image vs video was previously guessed from a HEAD-request
`Content-Type` sniff alone — `publishToInstagram` now takes an explicit `mediaType` threaded from
the post's own schema field via `publishPost.ts`'s `dispatch()`, with the sniff kept only as a
defensive fallback. **Account eligibility was checked live and is not the problem:** a live
`INSTAGRAM_GET_USER_INFO` call against the connected account returned `account_type: MEDIA_CREATOR`
(eligible), not `PERSONAL` — `publishToInstagram` now checks this field on every call and returns a
specific, distinguishable error if a future connected account is Personal, rather than letting it
surface later as an opaque permission failure. `INSTAGRAM_PUBLISH_MAX_WAIT_SECONDS` was also
checked against `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`'s live schema and confirmed to already be
correctly wired — that tool polls internally for `FINISHED` status using this value, so no separate
manual polling loop was needed. **Still unverified:** an actual end-to-end live publish (image and
Reels) has not been run against the real account in this pass — the fixes above are confirmed
against live tool schemas and live account data, not a completed real post. See the note in
`convex/lib/composio.ts` above `publishToInstagram` before assuming a real post has gone out.

## Pinterest

**Board requirement:** `PINTEREST_CREATE_PIN` requires a `board_id` — Pinterest has no concept of
posting a pin without a board, the way a feed post has no equivalent requirement. This app's schema
has no per-post board picker (out of scope for this build), so `convex/lib/composio.ts` resolves
one of two ways:
1. `PINTEREST_BOARD_ID` env var, if set (`npx convex env set PINTEREST_BOARD_ID <board-id>`) — the
   deterministic option, recommended once you know which board you want posts to land in.
2. Otherwise, calls `PINTEREST_LIST_BOARDS` and uses the first board returned. If the linked
   account has zero boards, publishing fails with a clear error rather than guessing.

No Meta-review-equivalent friction was found for Pinterest — its API access model doesn't have an
App-Review gate comparable to Meta's for Instagram.

**Live failure found in testing, root-caused (2026-08-30):** publishing failed with `No Pinterest
board id resolved`. Investigation confirmed the response-shape parsing in `convex/lib/composio.ts`
(`resolveBoardIdFromListResult`'s `data.items ?? data.boards ?? data.data` guess-list) was already
correct — Pinterest's own API v5 OpenAPI spec (github.com/pinterest/api-description, `GET /boards`)
documents the real response as a flat `{ bookmark, items: Board[] }`, and the installed
`@composio/core@0.18.0` passes a tool's raw API response straight through as `result.data` with no
extra wrapping, so `data.items` (checked first) was never the problem. The most likely real cause is
scenario (a) below: the connected test account simply has zero boards, which Pinterest does not
auto-create the way some platforms create a default one. `resolvePinterestBoardId` now logs which of
three scenarios actually occurred (`tool call unsuccessful` / `account has zero boards` /
`no board id in response shape`) instead of one generic message, and `publishToPinterest` returns a
distinct user-facing error — "Your Pinterest account has no boards yet. Create one in Pinterest and
try again." — for the zero-boards case specifically. **The one-step fix for testing:** open the
Pinterest app with the connected account and create one board, then retry publishing. If it still
fails after that, check the Convex logs for which of the three `[composio] Pinterest board lookup:
...` messages appears — that tells you whether it's (a) zero boards (now handled explicitly), (b) the
`PINTEREST_LIST_BOARDS` call itself failing (auth/scope issue, most likely `boards:read` missing from
the linked account's scopes), or (c) a genuinely different response shape than the one Pinterest's
own spec documents (would need re-verifying against a live `composio execute PINTEREST_LIST_BOARDS
--get-schema` call).

## Facebook

**Page requirement (hard, not optional):** every Facebook posting tool Composio exposes
(`FACEBOOK_CREATE_POST`, `FACEBOOK_CREATE_PHOTO_POST`, `FACEBOOK_CREATE_VIDEO_POST`) requires a
`page_id` and, per Composio's own documentation (`docs.composio.dev/toolkits/facebook`, fetched
during this build), "Only supports Facebook Pages, not Facebook Personal accounts." This is Meta's
Graph API rejecting personal-profile publishing outright, not a limitation this repo's code adds —
publishing to your own timeline the way you'd post as yourself is not something the Facebook Graph
API allows any third-party app to do any more. If `composio link facebook` succeeds but publishing
fails, confirm the linked account actually manages at least one Page (Settings > Pages in the
Facebook app, or create one first).

**Page id resolution:** same pattern as Pinterest's `board_id` gap above — this app's schema has no
per-post Page picker, so `convex/lib/composio.ts` resolves one of two ways:
1. `FACEBOOK_PAGE_ID` env var, if set (`npx convex env set FACEBOOK_PAGE_ID <page-id>`).
2. Otherwise, calls `FACEBOOK_LIST_MANAGED_PAGES` (the current tool; `FACEBOOK_GET_USER_PAGES` is
   tried as a deprecated fallback) and uses the first Page returned. If the linked account manages
   zero Pages, publishing fails with a clear error rather than guessing.

**Text-only posts are supported** (`FACEBOOK_CREATE_POST`, `message` field, no media) — unlike
Instagram/Pinterest, a Facebook Page post does not require a photo or video, matching LinkedIn's
pattern. When media is attached, `convex/lib/composio.ts` picks `FACEBOOK_CREATE_PHOTO_POST` or
`FACEBOOK_CREATE_VIDEO_POST` based on the same HEAD-request Content-Type check
`publishToInstagram` uses (see the comment above `detectFacebookMediaKind` in that file).

No Meta-review-equivalent friction beyond the Page requirement above was found for Facebook in
Composio's docs — unlike Instagram, there is no mention of `instagram_business_content_publish`-style
Advanced Access gating for the Page posting permissions Composio's managed app uses. This has **not**
been verified against a real connected account and real API key in this environment — treat it as
the same class of open gap as LinkedIn's field-name gap above.

## Twitter/X

**Composio removed managed credentials for this platform (verified, not assumed).** Every other
platform in this file uses Composio's own pre-approved developer app — Twitter/X does not, as of
February 2026. Confirmed against `composio.dev/auth/twitter` and a web search corroborating it:
Composio previously provided shared Twitter credentials the same way it does for LinkedIn/YouTube,
but removed them after X moved its own API to pay-per-use pricing. The setup flow is now:

1. Create a developer account and an app at https://console.x.com/.
2. In the app's "User authentication settings," enable OAuth 2.0 and set the callback URL to
   `https://backend.composio.dev/api/v1/auth-apps/add`.
3. Gather three values from the X Developer Portal: **Client ID**, **Client Secret** (both from
   OAuth 2.0 settings), and a **Bearer token** (from initial app creation).
4. In the Composio dashboard, click "Create Auth Config," search for "Twitter," toggle to "use
   your own developer credentials," and paste in the three values above. Copy the generated auth
   config id (`ac_...`).
5. Only after that exists: `composio link twitter` connects your actual X account through it.

**X's own API cost (verified, not assumed):** as of April 20, 2026, X's API v2 write tier is
pay-per-use for all self-serve developers — **$0.015 per standard post created, $0.20 if the post
contains a link** — with no free write tier remaining. This is a real per-post operating cost at
the X platform level, independent of Composio; Composio does not, and cannot, make X's own API
free. None of this app's other five platforms (LinkedIn, YouTube, Instagram, Pinterest, Facebook)
have an equivalent per-post charge from the platform itself.

**Tool flow implemented:** a single-step post via `TWITTER_CREATION_OF_A_POST` (fields include
`text` and `media_media_ids`), with optional media staged first through `TWITTER_UPLOAD_MEDIA`
(confirmed against `docs.composio.dev/toolkits/twitter`, fetched during this build; the installed
`@composio/core` package has no local catalog entry for this toolkit either, same as every other
platform in this file — see "Why the tool catalog isn't in this repo" below). The exact input
field name `TWITTER_UPLOAD_MEDIA` expects for the staged file was not confirmed against a live
`COMPOSIO_API_KEY` during this build (`media` is the best-effort guess in
`convex/lib/composio.ts`) — the same class of open gap as LinkedIn's field-name gap documented
above; run `composio execute TWITTER_UPLOAD_MEDIA --get-schema` before a demo that attaches media.

## Threads

**No Composio toolkit exists for this platform (verified, not assumed) — nothing to link, nothing
to configure.** This is a materially different situation from every platform above, including
Instagram's Meta App Review friction: Instagram at least has a real toolkit that might work.
Threads does not have a toolkit at all as of this build. Checked two ways:
1. `docs.composio.dev/toolkits/threads` returns a live HTTP 404.
2. The full toolkit index at `docs.composio.dev/toolkits` (1,355+ entries as of this build) was
   fetched and searched for "Threads," "Meta Threads," and any slug variant of either — zero
   matches. Only Instagram appears among Meta's apps in that index.

A general web search turned up nothing beyond confirming that Meta's own separate Threads API
exists (`graph.threads.net`, gated by Tech Provider Verification and OAuth scopes like
`threads_content_publish`) — Composio has simply not built an integration for it.

`convex/lib/composio.ts`'s `publishToThreads(text, mediaUrl?)` exists to match the same function
contract every other platform in that file follows (so `publishPost.ts`'s dispatch table stays
uniform), but it never calls the Composio SDK — there is nothing there to call. It always returns
a clear `{ success: false, error: 'Threads publishing is not available yet' }`. Likewise,
`getPlatformConnectUrl`/`checkConnections` in `convex/connections.ts` special-case `'threads'`
before it reaches `lib/composio.ts`'s toolkit-keyed functions at all, since there is no toolkit
slug to authorize or check a connected account against. If Composio ships a Threads toolkit later,
wire it up the same way Facebook was added to this file: a toolkit slug, tool slugs read off
Composio's live docs (not guessed), and replacing the honest-failure body of `publishToThreads`
with a real implementation.

## Google Business Profile

**Checked and confirmed not to exist as a Composio toolkit.** Before implementing anything, this
build verified two ways: (1) `docs.composio.dev/toolkits/googlebusiness` and three other guessed
slug variants (`google_business`, `gmb`, `googlemybusiness`) all return a live HTTP 404; (2) the
full toolkit index at `docs.composio.dev/toolkits` (1,411 toolkits as of this build) was fetched
and searched — the only Google toolkits present are Ads, Analytics, Maps, and Search Console, none
named "Google Business Profile," "Google My Business," or "GMB." No `publishToGoogleBusiness`
function, toolkit slug, or schema literal exists anywhere in this repo as a result — this is a
confirmed gap in Composio's toolkit catalog, not an oversight in this app. If Composio adds this
toolkit later, wire it up the same way Facebook was added here: a toolkit slug, tool slugs read off
Composio's live docs (not guessed), a location-id resolution helper (Google Business Profile posts
are location-bound, so expect a `locationId` gap analogous to Pinterest's `board_id` and Facebook's
`page_id`), and a `publishToGoogleBusiness(text, mediaUrl?)` function matching this file's
established shape.

## Why the tool catalog isn't in this repo

`@composio/core` (the npm package `convex/lib/composio.ts` imports) does **not** ship a static
list of tool names or argument schemas, for ANY toolkit — `node_modules/@composio/core/generated/index.d.ts`
is a stub ("Run `composio ts generate` to generate the actual toolkit types"), and grepping the
whole installed package for "instagram", "pinterest", "facebook", or "twitter" turns up zero
matches (Threads isn't grepped for here since it has no toolkit at all — see the Threads section
above). Real tool schemas (e.g. exactly which fields `LINKEDIN_CREATE_LINKED_IN_POST` accepts) are
fetched from Composio's backend at call time, which requires a live `COMPOSIO_API_KEY` this
environment did not have during development. `convex/lib/composio.ts` compensates two ways: for
LinkedIn/YouTube, trying the most likely tool slug first and falling back to an alternate slug on
a "tool not found" error (see the comments next to `LINKEDIN_INFO_TOOL_SLUGS` and
`YOUTUBE_UPLOAD_TOOL_SLUGS`); for Instagram/Pinterest/Facebook/Twitter, reading the exact slugs and
argument names off Composio's own live documentation during this build, since there was no local
source to grep at all (see the comment above `INSTAGRAM_TOOLKIT_SLUG`, `FACEBOOK_TOOLKIT_SLUG`,
and `TWITTER_TOOLKIT_SLUG` in that file for the full trail). See gates/composio.md for the
LinkedIn/YouTube evidence trail specifically. If publishing fails after real credentials are wired
up for any of the six implemented platforms, run `composio execute <slug> --get-schema` to print
the live schema and adjust the argument field names in `convex/lib/composio.ts` accordingly.

## Troubleshooting

- `composio whoami` — confirms which Composio account the CLI/API key is using.
- `composio connections list --toolkit linkedin` / `--toolkit youtube` / `--toolkit instagram` /
  `--toolkit pinterest` / `--toolkit facebook` / `--toolkit twitter` — confirms a connected account
  exists for that toolkit. There is no `--toolkit threads` equivalent — no toolkit exists to check.
- `composio execute LINKEDIN_CREATE_LINKED_IN_POST --dry-run --get-schema` — prints the live
  argument schema without executing, useful for confirming field names beyond
  `author`/`commentary`/`visibility`.
- `composio execute PINTEREST_CREATE_PIN --dry-run --get-schema` /
  `composio execute INSTAGRAM_POST_IG_USER_MEDIA --dry-run --get-schema` /
  `composio execute FACEBOOK_CREATE_POST --dry-run --get-schema` /
  `composio execute TWITTER_UPLOAD_MEDIA --dry-run --get-schema` — same, for the newer platforms;
  run these before a live demo to confirm the argument names this file assumes (`media_source`,
  `board_id`, `ig_user_id`, `creation_id`, `page_id`, `media`, etc.) still match Composio's current
  catalog, since it is versioned and can change independently of this repo.
