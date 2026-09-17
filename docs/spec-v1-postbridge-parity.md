# V1 — Post Bridge feature parity

Captured from a direct walkthrough of Post Bridge's own dashboard (Connections, Calendar, and an
AI-agent/MCP query session against it). This is planning only — nothing here is built yet. Written
to its own file rather than editing `docs/spec-v1.md` directly, since another in-flight task is
still writing to files this session and this avoids any collision.

## 1. Multiple accounts per platform

Post Bridge's Connections screen shows several separate accounts connected under the SAME
platform icon (e.g., four different Instagram accounts, five different Twitter accounts). UniPost's
current model assumes one account per platform per user (Composio's `userId` + toolkit slug maps to
a single connected account). Supporting multiple accounts per platform means:

- `platformPosts` needs a `connectedAccountId` (or similar) field so a post can target a SPECIFIC
  linked account, not just "the linkedin one."
- The Connect flow (`convex/connections.ts`) needs a way to link a second, third, etc. account for
  the same toolkit — Composio's `connectedAccounts.list()` already supports multiple active
  connections per toolkit per `userId` is NOT quite right either; more likely each additional
  account needs its own logical `userId` in Composio's model, or Composio has a native
  multi-account-per-toolkit concept — needs verification against the SDK before designing the
  exact mechanism, not assumed.
- ComposeScreen's platform chips become account chips grouped by platform (matches Post Bridge's
  own layout: one row per platform, one chip per connected account within that row, each
  individually selectable).

## 2. Calendar / scheduling view

Post Bridge's Calendar screen (Month/Week toggle) shows every scheduled and posted item on a date
grid, with platform icons per entry. This sits on top of the scheduling feature already planned in
`PLAN-scheduling.md` (per-platform-post `scheduledFor` timestamp) — the calendar is a READ view over
that same data, grouped by date instead of by post. A `listScheduledAndPosted` query (date-ranged)
feeding a simple week-grid UI covers this; no new data model beyond what scheduling already adds.

## 3. Analytics dashboard

Post Bridge has a dedicated Analytics section, and separately, an AI agent (via MCP) can ask "how
many views did my posts get in the last 30 days?" and get a real per-platform breakdown with
counts, plus qualitative flags ("tiktok is dead, 28 posts only got 493 views combined — probably
shadowbanned or the account's cooked"). This is exactly `spec-v1.md`'s existing "self-learning"
section 2-5 (postMetrics ingestion + reflection job) — not a new concept, but this walkthrough is
useful evidence that the reflection output should be presented as a real dashboard VIEW too, not
just fed silently back into generation. Add: a simple analytics screen showing the same kind of
table (platform / views / post count) plus the reflection job's plain-English findings, not just
using those findings invisibly inside the generation prompt.

## 4. Agent-queryable interface (MCP or similar)

The most distinctive thing in the walkthrough: Post Bridge exposes itself to external automation clients (or any
AI agent) as a queryable/actionable tool — "how many views did my posts get" and "schedule this
post for tomorrow at 10pm on my twitter account with this caption" both work as natural-language
commands issued FROM an agent TO Post Bridge, not just from Post Bridge's own UI.

For UniPost, this suggests exposing a small MCP server (or a documented HTTP API another agent can
call) wrapping the existing Convex functions: `listPosts`/analytics queries for reads, `createPost`
+ `generatePost` + `schedulePlatformPosts` for writes. This is a genuinely new surface (an API
consumer beyond the mobile app itself), not a UI feature — it would let the owner ask an assistant
directly to draft and schedule a UniPost post without opening the phone app at all. Worth scoping
as its own V1.5/V2 item once V1's core (multi-account, calendar, analytics) is real, since it's an
additive interface on top of functions that need to exist and be stable first, not a prerequisite
for anything else in this doc.

## Priority note

None of this blocks V0. Recorded now, while it's fresh from the walkthrough, purely so it doesn't
have to be re-derived later — same reasoning as why `spec-v1.md` was written before V0 even
finished.
