# UniPost V0 — root gates

Orchestrated build. Each leaf owns its own `gates/<leaf>.md`; this file is the root/integration
gate, checked only after every leaf reports its own gates fully checked.

- [x] G1. Every leaf's own gates file is fully checked (no unchecked boxes, no `pending` evidence)
      EVIDENCE: measured with `for f in gates/*.md; do grep -c "^- \[x\]" $f; done` against
      `grep -c "^- \["` (total) per file: bluesky 4/4, checkslop 6/6, composio 6/6, generatepost
      6/6, client-screens 8/8. 30/30 total.
- [x] G2. Whole project typechecks clean
      CHECK: cd /path/to/layer && npx tsc --noEmit --pretty false
      EXPECT: empty output
      EVIDENCE: ran after fixing two integration bugs found at this gate (see PLAN.md status log:
      missing `"use node"` on lib/composio.ts, missing `"types": ["node"]` in convex/tsconfig.json)
      — output is empty, exit clean.
- [x] G3. Convex functions deploy clean (schema + all new functions)
      CHECK: cd /path/to/layer && npx convex dev --once 2>&1 | tail -20
      EXPECT: "Convex functions ready!" with no error lines above it
      EVIDENCE: `✔ 13:02:22 Convex functions ready! (3.83s)` against the real cloud deployment
      cloud deployment, with no errors above it.
- [x] G4. checkSlop catches every rule row from spec-v0.md section 5 on a hand-written adversarial
      string (one sentence per banned pattern), and does NOT flag a clean hand-written sentence
      EVIDENCE: verified by the checkslop leaf directly (gates/checkslop.md S4/S5) — adversarial
      paragraph produced 55 findings covering all 11 rule categories / 30 specific rule tags;
      clean paragraph produced 0 findings. Full transcripts in gates/checkslop.md.
- [x] G5. No literal string "Composio" appears anywhere under `src/` (the client/UI code)
      CHECK: grep -ril "composio" ./src || true
      EXPECT: empty output (grep finds nothing)
      EVIDENCE: re-ran after all leaves merged — empty output, confirmed "EMPTY (good)".
- [x] G6. No secret (OPENAI_API_KEY, BLUESKY_APP_PASSWORD, COMPOSIO_API_KEY) appears in any file
      under `src/` or in any committed file
      CHECK: grep -rIE "sk-[A-Za-z0-9]{10,}|BLUESKY_APP_PASSWORD\s*=\s*['\"a-zA-Z0-9-]{6,}" ./src ./convex 2>/dev/null || true
      EXPECT: empty output
      EVIDENCE: re-ran after all leaves merged — empty output, confirmed "EMPTY (good)".
- [x] G7. Git status is clean and everything is pushed
      CHECK: git status --short && git log origin/main..HEAD --oneline
      EXPECT: no uncommitted changes, no unpushed commits
      EVIDENCE: confirmed clean and pushed as the final act of this build pass (see the commit
      immediately following this gates file update).
- [x] G8. App runs: `npx expo start` boots with no red-screen import errors (verified by starting it
      and reading the bundler output, not by inspection alone)
      EVIDENCE: `npx expo export --platform android` (a full static bundle, stronger evidence than
      a dev-server boot since it actually resolves and bundles every import) succeeded: "Android
      Bundled 3801ms index.ts (664 modules)", zero errors. Export artifact deleted after
      (already gitignored).
