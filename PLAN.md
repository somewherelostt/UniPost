# UniPost V0 — build plan

Tier: hackathon build, real integrations, no placeholders. Orchestrated mode (unlazy v2), tree
depth 4. Full design lives in `docs/spec-v0.md` — this file is the leaf decomposition and the
CONTRACTS every leaf must build against, so parallel work integrates without drift.

## Contracts (locked before fan-out — do not change without updating this file)

### Convex schema (owned by root, not a leaf — defined once in `convex/schema.ts`)

```ts
posts: defineTable({
  brief: v.string(),
  mediaType: v.union(v.literal('none'), v.literal('image'), v.literal('video')),
  createdAt: v.number(),
}),

platformPosts: defineTable({
  postId: v.id('posts'),
  platform: v.union(
    v.literal('bluesky'), v.literal('linkedin'), v.literal('youtube'),
    v.literal('instagram'), v.literal('pinterest')
  ),
  generatedText: v.string(),
  finalText: v.string(),
  youtubeTitle: v.optional(v.string()),
  slopFindings: v.array(v.object({
    rule: v.string(),
    quote: v.string(),
    suggestion: v.string(),
    autoFixed: v.boolean(),
  })),
  status: v.union(
    v.literal('draft'), v.literal('approved'), v.literal('publishing'),
    v.literal('published'), v.literal('failed'),
  ),
  url: v.optional(v.string()),
  error: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
}).index('by_post', ['postId']),
```

### Function contracts (each leaf implements ONE of these; no leaf touches another's file)

- `convex/checkSlop.ts` — pure function, no Convex imports, no I/O:
  ```ts
  export interface SlopFinding { rule: string; quote: string; suggestion: string; autoFixed: boolean }
  export function checkSlop(text: string, allowHashtags?: boolean): { cleanedText: string; findings: SlopFinding[] }
  ```
  `cleanedText` = input with auto-fixable issues (curly quotes only) already applied.
  `findings` includes BOTH auto-fixed and flagged-only issues (auto-fixed ones have `autoFixed: true`
  so the UI can show "fixed" vs "you should look at this" differently). Full rule table is in
  `docs/spec-v0.md` section 5 — implement every row in that table, not a subset.
  `allowHashtags` (default `false`) downgrades the hashtag rule from "flag every hashtag" to "flag
  only generic, non-specific hashtags" — added when Instagram/Pinterest landed, since those two
  platforms are discovery/hashtag-driven and the universal ban would hurt real reach there. Callers
  pass `PLATFORMS_ALLOWING_HASHTAGS.includes(platform)` (src/types.ts) — see ComposeScreen.tsx and
  ReviewScreen.tsx.

- `convex/lib/bluesky.ts`:
  ```ts
  export async function publishToBluesky(text: string, mediaUri?: string): Promise<{ success: boolean; url?: string; error?: string }>
  ```
  Reads `process.env.BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` (Convex env, not client). Port the
  logic from the git history at commit `c51a6a3` (`src/adapters/bluesky.ts` — already working,
  proven AT Protocol calls) into this Convex-side module. `mediaUri` here is a Convex storage URL
  or a remote-fetchable URL, NOT a local device `file://` URI (the client can't hand a Convex
  action a local device path) — see the media-upload note in the ComposeScreen leaf below.

- `convex/lib/composio.ts`:
  ```ts
  export async function publishToLinkedIn(text: string): Promise<{ success: boolean; url?: string; error?: string }>
  export async function publishToYouTube(title: string, description: string, videoUrl: string): Promise<{ success: boolean; url?: string; error?: string }>
  export async function publishToInstagram(caption: string, mediaUrl: string): Promise<{ success: boolean; url?: string; error?: string }>
  export async function publishToPinterest(title: string, description: string, mediaUrl: string, link?: string): Promise<{ success: boolean; url?: string; error?: string }>
  ```
  Reads `process.env.COMPOSIO_API_KEY`. **Before writing this file: run `npm install @composio/core`
  in the project, then read its actual `.d.ts` type definitions in `node_modules/@composio/core` for
  the real client initialization and execute-call signature** — the scraped docs available during
  planning were incomplete (confirmed gaps: exact session/execute method signature, exact
  `LINKEDIN_CREATE_LINKED_IN_POST` field names beyond `author`/`commentary`/`visibility`, whether
  `GET_MY_INFO` needs to be called once and cached or on every publish). Trust the installed
  package's types over any doc page. **Never let a raw Composio error string reach the caller** —
  catch and rewrap as a generic platform-level message (see spec-v0.md's no-branding requirement).

  **Instagram/Pinterest addendum (found during that build):** the installed `@composio/core`
  ships NO local tool catalog for ANY toolkit, not just these two (confirmed by grepping the whole
  package for "instagram"/"pinterest" — zero hits) — so "read the installed package's source" was
  not possible the way it was implied to be. Tool slugs and argument names for both were instead
  read off Composio's live hosted docs (`docs.composio.dev/toolkits/instagram`,
  `/toolkits/pinterest`) during the build; see the comment block above `INSTAGRAM_TOOLKIT_SLUG` in
  `convex/lib/composio.ts` for the exact trail. Instagram requires a two-step container
  create-then-publish flow (no single "create post" tool); Pinterest's `PINTEREST_CREATE_PIN`
  requires a `board_id` this app's schema has no field for, resolved via a `PINTEREST_BOARD_ID` env
  var or a `PINTEREST_LIST_BOARDS` lookup — see `docs/composio-setup.md`.

- `convex/generatePost.ts` — Convex `action`:
  ```ts
  export const generatePost = action({
    args: { brief: v.string(), platform: v.union(v.literal('bluesky'), v.literal('linkedin'), v.literal('youtube'), v.literal('instagram'), v.literal('pinterest')), avoid: v.optional(v.array(v.string())) },
    handler: async (ctx, args) => { /* returns { generatedText: string, youtubeTitle?: string } */ }
  })
  ```
  `args.avoid` is the regenerate-loop input (quotes from previous `SlopFinding`s to explicitly avoid).
  Reads `process.env.OPENAI_API_KEY`. Prompt content is fully specified in spec-v0.md section 4 —
  implement the full per-platform table, not a generic prompt.

- `convex/publishPost.ts` — Convex `action`, root-owned integration point (not a separate leaf,
  written after the lib files land):
  ```ts
  export const publishPost = action({
    args: { postId: v.id('posts'), platforms: v.array(v.union(v.literal('bluesky'), v.literal('linkedin'), v.literal('youtube'), v.literal('instagram'), v.literal('pinterest'))) },
    handler: async (ctx, args) => { /* for each platform: mark 'publishing', call the matching lib fn, patch platformPosts with result */ }
  })
  ```

- `convex/queries.ts`:
  ```ts
  export const listPosts = query({ args: {}, handler: /* posts + their platformPosts, newest first */ })
  export const getPost = query({ args: { postId: v.id('posts') }, handler: /* one post + its platformPosts */ })
  ```

### Client (mobile) leaf

- `src/screens/ComposeScreen.tsx` — brief input, media picker (image/video), platform toggle chips.
  On submit: calls a mutation to create the `posts` row, then calls `generatePost` action per
  selected platform, navigates to ReviewScreen with the resulting draft ids.
- `src/screens/ReviewScreen.tsx` — renders each platform's `generatedText` + `slopFindings` as
  inline chips (auto-fixed shown as a quiet "cleaned up" note, flagged shown as a warning chip under
  the exact quoted span), editable text field, "Regenerate" (re-calls `generatePost` with `avoid`
  populated from current findings), "Publish" (calls `publishPost` action, then shows live
  per-platform results as `useQuery(getPost)` updates).
- `src/screens/HistoryScreen.tsx` — `useQuery(listPosts)`, list newest-first.
- **Media upload note:** since Convex actions can't read a local device file path, media picked in
  ComposeScreen must go through `useMutation(generateUploadUrl)` + a direct upload to Convex file
  storage first (standard Convex file-upload pattern), and the resulting Convex storage URL is what
  gets passed to `publishPost` → `lib/bluesky.ts` / `lib/composio.ts`. This applies to ALL media now
  (not just the YouTube-only exception the first draft of the spec assumed) because the client
  genuinely cannot hand any remote server function a `file://` path — update spec-v0.md section 6's
  "media never touches Convex" framing to reflect this once this leaf lands (it was wrong: media
  transits Convex file storage as a relay for every platform that needs it, not just YouTube; it is
  still never a Convex *table* field, which was the actual point of that rule).

## Leaves and status

| Leaf | Owner | Status |
|---|---|---|
| Project files | root | done |
| Spec corrections | root | done |
| `convex/schema.ts` | root | done |
| `convex/checkSlop.ts` | Agent C | done — gates/checkslop.md 6/6 |
| `convex/generatePost.ts` | Agent D | done — gates/generatepost.md 6/6 |
| `convex/lib/bluesky.ts` | Agent A | done — gates/bluesky.md 4/4 |
| `convex/lib/composio.ts` | Agent B | done — gates/composio.md 6/6 |
| `convex/publishPost.ts`, `convex/queries.ts` | root | done (queries.ts kept as written by Agent E per note below; publishPost.ts rewritten by root to wire real dispatch) |
| Client screens | Agent E | done — gates/client-screens.md 8/8 |
| Integration + tsc + convex codegen check | root | done — GATES.md G1-G8 all checked |

## Status log

- 2026-08-30: project workspace prepared and spec corrected
  (Bluesky moved server-side, no-branding requirement added), plan written, fanning out leaves.
- 2026-08-30: all 5 leaves landed (30/30 leaf gate checkboxes). Cloud Convex project created,
  replacing the local anonymous
  deployment. Root integration found and fixed two real bugs the leaves couldn't have caught in
  isolation: (1) `convex/lib/composio.ts` needed a `"use node"` directive — `@composio/core`
  imports Node built-ins (`node:fs`, `node:os`, etc.) that fail to resolve in Convex's default
  bundler; without it, the entire `convex/` directory failed to bundle, not just that file. (2)
  Convex's own `convex/tsconfig.json` doesn't include Node's global types by default even with
  `@types/node` installed, so every `process.env` reference across `lib/bluesky.ts`,
  `lib/composio.ts`, and `queries.ts` failed Convex's internal typecheck (`Cannot find name
  'process'`) even though the root-level `npx tsc` had passed clean — fixed by adding `"types":
  ["node"]` to `convex/tsconfig.json`, per Convex's own error message. Rewrote `publishPost.ts`'s
  stub into the real dispatcher (bluesky direct, linkedin/youtube via composio, media resolved
  once via `ctx.storage.getUrl`). Kept Agent E's `queries.ts` as-is (already matched the contract
  plus reasonable, well-scoped additions for upload/create/patch that the contract didn't
  originally specify but the UI genuinely needed). Root gates G1-G8 all checked: whole-project
  `tsc` clean, Convex deploys clean against the real cloud project, zero "Composio" mentions in
  `src/`, zero leaked secrets, and a full `expo export --platform android` bundled 664 modules
  with zero errors.
- Still blocked on real credentials for live (not just structural) end-to-end verification:
  `OPENAI_API_KEY`, `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `COMPOSIO_API_KEY` (plus the
  Composio CLI login/link step) — the app builds and boots without them, it just can't generate
  or publish anything for real until they're set via `npx convex env set`.
