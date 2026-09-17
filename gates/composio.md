# Leaf: convex/lib/composio.ts

- [x] C1. `npm install @composio/core` run, and the actual installed package's TypeScript type
      definitions read (not just scraped docs) to confirm the real client init + execute call shape
      EVIDENCE: `npm install @composio/core` run in repo root; installed `@composio/core@0.18.0`
      (added to `package.json` dependencies). Read `node_modules/@composio/core/src/composio.ts`
      and `node_modules/@composio/core/src/models/Tools.ts` (the package ships its own TS source,
      per its README: "This package intentionally ships its TypeScript source... so the installed
      package is inspectable by coding agents"). Confirmed real shape from
      `src/models/Tools.ts` line 1153:
      ```ts
      async execute(
        slug: string,
        body: ToolExecuteParams,
        options?: ExecuteToolModifiers & ComposioRequestOptions
      ): Promise<ToolExecuteResponse>
      ```
      and `ToolExecuteParams` (`src/types/tool.types.ts` line 382):
      ```ts
      export const ToolExecuteParamsSchema = z.object({
        allowTracing: z.boolean().optional(),
        connectedAccountId: z.string().optional(),
        customAuthParams: CustomAuthParamsSchema.optional(),
        customConnectionData: CustomConnectionDataSchema.optional(),
        arguments: z.record(z.string(), z.unknown()).optional(),
        userId: z.string().optional(),
        version: z.union([z.literal('latest'), z.string()]).optional(),
        dangerouslySkipVersionCheck: z.boolean().optional(),
        text: z.string().optional(),
      });
      ```
      and `ToolExecuteResponse` (same file, line 404): `{ data: Record<string, unknown>, error:
      string | null, successful: boolean, logId?: string, sessionInfo?: unknown }`. Confirmed
      client init from `src/composio.ts`: `new Composio({ apiKey })` (named export `Composio`,
      not default). So the real call is `composio.tools.execute(slug, { userId, arguments,
      dangerouslySkipVersionCheck: true })` — the older docs-suggested
      `composio.tools.execute('LINKEDIN_CREATE_POST', { arguments: {...} })` shape (no userId)
      from `docs/spec-v0.md` line 180 was missing the required-in-practice
      `dangerouslySkipVersionCheck` flag (see `ComposioToolVersionRequiredError` in
      `src/errors/ToolErrors.ts`, thrown when `version` resolves to `"latest"`, which it does
      here since this app doesn't pin `toolkitVersions`).

      IMPORTANT GAP FOUND (documented in docs/composio-setup.md): the installed package does
      **not** ship the per-tool argument schemas (e.g. exactly which fields
      `LINKEDIN_CREATE_LINKED_IN_POST` or the YouTube upload tool accept) —
      `node_modules/@composio/core/generated/index.d.ts` is a stub: `"Stub file for
      @composio/core/generated exports. Run \`composio ts generate\` to generate the actual
      toolkit types."` Real tool schemas are fetched from Composio's backend at call time and
      require a live `COMPOSIO_API_KEY`, which was not available in this environment. Handled by
      (a) using exactly the field names given in the leaf brief/PLAN.md for the two known fields
      (`author`, `commentary`, `visibility: 'PUBLIC'`), (b) trying the most likely tool slug and
      falling back to an alternate on `ComposioToolNotFoundError` (verified this error class is
      exported: `src/errors/ToolErrors.ts` line 32, re-exported via `src/index.ts`'s `export *
      from './errors'`), and (c) documenting the exact recovery command
      (`composio execute <slug> --get-schema`) in docs/composio-setup.md for when real credentials
      land. This is a genuine assumption, not a verified fact — flagged explicitly rather than
      presented as confirmed.

- [x] C2. Exports `publishToLinkedIn(text: string): Promise<{ success: boolean; url?: string; error?: string }>`
      using the `LINKEDIN_CREATE_LINKED_IN_POST` tool (author URN via `GET_MY_INFO`, commentary,
      visibility) — reads `process.env.COMPOSIO_API_KEY`
      EVIDENCE: Implemented in `convex/lib/composio.ts`. Calls
      `executeToolWithFallback(composio, LINKEDIN_INFO_TOOL_SLUGS, { userId, arguments: {} })`
      where `LINKEDIN_INFO_TOOL_SLUGS = ['LINKEDIN_GET_MY_INFO', 'GET_MY_INFO']` (the
      `LINKEDIN_`-prefixed form follows the toolkit-slug convention the CLI's own README states
      explicitly — "`GOOGLE_ANALYTICS_RUN_REPORT` belongs to `google_analytics`, not `google`" —
      confirmed from `raw.githubusercontent.com/ComposioHQ/composio/next/ts/packages/cli/README.md`;
      the bare `GET_MY_INFO` from the task brief is kept as the fallback slug). The extracted
      author id is formatted `urn:li:person:<id>` by `extractLinkedInAuthorUrn`, then
      `LINKEDIN_CREATE_LINKED_IN_POST` is executed with
      `{ author: authorUrn, commentary: text.slice(0, 3000), visibility: 'PUBLIC' }`.
      `getComposioClient()` throws if `process.env.COMPOSIO_API_KEY` is unset, caught by the
      outer try/catch and rewrapped to the generic error message.

- [x] C3. Exports `publishToYouTube(title: string, description: string, videoUrl: string): Promise<{ success: boolean; url?: string; error?: string }>`
      using a YouTube upload tool — confirm from the installed package whether it takes a URL or a
      file buffer and adapt accordingly (the spec assumed a URL; verify, don't assume)
      EVIDENCE: Implemented in `convex/lib/composio.ts`. Confirmed the real upload-staging API
      from `node_modules/@composio/core/src/models/Files.node.ts`:
      ```ts
      async upload({ file, toolSlug, toolkitSlug }: {
        file: File | string; toolSlug: string; toolkitSlug: string;
      }): Promise<FileUploadData>   // FileUploadData = { name, mimetype, s3key }
      ```
      with doc comment confirming the exact question this gate asks: `"@param {File | string}
      params.file - The path to the file to upload, **a URL of the file**, or a File object."`
      So the SDK takes a URL directly (`videoUrl` is passed straight into `composio.files.upload`)
      and stages it server-side — `convex/lib/composio.ts` never downloads the video bytes itself.
      The staged `{ name, mimetype, s3key }` descriptor is then passed as the tool's file-input
      argument. Tries `YOUTUBE_UPLOAD_TOOL_SLUGS = ['YOUTUBE_UPLOAD_VIDEO',
      'YOUTUBE_MULTIPART_UPLOAD_VIDEO']` in order, catching `ComposioToolNotFoundError` to fall
      through to the next slug (same "no local tool catalog" gap as C1 — the exact upload tool
      slug and its argument field names, e.g. whether the staged-file argument is named `video`,
      couldn't be confirmed without a live API key; flagged in docs/composio-setup.md rather than
      silently assumed correct). Sets `privacyStatus: 'unlisted'`.

- [x] C4. No raw Composio error string ever returned to the caller — every catch block rewraps into
      a generic platform-level message (e.g. "Could not publish to LinkedIn"), never containing the
      word "Composio" or any Composio-specific error text
      EVIDENCE: quoting the actual catch blocks from `convex/lib/composio.ts`:
      ```ts
      } catch (error) {
        logComposioFailure('publishToLinkedIn', error);
        return { success: false, error: 'Could not publish to LinkedIn' };
      }
      ```
      and
      ```ts
      } catch (error) {
        logComposioFailure('publishToYouTube', error);
        return { success: false, error: 'Could not publish to YouTube' };
      }
      ```
      plus the internal non-`successful` branches (`logComposioFailure('LinkedIn profile lookup',
      infoResult.error)` / `'LinkedIn post creation'` / `'YouTube upload'`) which also return only
      the hardcoded generic strings. `logComposioFailure` writes to `console.error` (server-side
      Convex logs only, never part of the function's return value):
      ```ts
      function logComposioFailure(context: string, error: unknown): void {
        console.error(`[composio] ${context} failed:`, error);
      }
      ```
      Every return path that can carry an error is one of exactly two hardcoded literals:
      `'Could not publish to LinkedIn'` and `'Could not publish to YouTube'`. Neither contains
      "Composio", a tool slug, or any interpolated error content.

- [x] C5. File compiles standalone
      CHECK: cd /path/to/layer && npx tsc --noEmit --pretty false 2>&1 | grep -i composio || echo CLEAN
      EXPECT: CLEAN
      EVIDENCE: ran the exact command above — output was `CLEAN`. (Full `tsc` run has pre-existing
      unrelated errors in `App.tsx`, `convex/publishPost.ts`, and `src/screens/ComposeScreen.tsx`
      from other in-progress leaves; none reference composio.ts or mention "composio".)

- [x] C6. Also write `docs/composio-setup.md`: the exact CLI commands to run once (login, link
      linkedin, link youtube) — verified against the actually-installed package's CLI, not guessed
      EVIDENCE: `docs/composio-setup.md` written. Verified the CLI is **not** an npm package —
      `node_modules/@composio/core/package.json` has no `bin` field, and `npm view @composio/cli
      version` / `curl https://registry.npmjs.org/@composio/cli` both return "Not found" (the
      package exists in the `ComposioHQ/composio` monorepo at `ts/packages/cli` but is marked
      `"private": true` in its own `package.json`, confirmed via
      `raw.githubusercontent.com/ComposioHQ/composio/next/ts/packages/cli/package.json`). The
      real distribution channel is a shell installer, confirmed from the monorepo root README
      (`raw.githubusercontent.com/ComposioHQ/composio/next/README.md` line 105 and the packages
      table at line 146: `` [`composio` CLI](ts/packages/cli) | Standalone CLI binary: `curl
      -fsSL https://composio.dev/install | sh` ``). Command names (`composio login`, `composio
      link [<toolkit>]`, `composio version`, `composio whoami`, `composio connections list`)
      confirmed from the CLI package's own README
      (`raw.githubusercontent.com/ComposioHQ/composio/next/ts/packages/cli/README.md`, "Commands"
      section). `docs/composio-setup.md` also documents, and links back to, the C1 tool-catalog
      gap and the `composio execute <slug> --get-schema` recovery path for when real credentials
      are available.
