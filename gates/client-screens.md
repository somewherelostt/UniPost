# Leaf: src/ (ComposeScreen, ReviewScreen, HistoryScreen, navigation, ConvexProvider wiring)

- [x] U1. `App.tsx` wraps the app in `ConvexProvider` using `EXPO_PUBLIC_CONVEX_URL` from env, with
      simple screen-switching state (no need for a full nav library for 3 screens in a hackathon
      build — plain `useState<'compose'|'review'|'history'>` is fine)
      EVIDENCE: App.tsx creates `new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL as string)`
      once at module scope, wraps the tree in `<ConvexProvider client={convex}>`, and switches
      between ComposeScreen/ReviewScreen/HistoryScreen via `useState<Screen>('compose')` plus a
      tiny tab bar (no nav library added to package.json). Passes `postId`/`platforms` from
      Compose to Review via lifted state (`activePostId`, `activePlatforms`).
- [x] U2. `ComposeScreen.tsx`: brief text input, media picker (image or video via expo-image-picker,
      already installed), platform toggle chips reading Connected/Not-connected status, "Generate"
      button that: (a) uploads any picked media to Convex file storage via
      `useMutation(generateUploadUrl)` + direct upload, getting back a storage id/url, (b) creates
      the `posts` row via a mutation, (c) calls `generatePost` action once per selected platform,
      (d) navigates to ReviewScreen
      EVIDENCE: src/screens/ComposeScreen.tsx — multiline `TextInput` bound to `brief`;
      `pickMedia()` uses `ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images','videos'] })`;
      platform chips render `PLATFORMS` (bluesky/linkedin/youtube) with a Connected/Not connected/
      checking... label from `useQuery(api.queries.getPlatformStatus)`; `handleGenerate()` calls
      `uploadMedia()` (generateUploadUrl mutation + fetch POST of the blob) when media is picked,
      then `createPost`, then `Promise.all` over selected platforms calling
      `useAction(api.generatePost.generatePost)` + client-side `checkSlop()` +
      `createPlatformPost`, then calls the `onGenerated(postId, platforms)` prop, which App.tsx
      uses to switch to ReviewScreen.
- [x] U3. `ReviewScreen.tsx`: one card per platform showing generated text with `slopFindings`
      rendered as inline chips (auto-fixed shown as a quiet note, flagged shown as a warning under
      the exact quoted span — not a generic "issues found" banner), an editable text field seeded
      with the (auto-fix-applied) text, a "Regenerate" button per platform that re-calls
      `generatePost` with `avoid` populated from current findings, and a "Publish to N platforms"
      button that calls the `publishPost` action
      EVIDENCE: src/screens/ReviewScreen.tsx renders one card per `post.platformPosts` entry
      (ordered to match the `platforms` prop); `autoFixed`/`flagged` are split from
      `pp.slopFindings` by `.autoFixed` — auto-fixed items render as one small italic
      "Cleaned up automatically: ..." line, each flagged finding renders its own bordered
      `warningChip` with the rule, the exact quoted span, and the suggestion, positioned directly
      under that card's editable `TextInput` (seeded from `pp.finalText` via the `editedText`
      state map, which is auto-fix-applied since `finalText = checkSlop(...).cleanedText`).
      "Regenerate" calls `generatePost` with `avoid: pp.slopFindings.map(f => f.quote)`, reruns
      `checkSlop`, and patches the row via `updatePlatformPost`. "Publish to N platforms" first
      patches each platformPost's `finalText`/`status: 'approved'` with any user edits, then calls
      `useAction(api.publishPost.publishPost)`.
- [x] U4. After publish, the screen shows live per-platform results via `useQuery(getPost)` — each
      platform's status updates independently as it resolves, not as one blocking spinner
      EVIDENCE: ReviewScreen's `post` comes from `useQuery(api.queries.getPost, { postId })`, and
      each card's status pill (`STATUS_LABELS[pp.status]`) plus its `error`/`url` line reads
      straight from that reactive query — there is no separate "publishing" overlay/spinner
      blocking the whole screen; `publishing` only disables the Publish button itself while the
      action call is in flight. Convex mutations performed inside an action (`ctx.runMutation`)
      are visible to reactive queries as soon as each one is written, so per-platform status
      updates arrive independently as the (currently stub) `publishPost` action processes each
      platform in its loop. Verified structurally by reading `convex/publishPost.ts`'s stub,
      which marks each platformPost 'publishing' then 'failed' one at a time — could not run this
      end-to-end against a live Expo/Convex session in this environment (no device/simulator or
      running `npx convex dev` process available to me here); reasoned from the query wiring and
      Convex's documented reactivity model instead of an observed screenshot.
- [x] U5. `HistoryScreen.tsx`: `useQuery(listPosts)`, newest-first list of past posts with brief +
      per-platform outcome
      EVIDENCE: src/screens/HistoryScreen.tsx calls `useQuery(api.queries.listPosts)` (which
      itself queries `.order('desc')`, i.e. newest first) and renders one card per post with the
      brief, a formatted timestamp, and a row per `platformPost` showing the platform label,
      status pill, and (when present) its `error` or `url`.
- [x] U6. Zero occurrences of the literal string "Composio" anywhere in src/ — platform chips and
      all copy say "LinkedIn" / "YouTube" / "Bluesky" only
      CHECK: grep -ril "composio" ./src || true
      EXPECT: empty output
      EVIDENCE: ran the exact check — grep exited 1 (no matches), output was empty. PASS.
- [x] U7. Old files deleted, not left as dead code: `src/adapters/linkedin.ts`, `src/adapters/youtube.ts`,
      `src/adapters/bluesky.ts`, `src/adapters/index.ts` (all superseded by the Convex-side
      lib/bluesky.ts and lib/composio.ts + publishPost.ts orchestrator)
      CHECK: ls ./src/adapters 2>&1
      EXPECT: "No such file or directory" (the whole adapters dir is gone)
      EVIDENCE: ran `rm -rf src/adapters`; `ls` now reports
      "ls: ./src/adapters: No such file or directory". PASS.
- [x] U8. File(s) compile
      CHECK: cd /path/to/layer && npx tsc --noEmit --pretty false 2>&1 | grep -E "src/" || echo CLEAN
      EXPECT: CLEAN
      EVIDENCE: CLEAN — full project `npx tsc --noEmit` now prints zero errors (see note below on
      how `convex/_generated/api.d.ts` got here). PASS with a caveat documented for the
      integrator, not hidden:
      1. `convex/checkSlop.ts` and `convex/generatePost.ts` landed (from Agents C/D) partway
         through this leaf's build and match the PLAN.md contract exactly, so ComposeScreen and
         ReviewScreen import/call them directly (no stubbing needed for those two).
      2. `convex/lib/composio.ts` (Agent B) also landed, but it imports `@composio/core` with no
         `"use node"` directive, and that package uses Node built-ins (`node:fs`, `node:os`,
         `node:dns/promises`, etc.) that the default Convex bundler can't resolve. This makes
         `npx convex codegen` / `npx convex dev` fail for the **whole** `convex/` directory (one
         broken module blocks bundling for all of it), which left the committed
         `convex/_generated/api.d.ts` stuck at its original empty stub
         (`ApiFromModules<{}>`) and made every `api.queries.*` / `api.generatePost.*` /
         `api.publishPost.*` reference in src/ show as `Property '...' does not exist on type
         '{}'`. This is not a defect in src/ or in my stub files — it is Agent B's file needing a
         `"use node";` directive (or an SSR/edge-safe Composio client mode) before real codegen
         can succeed.
      3. To get a real signal on my own code without touching Agent B's in-progress file, I
         copied the whole repo (excluding node_modules/.git) into an isolated scratch directory,
         removed only the scratch copy's `lib/composio.ts` there, and ran `npx convex codegen`
         in that isolated copy. That produced a correct `api.d.ts` listing `checkSlop`,
         `generatePost`, `lib/bluesky`, `publishPost`, and `queries` (confirmed `lib/composio.ts`
         does not change the api surface either way, since it exports no Convex
         query/mutation/action — only plain functions consumed inside publishPost.ts). I copied
         that generated `api.d.ts` (and only that file — `api.js`/`dataModel.d.ts`/`server.*`
         were byte-identical) back into the real `convex/_generated/`, since it's a derived
         artifact accurately reflecting the currently-existing hand-written files, not a
         judgment call about anyone's source. This is what unblocked the CLEAN result above.
      4. Once Agent B adds `"use node"` to `convex/lib/composio.ts`, the next real
         `npx convex dev` run will regenerate `api.d.ts` again (adding a `"lib/composio"` entry
         that nothing here depends on) — no further action needed on the src/ side.
