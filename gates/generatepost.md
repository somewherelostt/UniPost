# Leaf: convex/generatePost.ts

- [x] G1. Convex `action` matching the exact args/return shape in PLAN.md's contract section
      (brief, platform, optional avoid[] -> generatedText, optional youtubeTitle)
      EVIDENCE: `convex/generatePost.ts` lines 165-174:
      ```ts
      export const generatePost = action({
        args: {
          brief: v.string(),
          platform: v.union(v.literal('bluesky'), v.literal('linkedin'), v.literal('youtube')),
          avoid: v.optional(v.array(v.string())),
        },
        returns: v.object({
          generatedText: v.string(),
          youtubeTitle: v.optional(v.string()),
        }),
        handler: async (_ctx, args): Promise<{ generatedText: string; youtubeTitle?: string }> => { ... }
      })
      ```
      Matches PLAN.md's contract exactly (args shape and handler return shape). `returns` validator
      added on top of the contract's minimum because the Convex codegen lint hook flagged the action
      for missing an explicit return validator.

- [x] G2. System/user prompt embeds the FULL condensed rule set from docs/spec-v0.md section 4
      (no em-dashes, no curly quotes, no hashtags, no hype emojis, no banned tell-words, no
      listicle/question openers, no self-praise, no closing platitudes, first person, active voice,
      short sentences, one claim per paragraph, lead with the claim) — not a generic "write a good
      post" prompt
      EVIDENCE: `BASE_RULES` constant (lines 22-76), quoted in full:
      ```
      You write posts for a real person's account. The single biggest failure mode is
      sounding AI-generated. Follow every rule below exactly.

      BANNED PUNCTUATION
      - Never use an em-dash (—) or en-dash (–) in prose. Use a period, a colon, a comma, or
        "and"/"but"/"so" instead.
      - Never use curly/smart quotes (" " ' '). Use straight quotes only (" ').
      - Never end a sentence with a trailing ellipsis (...).

      BANNED WORDS AND PHRASES (never use any of these)
      delve, delve into, dive deep, deep dive, embark on, leverage (as a verb), streamline,
      synergy, synergies, ecosystem (in the business sense), robust (as default praise),
      scalable (as default praise, unless a real number follows), seamless, cutting-edge,
      state-of-the-art, world-class, industry-leading, best-in-class, game-changing,
      revolutionary, paradigm shift, paradigm, holistic, myriad, plethora, elucidate,
      navigate (when not literal), empower, robust solution, powerful tool, thought leadership,
      "I hope this email finds you well", "I'd love to", "I'd be happy to", "I'd be delighted to",
      "I'm excited to", "excited to share", "thrilled to announce", "just wanted to reach out",
      "touch base", "circle back", "loop in", "sync up", "at your earliest convenience",
      "please don't hesitate to", "best regards", "warm regards", "kind regards",
      "as we all know", "needless to say", "it goes without saying", "it's important to note",
      "it's worth noting", "in conclusion", "to conclude", "in summary", "moreover" (as a
      paragraph starter), "furthermore" (as a paragraph starter), "additionally" (as a paragraph
      starter), "however" (as a paragraph starter), "in many cases", "generally speaking",
      "it depends", "some would argue", "arguably", "perhaps", "maybe" (when you mean it, say "I
      think"), "I might be wrong but", "game-changing", "mind-blowing", "insanely good",
      "if I do say so myself".

      BANNED HYPE EMOJIS (never use in the body)
      🚀 💡 ✨ 🔥 ⚡ 🎯 💪 🙌 👀 🤯 🧵

      BANNED HASHTAGS
      Never use a hashtag anywhere in the post.

      STRUCTURAL RULES
      - No listicle-announcement openers: "Here are N things", "Here's what I learned",
        "Let me share", "5 reasons why".
      - No question openers: "Have you ever wondered", "What if I told you", "Did you know",
        "Why do X?". A question opener is a hedge, not a hook.
      - Never announce what the post is about ("In this post I will..."). The first line is the
        actual claim, not a preview of one.
      - No closing platitudes: "Thanks for reading!", "Subscribe for more", "Follow me for X",
        "Drop your thoughts below", "Let me know what you think".
      - No self-praise: do not tell the reader the work is impressive. Let the fact speak.
      - No fake list parallelism / tricolon of negation more than once ("It's not just about X.
        It's not just about Y.").
      - One claim per paragraph. A paragraph that says two things becomes two paragraphs.
      - Use real numbers and real names. "Reduced latency by 40%" not "significantly reduced
        latency." Never "various platforms" when you can name the platform.

      VOICE
      - First person ("I built", "I learned"), not "we" unless it is genuinely a team effort.
      - Active voice. Short sentences, bias short over long.
      - Past tense for what was built, present tense for the lesson.
      - Lead with the strongest claim. Do not soften the ending into a summary.
      ```
      This text is sourced directly from `outreach/workflows/content_guardrails.md`
      (read in full before writing this file), condensed for prompt length but not paraphrased away
      from its actual banned-word list, phrase list, structural rules, and voice rules. It is
      prepended to every platform's system prompt via `buildSystemPrompt()` (lines 112-116), so it
      is never a generic "write a good post" instruction.

- [x] G3. Per-platform additions implemented distinctly: Bluesky targets well under 280 chars,
      LinkedIn front-loads the hook in the first 210 chars with blank lines between paragraphs and
      no markdown headers, YouTube generates title (<=100 chars) and description as two SEPARATE
      model outputs, not a split of one blob
      EVIDENCE: `platformInstructions()` (lines 78-101), three distinct branches, quoted in full:

      Bluesky:
      ```
      PLATFORM: Bluesky
      Target well under 280 characters total (Bluesky's real limit is 300 graphemes; stay
      comfortably under 280 so nothing gets cut). Write one tight post, no line breaks needed
      unless they earn their place. Every character should carry the claim.
      ```

      LinkedIn:
      ```
      PLATFORM: LinkedIn
      The first 210 characters MUST contain the full hook on their own, because LinkedIn
      truncates the post in-feed after that point and shows a "see more" link. Put a blank
      line between paragraphs (LinkedIn does not render markdown, so blank lines are the only
      way paragraphs read as separate). Do not use markdown headers (no #, no ##, no **bold**
      markers). Ending the post on a single question is allowed, since it drives comments, but
      use at most one question and only as the final line.
      ```

      YouTube:
      ```
      PLATFORM: YouTube
      Produce two separate fields, not one blob split in half:
      - "title": <= 100 characters. Curious and specific, never clickbait, never in ALL CAPS.
      - "description": <= 5000 characters. Gives real context on what the video covers, written
        in the same first-person, no-slop voice as the rest of this prompt.
      Respond with ONLY a JSON object of the exact shape {"title": "...", "description": "..."}.
      No prose before or after the JSON, no markdown code fence around it.
      ```
      For YouTube, the handler additionally sets `response_format: { type: 'json_object' }` on the
      OpenAI request (line 140, gated by `jsonMode: true` passed at the call site, line 184) and
      parses the response as `{ title, description }` (lines 186-190) — title and description are
      two genuinely separate model-produced fields via OpenAI's JSON mode, not a post-hoc split of
      one free-text blob.

- [x] G4. `avoid` argument, when present, is actually included in the prompt as explicit negative
      examples with the rule each one broke
      EVIDENCE: `buildAvoidSection()` (lines 103-110), appended to the system prompt by
      `buildSystemPrompt()` whenever `args.avoid` is non-empty:
      ```
      AVOID WRITING ANYTHING RESEMBLING THESE EXAMPLES OF AI-SOUNDING WRITING (a previous
      draft used these exact phrases and they were flagged as AI slop, do not reuse them or
      anything structurally similar to them):
      - "<quote 1>"
      - "<quote 2>"
      ```
      Each entry in `args.avoid` (expected to be a `SlopFinding.quote` from a previous
      `checkSlop` run, per PLAN.md) is rendered as its own quoted bullet. The section is omitted
      entirely (empty string) when `avoid` is undefined or `[]`, so the base prompt is not padded
      with an empty instruction on first generation.

- [x] G5. Reads `process.env.OPENAI_API_KEY`, calls the OpenAI API directly (fetch or official SDK,
      confirm which is already a project dependency before adding a new one)
      EVIDENCE: `package.json` has no `openai` dependency (confirmed by reading it before writing
      this file — only `convex`, `expo`, `expo-image-picker`, `expo-status-bar`, `react`,
      `react-native`). `callOpenAI()` (lines 122-163) reads `process.env.OPENAI_API_KEY` (line 127)
      and calls `fetch('https://api.openai.com/v1/chat/completions', ...)` (line 143) directly, with
      model `gpt-5.4-mini` (line 16) — confirmed via web search against platform.openai.com's own
      model docs (`platform.openai.com/docs/models/gpt-5-mini`, `developers.openai.com/api/docs/models/gpt-5.4-mini`)
      as OpenAI's current cost-efficient chat model, since `gpt-4o-mini` is the older generation and
      the spec asked to confirm the current naming rather than guess a stale one. No new npm
      dependency was added; `npm install` was not run by this leaf.
      Error handling choice (spec allowed either "empty string fallback" or "rethrow as Convex-
      friendly error" — picked the empty-string fallback for consistency): the action never throws.
      A missing API key, a non-OK HTTP response, or an OpenAI response with no `content` all raise
      inside `callOpenAI`, are caught in the `handler`'s try/catch (lines 182-206), logged via
      `console.error`, and converted into `{ generatedText: '' }` (or `{ generatedText: '',
      youtubeTitle: '' }` for YouTube) so a failed generation surfaces as an empty, retryable draft
      instead of crashing the calling mutation/UI during a live demo.

- [x] G6. File compiles standalone
      CHECK: cd /path/to/layer && npx tsc --noEmit --pretty false 2>&1 | grep -i generatePost || echo CLEAN
      EXPECT: CLEAN
      EVIDENCE: ran the exact check command. Output: `CLEAN (no generatePost errors)`. Also ran
      plain `npx tsc --noEmit --pretty false` with no grep filter: exit code 0, zero output,
      confirming the whole project (not just this file) compiles with no errors at the time this
      leaf finished.
