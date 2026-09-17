# UniPost — V0 spec (detailed)

Hackathon build target: 8x Mobile Hackathon, Delhi, 2026-08-30. Everything in this doc must work
live on stage. This replaces the earlier draft — that one skipped LLM generation, de-slop, and
Composio; this one is the real spec.

## 1. What changed from the earlier draft, and why

| Earlier draft | This spec | Why |
|---|---|---|
| User hand-types the final post text | User gives a short **brief**; an LLM generates the actual per-platform post copy | The pitch is "compose once," not "type three times" — generation is the product, not a bonus |
| No slop protection | A deterministic slop-check runs on every generated draft before it can publish | AI-sounding posts are a worse outcome than no app at all — this is a hard requirement, not polish |
| Custom OAuth (PKCE) hand-built for LinkedIn + YouTube | Composio handles LinkedIn + YouTube auth and posting; Bluesky stays direct | Composio ships pre-approved LinkedIn/YouTube OAuth apps with built-in token refresh — this deletes an entire category of hackathon risk (no developer-app review, no hand-rolled PKCE, no endpoint drift to chase) |

## 2. End-to-end flow

```
User types a brief (+ optional media)
        │
        ▼
generatePost (Convex action)
   → one LLM call per selected platform, prompted with:
       - the brief
       - that platform's structural rules (char limits, title/description split, etc.)
       - the anti-slop voice rules (condensed from content_guardrails.md)
   → returns { platform, generatedText, (youtubeTitle for YouTube) }
        │
        ▼
checkSlop (pure function, no LLM, runs instantly)
   → regex/string checks against the same rule set
   → auto-fixes unambiguous issues (curly quotes → straight)
   → flags everything else with { quote, breaks, suggestion } — same shape as the real
     de-slop skill's scorecard rows, never silently rewritten
        │
        ▼
ReviewScreen — user sees each platform's draft + any flags, can edit inline or hit
"Regenerate" (re-runs generatePost with the flags fed back as negative examples)
        │
        ▼
publishPost (Convex action) — once the user approves
   → Bluesky: direct AT Protocol call (unchanged from the working implementation)
   → LinkedIn, YouTube: Composio tool call (composio.tools.execute(...))
   → results recorded per platform, UI updates as each resolves independently
```

Nothing publishes without passing through the review step at least once — this is the actual
guarantee behind "posts look natural, not AI-generated," not a hope.

## 3. Convex schema

```ts
// convex/schema.ts
export default defineSchema({
  posts: defineTable({
    brief: v.string(),                 // what the user actually typed
    mediaType: v.union(v.literal('none'), v.literal('image'), v.literal('video')),
    createdAt: v.number(),
  }),

  platformPosts: defineTable({
    postId: v.id('posts'),
    platform: v.union(
      v.literal('bluesky'), v.literal('linkedin'), v.literal('youtube'),
      v.literal('instagram'), v.literal('pinterest'), v.literal('facebook'),
      v.literal('twitter'), v.literal('threads')
    ),
    generatedText: v.string(),          // raw LLM output, never mutated
    finalText: v.string(),              // after auto-fix + any user edits — what gets published
    youtubeTitle: v.optional(v.string()),
    slopFindings: v.array(v.object({
      rule: v.string(),                 // e.g. "banned-word:leverage", "em-dash", "hashtag"
      quote: v.string(),                // exact offending span
      suggestion: v.string(),
      autoFixed: v.boolean(),
    })),
    status: v.union(
      v.literal('draft'),               // generated, not yet reviewed
      v.literal('approved'),            // user reviewed, ready to publish
      v.literal('publishing'),
      v.literal('published'),
      v.literal('failed'),
    ),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
  }).index('by_post', ['postId']),
});
```

One evolving row per (post, platform) — not a separate "drafts" table and "results" table — because
a platform post genuinely moves through draft → approved → published as ONE lifecycle, and every
stage's data (the generated text, the flags, the final text, the outcome) belongs together for
history to make sense later.

**Correction (found during the build, not at planning time): media DOES transit Convex file
storage, for every platform, not just YouTube.** The original plan assumed the client could hand a
platform adapter a local device URI directly. It can't — once Bluesky's and Composio's calls moved
server-side into Convex actions (per the correction earlier in this section), a Convex action has
no way to read a `file://` path off the phone. So the actual flow is: the client uploads picked
media to Convex file storage first (`generateUploadUrl` + a direct PUT), gets a storage ID back,
and `publishPost` resolves that to a fetchable URL via `ctx.storage.getUrl()` once, reusing it
across whichever platforms need it. Convex still never stores the media in a *table* (the original
point of this rule) — the file storage bucket is a relay, not a database record, and it's fetched
by the platform's own upload call, not re-hosted.

**Credentials still do not go through Convex tables** — the Composio API key and Bluesky app
password live in Convex's server-side environment variables (`npx convex env set`), never in a
table, never shipped to the client.

## 4. LLM post generation

**Provider:** OpenAI, using the API credits granted for the hackathon — sponsor-aligned
and zero additional setup cost. (Swappable later; the generation prompt doesn't depend on the
provider.)

**Where it runs:** a Convex `action` (not a `mutation` — actions are the only Convex function type
allowed to call external HTTP APIs), one call per selected platform.

**Prompt structure** (condensed from `outreach/workflows/content_guardrails.md` — the actual rules
the owner's content already follows, not a paraphrase):

- No em-dashes, no curly quotes, no hashtags, no hype emojis (🚀💡✨🔥⚡🎯💪🙌👀🤯🧵)
- No banned tell-words (delve, leverage, streamline, robust, seamless, holistic, ecosystem,
  game-changing, paradigm, empower, thought leadership, and the rest of the table)
- No listicle openers ("Here are N things"), no question openers, no self-praise, no closing
  platitudes ("Thanks for reading", "Follow for more")
- First person, active voice, short sentences, one claim per paragraph, real numbers over vague
  praise
- Lead with the actual claim — the first line IS the hook, never an announcement of what the post
  is about

**Per-platform additions to the same base prompt:**

| Platform | Extra instruction | Hard constraint |
|---|---|---|
| Bluesky | Target well under 280 characters (safety margin below the real 300-grapheme limit) | `checkSlop` truncates if the model overshoots anyway |
| LinkedIn | First 210 characters must contain the hook (LinkedIn truncates in-feed); blank line between paragraphs, no markdown headers; ending on a single question is allowed (drives comments) | none beyond LinkedIn's own ~3000 char ceiling, never hit here |
| YouTube | Generate `title` (≤100 chars, curiosity + clarity, no clickbait) and `description` (context, ≤5000 chars) as two separate fields, not a split of one blob | title/description are separate LLM outputs from the start, not post-hoc parsing |

**Regenerate loop:** if `checkSlop` flags something after generation, the flags are fed back into a
second LLM call as explicit negative examples ("avoid: <quote>, because it breaks <rule>") — this is
the app's only automated fix path; nothing is silently rewritten without going back through the
model or the user.

## 5. De-slop pipeline (the actual implementation, not a gesture at the idea)

This mirrors the real `de-slop` skill's philosophy exactly: **mechanical, unambiguous issues get
auto-fixed; everything else gets flagged with an exact quote, the rule it breaks, and a suggestion —
never silently rewritten.** The skill itself only ever detects; so does this.

`checkSlop(text: string): SlopFinding[]` — pure function, no LLM, runs client-side or in the Convex
action immediately after generation, sub-millisecond:

| Check | Detection | Action |
|---|---|---|
| Curly quotes (`" " ' '`) | Character match | **Auto-fix** → straight quotes (unambiguous, no meaning depends on it) |
| Em-dash (`—`), en-dash in prose | Character match | Flag only — the correct replacement (period/comma/"and") depends on the sentence, exactly why the real de-slop skill never auto-fixes this either |
| Banned tell-words | Word-boundary regex against the full table (delve, leverage, streamline, robust, seamless, holistic, ecosystem, paradigm, navigate, empower, thought leadership, etc.) | Flag with suggested replacement from the same table |
| Hashtags (`#\w+`) | Regex | Flag — content_guardrails bans hashtags entirely, on every surface |
| Hype emojis | Character match against the banned set (🚀💡✨🔥⚡🎯💪🙌👀🤯🧵) | Flag |
| Listicle / question openers | First-line regex (`^Here are`, `^Here's what`, `^Have you ever`, `^What if`, `^Did you know`, `^Why do`) | Flag |
| Self-praise phrases | Phrase match ("game-changing", "mind-blowing", "insanely good") | Flag |
| Closing platitudes | Last-line phrase match ("thanks for reading", "follow for more", "drop your thoughts") | Flag |
| Trailing ellipsis | Regex (`\.\.\.$` per sentence) | Flag |
| Tricolon of negation | Pattern match (`It's not X\. It's not Y\.`) | Flag if it appears more than once |

Findings are returned in the same shape the real de-slop scorecard uses — quote, rule broken,
suggestion — so the ReviewScreen can render them as inline chips under the exact offending phrase,
not a vague "this sounds AI-generated" warning.

## 6. Composio integration

**Update: Instagram and Pinterest joined LinkedIn/YouTube on Composio.** What was section 6 for
two platforms at V0's original planning time now covers four — Instagram and Pinterest were added
after confirming Composio's toolkits reach both the same way (own account, no hand-built OAuth).
The real tool slugs, the two-step Instagram container flow, the Pinterest board-id gap, and the
Instagram Meta-review finding (it is NOT friction-free the way LinkedIn/YouTube were — see that
section) all live in `docs/composio-setup.md`, not duplicated here.

**Update: Facebook joined via the same Composio pattern.** Facebook Pages (not personal profiles —
Meta's Graph API rejects that outright, confirmed against Composio's own docs) publish through
Composio the same way Instagram/Pinterest do: own account, no hand-built OAuth, `page_id` resolved
via an env var or a list-and-pick-first lookup (same shape as Pinterest's `board_id` gap). Unlike
Instagram/Pinterest, Facebook Page posts support text-only publishing with no media required,
matching LinkedIn's pattern. Full detail in `docs/composio-setup.md`'s Facebook section.

**Google Business Profile was evaluated and does not exist as a Composio toolkit** (checked against
Composio's live toolkit directory and four guessed slug variants, all returning 404 — see
`docs/composio-setup.md`'s Google Business Profile section for the full trail) — it is not
implemented anywhere in this app.

**Update: Twitter/X joined the roster too, with a real caveat, and Threads did not join at all.**
Both were checked against Composio's live docs before writing any code, per this project's own
standard of never guessing a tool slug. Full trail in `docs/composio-setup.md`'s Twitter/X and
Threads sections; summary here:
- **Twitter/X**: a real Composio toolkit exists (`TWITTER`, post tool
  `TWITTER_CREATION_OF_A_POST`), but as of February 2026 Composio removed its managed/shared
  credentials for this one platform, following X's own move to pay-per-use API pricing. This
  breaks the "no hand-built OAuth" pitch above for Twitter specifically: the account owner must
  create their own X Developer App and register it as a custom Auth Config in Composio's
  dashboard before connecting. X's write tier also now costs money per post regardless of how
  OAuth is brokered — $0.015 per standard post, $0.20 if the post contains a link, as of this
  build — a real, if small, per-post operating cost none of the other platforms in this app have.
- **Threads** (Meta's threads.net app): does **not** have a Composio toolkit at all as of this
  build (`docs.composio.dev/toolkits/threads` 404s; the full toolkit index has no Threads entry).
  This is not a review-wall friction question like Instagram's — there is no tool to call, full
  stop. `publishToThreads` in `convex/lib/composio.ts` is implemented to satisfy the same function
  contract every other platform follows, but always returns a clear "not available yet" error; it
  never reaches Composio's SDK. Everything else for Threads (schema literal, generation prompt,
  UI badge/label, optional-media dispatch case) is built and ready for the day a real toolkit
  exists.

**What Composio replaces:** the entire custom OAuth 2.0 PKCE implementation for LinkedIn and
YouTube that was mid-build before this replan. Composio already has its own approved, reviewed
LinkedIn and YouTube developer apps — the owner never creates separate apps or waits on a review queue.

**One-time setup (per platform, done once from a terminal, not from the app):**
```bash
npm install -g composio-core   # or npx composio, confirm current install method in their docs
composio login
composio connected-accounts link linkedin
composio connected-accounts link youtube
```
Each `link` command opens a browser OAuth consent screen (Composio's app and the owner's account) —
no developer console, no consent-screen configuration, no test-user allowlisting.

**Runtime usage (from a Convex action):**
```ts
import { Composio } from '@composio/core';
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

await composio.tools.execute('LINKEDIN_CREATE_POST', {
  userId: 'owner',                 // the linked-account identity, confirm exact param name in docs
  arguments: { text: finalText },
});

await composio.tools.execute('YOUTUBE_UPLOAD_VIDEO', {
  userId: 'owner',
  arguments: { title: youtubeTitle, description: finalText, videoUrl: uploadedMediaUrl },
});
```
Exact tool names/parameters need a doc check against `docs.composio.dev/tools/linkedin` and
`/tools/youtube` right before implementation — Composio's tool catalog is versioned and this spec
should not be trusted over their live docs for exact field names.

**Why Bluesky stays direct, not on Composio:** it's already fully working with zero OAuth (handle +
app password), and Composio would add a dependency for a platform that has no friction to begin
with. This is the "don't enforce it where it doesn't help" call — Composio is a tool for the two
platforms that actually needed it.

**No Composio branding anywhere in the UI (hard requirement).** The app never shows the word
"Composio," never shows its logo, never surfaces it as the auth provider. Platform chips read
"LinkedIn" / "YouTube" / "Bluesky" only. The "Connect" flow for LinkedIn/YouTube opens whatever
browser screen Composio's OAuth link produces (that screen is Composio's own UI, outside this app's
control), but every screen, string, and error message this app itself renders refers only to the
platform, never the tool used to reach it. Error messages from `lib/composio.ts` get mapped to
generic platform-level language ("Could not connect to LinkedIn") — never pass a raw Composio error
string to the UI, since some of those may contain "Composio" in the text.

**Media path for YouTube via Composio (resolved during the build):** confirmed against the
installed `@composio/core` SDK's actual source (`Files.node.ts`) that `composio.files.upload()`
accepts a URL directly and stages it with Composio server-side — `lib/composio.ts` never downloads
the video bytes itself. That URL is the same Convex storage URL every platform resolves via
`ctx.storage.getUrl()` in `publishPost.ts` (see the correction in section 3) — there's no
YouTube-specific exception in the end; media flows through Convex storage uniformly for every
platform that needs it.

## 7. Screens

1. **ComposeScreen** — brief input (replaces free-text post body), optional media picker, platform
   toggle chips (Connected/Not connected status per platform, driven by whether Composio has a
   linked account for LinkedIn/YouTube and whether `.env` has Bluesky creds), "Generate" button.
2. **ReviewScreen** (new) — one card per selected platform: generated text, inline flag chips
   under any flagged span, an editable text field (auto-fixes are already applied, user can edit
   further), a "Regenerate" button per platform, and the final "Publish to N platforms" action.
3. **HistoryScreen** — `useQuery` against Convex, lists past posts with their brief, per-platform
   final text, and outcome.

## 8. Module / file tree

**Correction from the first draft of this spec:** section 3 already established that the Bluesky
app password lives in Convex's server-side env vars, not the client's `.env`. That means the actual
`fetch` calls to Bluesky's API must run inside a Convex action too — a client-side `src/adapters/bluesky.ts`
can't read a Convex server secret. The tree below fixes that; nothing with a secret in it runs on
the client.

```
layer/
  convex/
    schema.ts
    generatePost.ts       // action: brief + platform -> generatedText (+ youtubeTitle)
    checkSlop.ts           // pure function, no external calls, no secrets — safe to share with client
    publishPost.ts         // action: orchestrates lib/bluesky.ts + lib/composio.ts, records results
    queries.ts              // listPosts, getPost
    lib/
      bluesky.ts             // direct AT Protocol calls — moved server-side, reads process.env inside Convex
      composio.ts             // thin wrapper: execute LinkedIn/YouTube tools, map errors to a PlatformPost result (never leaks raw Composio error text to the UI)
  src/
    types.ts                  // client-side view types only, no adapters, no secrets
    screens/
      ComposeScreen.tsx
      ReviewScreen.tsx         // new
      HistoryScreen.tsx        // new
```

Nothing under `src/` ever imports a platform SDK or holds a credential. The mobile app only ever
calls Convex functions (`useQuery`/`useMutation`/`useAction`) and renders their results — this is
what "credentials never leave Convex" actually requires structurally, not just as a stated rule.

`adapters/linkedin.ts` and `adapters/youtube.ts` (the custom-OAuth stubs from the earlier attempt)
get deleted, not kept as dead code — Composio replaces them entirely.

## 9. Setup checklist (updated — materially shorter than the OAuth-everything-yourself version)

1. Bluesky: app password from bsky.app/settings/app-passwords (2 min, unchanged)
2. Composio: sign up, `composio login`, link LinkedIn + YouTube + Instagram + Pinterest + Facebook
   (10-15 min total, no developer console, no review wait — except Instagram's own account-type
   requirement and Facebook's Page-not-personal-profile requirement, see `docs/composio-setup.md`'s
   Instagram and Facebook sections for the two real caveats)
3. Twitter/X (separate step, not "no developer console" like step 2): create an X Developer App
   at console.x.com, register it as a custom Auth Config in Composio's dashboard
   (composio.dev/auth/twitter), then `composio link twitter` — see docs/composio-setup.md's
   Twitter/X section. Threads has no setup step because it has no Composio toolkit yet; skip it.
4. Convex: `npx convex dev` (5 min, interactive login)
5. OpenAI API key for generation (available through the hackathon's API credits)
6. Set secrets server-side: `npx convex env set COMPOSIO_API_KEY ...`, `npx convex env set
   OPENAI_API_KEY ...`, `npx convex env set BLUESKY_HANDLE ...`, `npx convex env set
   BLUESKY_APP_PASSWORD ...` — nothing goes in the mobile app's `.env` anymore except the Convex
   deployment URL, which is not a secret.

## 10. Resolved during the build (was "open decisions before implementation resumes")

1. **Composio tool names/params** — confirmed by reading the installed `@composio/core` package's
   actual source, not just docs. One real gap remains: per-tool argument schemas beyond
   `author`/`commentary`/`visibility` (LinkedIn) require a live `COMPOSIO_API_KEY` to verify against
   Composio's backend, which wasn't available during the build. `docs/composio-setup.md` documents
   the exact recovery command (`composio execute <slug> --get-schema`) for once real credentials
   land.
2. **Review step friction** — built as: every post requires a tap through ReviewScreen before
   publish. No auto-advance path exists.
3. **YouTube media relay** — resolved: not YouTube-specific. See the section 6 update above; media
   for every platform flows through Convex file storage the same way.

Still genuinely open, blocking live (not structural) verification: the actual `OPENAI_API_KEY`,
`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, and `COMPOSIO_API_KEY` values, plus running the Composio
CLI login/link steps in `docs/composio-setup.md`.
