# Leaf: convex/lib/bluesky.ts

- [x] B1. File exists, exports `publishToBluesky(text: string, mediaUrl?: string): Promise<{ success: boolean; url?: string; error?: string }>`
      EVIDENCE:
      ```
      $ grep -n "publishToBluesky" convex/lib/bluesky.ts
      59:export async function publishToBluesky(
      $ sed -n '59,62p' convex/lib/bluesky.ts
      export async function publishToBluesky(
        text: string,
        mediaUrl?: string
      ): Promise<{ success: boolean; url?: string; error?: string }> {
      ```
      Signature matches the contract in PLAN.md exactly.

- [x] B2. Logic ported from the proven working implementation at git commit c51a6a3
      (`src/adapters/bluesky.ts` in this repo's history) — createSession, uploadBlob for image,
      createRecord — adapted to read `process.env.BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` and to
      accept a remote-fetchable `mediaUrl` (Convex storage URL) instead of a local device URI
      EVIDENCE: Diff vs the old client version (`git show c51a6a3:src/adapters/bluesky.ts`), and
      what changed and why:

      1. **Env var source and names.** Old: `process.env.EXPO_PUBLIC_BLUESKY_HANDLE` /
         `EXPO_PUBLIC_BLUESKY_APP_PASSWORD`, read once at module load as client `.env` values
         baked into the Expo bundle. New: `process.env.BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD`,
         read inside `publishToBluesky()` at call time from Convex's server-side action
         environment (`npx convex env set ...`), per PLAN.md's contract and spec-v0.md section 3
         ("credentials still do not go through Convex tables ... live in Convex's server-side
         environment variables"). No `EXPO_PUBLIC_` prefix because these never ship to the client
         bundle now.

      2. **Media source.** Old: `uploadImage(session, uri)` where `uri` was a local device
         `file://` path from the image picker, fetched directly with `fetch(uri)` inside the RN
         runtime (which has a `file://` fetch polyfill). New: `uploadImage(session, mediaUrl)`
         where `mediaUrl` is a Convex file-storage URL (remote, HTTP-fetchable). Convex actions
         cannot resolve a device-local path, so per PLAN.md's "Media upload note" the client
         uploads to Convex storage first and hands this module a fetchable URL instead. The
         `fetch(mediaUrl)` call itself is unchanged in shape — only what kind of URI is passed in
         changed, exactly as PLAN.md predicted ("this should be a small change, not a rewrite").

      3. **Byte reading: `blob()` -> `arrayBuffer()` + explicit content-type header.** Old used
         `response.blob()` and `bytes.type` for the content-type. New uses
         `mediaRes.arrayBuffer()` and `mediaRes.headers.get('content-type')`. Reason: Convex's
         default action runtime is a standards-based Fetch environment (confirmed via Convex docs:
         "Actions run in the default environment by default, which supports fetch") but is not a
         browser DOM, so relying on a `Blob`'s inferred `.type` property is a less-certain
         cross-runtime bet than reading the `Content-Type` response header directly and passing
         an `ArrayBuffer` body, which every fetch-compatible runtime accepts identically. This is
         a robustness adaptation for the new runtime, not a logic change — same upload contract
         (raw bytes + content-type header to `uploadBlob`).

      4. **Signature shape / no adapter object.** Old exported a `PlatformAdapter` object
         (`blueskyAdapter = { platform, isConfigured(), publish(post) }`) matching a shared
         client-side `PlatformAdapter` interface with `isConfigured()` used by the UI to render
         connected/not-connected chips. New exports a single plain async function
         `publishToBluesky(text, mediaUrl?)` per PLAN.md's Convex-side contract — there is no
         client-side adapter registry anymore (spec-v0.md section 8: "Nothing under `src/` ever
         imports a platform SDK or holds a credential"), so the `isConfigured()` /
         `PlatformAdapter` shape was dropped; the equivalent check (missing env vars) is now done
         inline inside `publishToBluesky` and surfaced through the same `{ success, error }`
         result shape instead of a separate method, since a Convex action has no synchronous
         "is this configured" UI hook to call.

      5. **Handle stripping removed.** Old built `handle = HANDLE?.replace('.bsky.social', '')`
         but then never used that stripped `handle` variable in the returned URL (it used the raw
         `HANDLE` constant instead — a dead line in the original). New drops the unused
         `.replace()` call entirely and uses `handle` (the raw env value) directly in the profile
         URL, matching what the old code's URL construction actually did at runtime. This is a
         dead-code removal, not a behavior change.

      6. Error handling, `createSession`, `uploadBlob` request/response shape, and
         `createRecord`'s `app.bsky.feed.post` / `app.bsky.embed.images` record structure are
         otherwise unchanged from the proven c51a6a3 implementation.

- [x] B3. Never throws — always resolves with `{ success: false, error }` on any failure
      EVIDENCE: The entire body of `publishToBluesky` (session creation, image upload, record
      creation, and the missing-env-var check) is wrapped in a single `try { ... } catch (err:
      unknown) { return { success: false, error: err instanceof Error ? err.message :
      String(err) } }` block (see `convex/lib/bluesky.ts` lines 63-129). Every internal helper
      (`createSession`, `uploadImage`) throws `Error` on a non-ok HTTP response instead of
      returning a sentinel, and every one of those throw sites is inside the try block of
      `publishToBluesky`, so no code path can propagate an exception out of the exported function.
      The missing-credentials case is handled by an explicit early `return { success: false,
      error: ... }` rather than a throw, for the same reason.

- [x] B4. File compiles standalone
      CHECK: cd /path/to/layer && npx tsc --noEmit --pretty false 2>&1 | grep -i bluesky || echo CLEAN
      EXPECT: CLEAN
      EVIDENCE:
      ```
      $ cd /path/to/layer && npx tsc --noEmit --pretty false 2>&1 | grep -i bluesky || echo CLEAN
      CLEAN
      ```
      Also confirmed the whole-project `npx tsc --noEmit --pretty false` (no grep filter) produced
      zero output — no errors anywhere in the project, not just none matching "bluesky".
