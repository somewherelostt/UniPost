# UniPost — V1 spec: self-learning content system

Roadmap beyond the hackathon demo. Nothing here gets built until V0 is proven live on all three
V0 platforms with real credentials. Recorded now so V0's data model doesn't have to be reshaped
later — several tables below were already anticipated in V0's schema for exactly this reason.

## 1. What "self-learning" actually means here

The reference point is Hermes Agent's (Nous Research) closed learning loop: it doesn't train a
model, it **observes outcomes, curates them into a persistent profile, and feeds that profile back
into the next generation** — "builds a deepening model of who you are across sessions," in their
own framing. UniPost's V1 goal is the same loop, applied to content instead of conversation:

```
publish a post
     │
     ▼
poll each platform's read API for engagement (likes, reposts, comments, views)
     │
     ▼
periodic "reflection" job: compare this post's performance against the user's own baseline,
extract what correlated with doing better or worse (topic, angle, length, platform, media type,
day/time), write the finding into a persistent, growing profile
     │
     ▼
V0's generatePost action reads that profile and includes it as context for the next post
     │
     ▼
(loop)
```

This is NOT a new parallel system. It's V0's existing `generatePost` action gaining one more input
source, and a new scheduled job that maintains that input. No new ML infrastructure, no training
run, no embeddings pipeline required for a first version — the "learning" is an LLM reflection step
writing structured findings to a Convex table, read back in as prompt context. This is buildable
with the same tools already in this project.

## 2. A real constraint that shapes scope: not every platform exposes engagement data equally

This has to be said before any schema gets designed, because it determines what the loop can
actually learn from at V1:

- **Bluesky**: fully open, public read API (`app.bsky.feed.getPosts` and related endpoints return
  like/repost/reply counts for any post, no special scope beyond what V0 already has). Fully
  automatable.
- **YouTube**: the YouTube Analytics API exposes view/like/comment counts to the channel owner —
  automatable, but is a distinct API surface from the Data API v3 upload endpoint V0 already uses,
  and needs its own scope/auth check.
- **LinkedIn**: personal-profile post engagement (likes/comments/reposts on an individual member's
  post) is **not** reliably available through LinkedIn's standard developer access. Social-action
  counts for personal posts sit behind LinkedIn's Marketing Developer Platform, which requires a
  separate, heavier partner application — well beyond what "Share on LinkedIn" (what V0 uses via
  Composio) grants. **This may mean LinkedIn simply doesn't contribute automated engagement data in
  V1.** Two honest options, not a blocker to work around silently: (a) scope V1's automated learning
  loop to Bluesky + YouTube only, and let LinkedIn ride along in the same posting flow without
  feeding the loop; (b) add a manual entry point where the user can type in LinkedIn's own
  in-app-visible engagement numbers for a post, if the loop should include it anyway. Recommend (a)
  for V1 — don't build a manual-entry UI for a nice-to-have before the automated case is proven.

## 3. Data model (Convex)

```ts
postMetrics: defineTable({
  platformPostId: v.id('platformPosts'),
  platform: v.union(v.literal('bluesky'), v.literal('youtube')),  // linkedin excluded, see section 2
  likes: v.optional(v.number()),
  reposts: v.optional(v.number()),
  comments: v.optional(v.number()),
  views: v.optional(v.number()),
  fetchedAt: v.number(),
}).index('by_platform_post', ['platformPostId']),

learnedInsights: defineTable({
  createdAt: v.number(),
  basedOnPlatformPostIds: v.array(v.id('platformPosts')),  // which posts this finding came from
  category: v.union(
    v.literal('topic'),      // "posts about X outperform posts about Y"
    v.literal('format'),     // "shorter posts do better on bluesky", "questions at the end drive replies"
    v.literal('timing'),     // "posts published in the morning IST do better" (only once enough data exists)
    v.literal('platform'),   // "this angle works on youtube but not bluesky"
  ),
  finding: v.string(),        // one plain-English sentence, the actual learned heuristic
  confidence: v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
  // confidence is set by the reflection job based on sample size, not a rewrite of the finding
  active: v.boolean(),        // findings can be superseded/retired, not just accumulated forever
}),
```

`learnedInsights` is deliberately a list of plain-English findings with provenance (which posts,
what confidence), not a black-box score or embedding — this is what makes it inspectable and
editable, and what makes it directly insertable into an LLM prompt without a translation layer.

## 4. Analytics ingestion

A Convex scheduled function (`crons.ts`, interval to be tuned — start with once daily, since
engagement on a single post rarely changes meaningfully hour to hour after the first day) that:

1. Queries `platformPosts` where `status = 'published'` and `platform` is `bluesky` or `youtube`.
2. Calls Bluesky's public read API directly (no new credential needed beyond what V0 already has)
   or the YouTube Analytics API (needs a new read scope added to the existing YouTube OAuth grant —
   confirm whether this requires re-authorizing or is additive).
3. Writes a `postMetrics` row per poll. Keep every poll (don't overwrite), so the reflection job can
   see engagement trajectory, not just a final number.

## 5. The reflection job

A second scheduled Convex action, run less often than ingestion (weekly is a reasonable start,
since it needs enough posts to compare against each other to say anything meaningful):

1. Pull all `platformPosts` with at least one `postMetrics` row from the last window.
2. One LLM call: given the list of (brief, generated text, platform, metrics) tuples, ask it to
   identify what distinguished the better-performing posts from the worse-performing ones, in the
   same voice/rigor as a real analyst would — specific, falsifiable claims, not vague praise. This
   reuses the same anti-slop discipline as `generatePost`'s own prompt (a "finding" that reads like
   AI-generated business-speak is exactly as much of a failure here as it would be in a post).
3. Each finding becomes a new `learnedInsights` row. Set `confidence: 'low'` under some sample-size
   threshold (e.g. fewer than 5 posts informing a claim) regardless of how confidently the model
   states it — the confidence field is a rule-based floor, not something the LLM self-reports.
4. **Cold-start handling**: with fewer than ~5-10 published-and-measured posts, skip the reflection
   entirely rather than generating low-signal findings from noise. `generatePost` should work fine
   with zero `learnedInsights` rows — this is an enhancement layer, not a dependency V0's flow
   breaks without.

## 6. Feeding the loop back into generation

Extends V0's `generatePost` action (`convex/generatePost.ts`), not a new function:

- Before building the prompt, query `learnedInsights` where `active = true`, ordered by confidence,
  capped at some small number (e.g. top 5) to avoid bloating the prompt.
- Add a new prompt section, after the static anti-slop rules and before the per-platform
  instructions: "What has actually worked for this account so far: <finding 1>, <finding 2>, ...
  Use this as guidance, not a rigid rule — a single post's brief can still call for something
  different."
- This is additive, ordered after the non-negotiable anti-slop rules, so a learned insight can never
  override "no em-dashes" or any other hard rule — it only ever adds judgment on top.

## 7. Suggestions surface

A new, small addition to ComposeScreen (not a whole new screen for V1) — before the brief input, if
`learnedInsights` has any `active` rows, show up to 2-3 as tappable suggestion chips (e.g. "Posts
about shipping process outperform posts about tools, 3 to 1 — write about that again?"). Tapping one
pre-fills the brief field with a prompt derived from that finding, not the finding's raw text
verbatim (the finding is an analyst's note to the system, not user-facing copy — it still needs to
become an actual brief, then go through the whole V0 pipeline including the slop check).

## 8. New platforms — Instagram, Pinterest, X/Twitter

**Update: Instagram and Pinterest moved into V0 scope** (added alongside V0, not held for V1) once
Composio was confirmed to cover both the same low-friction way it already covered LinkedIn/YouTube
— see `docs/spec-v0.md` section 6 and `docs/composio-setup.md` for the real integration, tool
slugs, and the Instagram Meta-review finding (short version: Composio's own app still doesn't erase
Meta's underlying Business/Creator-account requirement, and multi-user publish scale is not fully
verified without a live account — see composio-setup.md for the actual caveat, not an assumption
that it's friction-free just because LinkedIn/YouTube were). Pinterest followed the same evaluation
and had no comparable friction, so it rode along with Instagram rather than waiting for its own V1
slot.

X/Twitter remains deferred from V0 for API-access-friction reasons, not architectural ones:

- **X**: no free write tier as of 2026 — pay-per-post (~$0.015/post). Trivial cost once this is a
  real product with real usage.

It slots into the same shape every V0 platform already follows: a `convex/lib/<platform>.ts`
module (direct API or Composio, whichever removes more friction, same evaluation V0 already did for
Bluesky vs. LinkedIn/YouTube/Instagram/Pinterest) plus a new branch in `publishPost.ts`'s dispatch
and `generatePost.ts`'s per-platform instructions. No architecture change needed — this is why V0's
dispatch is a plain switch statement over a platform union type, not a registry pattern that would
need redesigning.

## 9. Scheduling

A post gets an optional `scheduledFor: number` (epoch ms) instead of publishing immediately. Needs a
Convex scheduled function that polls for due posts and calls the same `publishPost` action V0
already uses interactively — the publish logic itself doesn't change, only what triggers it.

## Not deciding now

Multi-account/team support, approval workflows, sentiment analysis, embeddings-based topic
clustering (an LLM reflection call is enough signal at this data volume; revisit only if the
finding quality actually degrades at scale) — no data collected yet to justify designing any of
these, and Hermes Agent's own lesson here is instructive: it curates plain findings into memory
before reaching for anything heavier, and only adds structure when the plain version stops working.
