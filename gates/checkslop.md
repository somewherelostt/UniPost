# Leaf: convex/checkSlop.ts

- [x] S1. Pure function, zero imports beyond plain JS/TS — no Convex, no network, no I/O
      CHECK: grep -E "^import" ./convex/checkSlop.ts || echo NO_IMPORTS
      EXPECT: NO_IMPORTS (or only type-only imports with no runtime dependency)
      EVIDENCE:
      ```
      $ grep -E "^import" ./convex/checkSlop.ts || echo NO_IMPORTS
      NO_IMPORTS
      ```
- [x] S2. Implements every row of the rule table in docs/spec-v0.md section 5 (curly quotes
      auto-fix, em-dash flag, banned tell-words flag, hashtags flag, hype emojis flag, listicle/
      question openers flag, self-praise flag, closing platitudes flag, trailing ellipsis flag,
      tricolon-of-negation flag) — not a subset
      EVIDENCE: each rule implemented and confirmed firing in the S4 adversarial run below
      (function name in convex/checkSlop.ts in parens):
      1. Curly quotes " " ' ' -> auto-fixed to straight quotes (`checkCurlyQuotes`) — rule `curly-quotes`
      2. Em-dash (—) / en-dash (–) in prose -> flagged, generic suggestion (`checkDashes`) — rules `em-dash`, `en-dash`
      3. Banned tell-words, all 21 groups from the table, word-boundary + case-insensitive
         (`checkTellWords` against `TELL_WORD_GROUPS`): delve/delve into, dive deep/deep dive,
         embark on, leverage, streamline, synergy/synergies, ecosystem, robust, scalable,
         seamless, cutting-edge/state-of-the-art, world-class/industry-leading/best-in-class,
         game-changing/revolutionary/paradigm shift, holistic, myriad/plethora, elucidate,
         paradigm (standalone, negative-lookahead excludes "paradigm shift" to avoid double count),
         navigate, empower, thought leadership — each with the exact suggestion from
         content_guardrails.md's replacement table
      4. Hashtags `#\w+` -> flagged (`checkHashtags`) — rule `hashtag`
      5. Hype emojis (all 11: 🚀💡✨🔥⚡🎯💪🙌👀🤯🧵) -> flagged (`checkHypeEmojis`) — rule `hype-emoji`
      6. Listicle openers, first line only: "Here are", "Here's what", "Let me share", "N reasons",
         "Want to know how" (`checkListicleOpener`) — rule `listicle-opener`
      7. Question openers, first line only: "Have you ever", "What if", "Did you know", "Why do"
         (`checkQuestionOpener`) — rule `question-opener`
      8. Self-praise: "game-changing", "mind-blowing", "insanely good" (`checkSelfPraise`) — rule `self-praise`
      9. Closing platitudes, last non-empty line: "thanks for reading", "subscribe for more",
         "follow me", "follow for more", "drop your thoughts" (`checkClosingPlatitude`) — rule `closing-platitude`
      10. Trailing ellipsis, any sentence ending in "..." (`checkTrailingEllipsis`) — rule `trailing-ellipsis`
      11. Tricolon of negation ("It's not X. It's not Y.") flagged only when it appears more than
          once in the text (`checkTricolonOfNegation`) — rule `tricolon-of-negation`
- [x] S3. Returns `{ cleanedText: string; findings: SlopFinding[] }` matching the exact shape in
      PLAN.md's contract section
      EVIDENCE: see `export interface SlopFinding { rule: string; quote: string; suggestion: string; autoFixed: boolean }`
      and `export function checkSlop(text: string): { cleanedText: string; findings: SlopFinding[] }`
      in convex/checkSlop.ts (matches PLAN.md's contract verbatim); confirmed by tsc (S6) and by
      the shape of every finding printed in S4/S5 below.
- [x] S4. Adversarial test: a hand-written paragraph containing every banned pattern produces a
      finding for each one
      EVIDENCE: throwaway script `convex/checkSlop.test-manual.ts` (deleted after capturing this
      output, run via `npx tsx convex/checkSlop.test-manual.ts`). Question-opener is verified with
      its own minimal second text because it and listicle-opener both anchor to the first line of
      text and are therefore mutually exclusive within a single paragraph.

      Adversarial input:
      ```
      Here are 5 reasons this framework is a game-changing, cutting-edge, state-of-the-art, world-class, industry-leading, best-in-class platform.
      I want to delve into how we embark on a dive deep into a deep dive on robust, scalable, and seamless system design, using "curly quotes" and 'more curly quotes' throughout.
      We leverage a streamline — process that lets teams delve into synergy and synergies within our ecosystem.
      This holistic approach handles a myriad of use cases, in fact a plethora of them, and lets me elucidate the paradigm behind it, though it is not a revolutionary paradigm shift so much as a way to navigate – complexity.
      It gives teams the power to empower themselves through real thought leadership, and honestly it is mind-blowing and insanely good work #AI #ProductLaunch.
      🚀💡✨🔥⚡🎯💪🙌👀🤯🧵.
      This changes everything...
      It's not about speed. It's not about cost.
      Thanks for reading, and follow me for more updates!
      ```
      (curly quotes shown straight above since this is post-copy; the actual script literal uses
      real U+201C/U+201D/U+2018/U+2019 characters)

      Findings (55 total) and rule-coverage check, actual run output:
      ```
      [AUTO-FIXED] rule=curly-quotes quote="“" suggestion="replace with a straight quote (\" or ')"
      [AUTO-FIXED] rule=curly-quotes quote="”" suggestion="replace with a straight quote (\" or ')"
      [AUTO-FIXED] rule=curly-quotes quote="‘" suggestion="replace with a straight quote (\" or ')"
      [AUTO-FIXED] rule=curly-quotes quote="’" suggestion="replace with a straight quote (\" or ')"
      [FLAGGED] rule=em-dash quote="We leverage a streamline — process that lets teams delve into synergy and synergies within our ecosystem." suggestion="replace with a period, comma, or rephrase"
      [FLAGGED] rule=en-dash quote="This holistic approach handles a myriad of use cases, in fact a plethora of them, and lets me elucidate the paradigm behind it, though it is not a revolutionary paradigm shift so much as a way to navigate – complexity." suggestion="replace with a period, comma, or rephrase"
      [FLAGGED] rule=banned-word:delve quote="delve into" suggestion="explore, look at, dig into"
      [FLAGGED] rule=banned-word:delve quote="delve into" suggestion="explore, look at, dig into"
      [FLAGGED] rule=banned-word:dive-deep quote="dive deep" suggestion="study, examine, look closely"
      [FLAGGED] rule=banned-word:dive-deep quote="deep dive" suggestion="study, examine, look closely"
      [FLAGGED] rule=banned-word:embark-on quote="embark on" suggestion="start, begin"
      [FLAGGED] rule=banned-word:leverage quote="leverage" suggestion="use"
      [FLAGGED] rule=banned-word:streamline quote="streamline" suggestion="simplify, speed up, reduce friction"
      [FLAGGED] rule=banned-word:synergy quote="synergy" suggestion="working together, fit"
      [FLAGGED] rule=banned-word:synergy quote="synergies" suggestion="working together, fit"
      [FLAGGED] rule=banned-word:ecosystem quote="ecosystem" suggestion="community, market, network"
      [FLAGGED] rule=banned-word:robust quote="robust" suggestion="tested, reliable (with evidence)"
      [FLAGGED] rule=banned-word:scalable quote="scalable" suggestion="scales to N (with a real N)"
      [FLAGGED] rule=banned-word:seamless quote="seamless" suggestion="cut the word, describe what actually happens"
      [FLAGGED] rule=banned-word:cutting-edge quote="cutting-edge" suggestion="cut and name the actual tech"
      [FLAGGED] rule=banned-word:cutting-edge quote="state-of-the-art" suggestion="cut and name the actual tech"
      [FLAGGED] rule=banned-word:world-class quote="world-class" suggestion="cut, name the metric"
      [FLAGGED] rule=banned-word:world-class quote="industry-leading" suggestion="cut, name the metric"
      [FLAGGED] rule=banned-word:world-class quote="best-in-class" suggestion="cut, name the metric"
      [FLAGGED] rule=banned-word:game-changing quote="game-changing" suggestion="cut, describe the change"
      [FLAGGED] rule=banned-word:game-changing quote="revolutionary" suggestion="cut, describe the change"
      [FLAGGED] rule=banned-word:game-changing quote="paradigm shift" suggestion="cut, describe the change"
      [FLAGGED] rule=banned-word:holistic quote="holistic" suggestion="full, complete, end-to-end"
      [FLAGGED] rule=banned-word:myriad quote="myriad" suggestion="many, several, hundreds of"
      [FLAGGED] rule=banned-word:myriad quote="plethora" suggestion="many, several, hundreds of"
      [FLAGGED] rule=banned-word:elucidate quote="elucidate" suggestion="explain, show"
      [FLAGGED] rule=banned-word:paradigm quote="paradigm" suggestion="almost never necessary, cut"
      [FLAGGED] rule=banned-word:navigate quote="navigate" suggestion="handle, work through"
      [FLAGGED] rule=banned-word:empower quote="empower" suggestion="enable, let, give"
      [FLAGGED] rule=banned-word:thought-leadership quote="thought leadership" suggestion="cut, just write the post"
      [FLAGGED] rule=hashtag quote="#AI" suggestion="cut the hashtag entirely"
      [FLAGGED] rule=hashtag quote="#ProductLaunch" suggestion="cut the hashtag entirely"
      [FLAGGED] rule=hype-emoji quote="🚀" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="💡" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="✨" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="🔥" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="⚡" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="🎯" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="💪" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="🙌" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="👀" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="🤯" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=hype-emoji quote="🧵" suggestion="cut the emoji, voice does the lifting"
      [FLAGGED] rule=listicle-opener quote="Here are 5 reasons this framework is a game-changing, cutting-edge, state-of-the-art, world-class, industry-leading, best-in-class platform." suggestion="lead with the actual claim instead of announcing a list"
      [FLAGGED] rule=self-praise quote="game-changing" suggestion="cut it, let the work earn the reaction"
      [FLAGGED] rule=self-praise quote="mind-blowing" suggestion="cut it, let the work earn the reaction"
      [FLAGGED] rule=self-praise quote="insanely good" suggestion="cut it, let the work earn the reaction"
      [FLAGGED] rule=closing-platitude quote="Thanks for reading, and follow me for more updates!" suggestion="cut it, or replace with a specific low-friction question"
      [FLAGGED] rule=trailing-ellipsis quote="This changes everything..." suggestion="finish the sentence or cut it"
      [FLAGGED] rule=tricolon-of-negation quote="It's not about speed. It's not about cost." suggestion="use this pattern once per piece at most, rephrase the repeats"

      === ADVERSARIAL rule-coverage check ===
      PASS curly-quotes
      PASS em-dash
      PASS en-dash
      PASS banned-word:delve
      PASS banned-word:dive-deep
      PASS banned-word:embark-on
      PASS banned-word:leverage
      PASS banned-word:streamline
      PASS banned-word:synergy
      PASS banned-word:ecosystem
      PASS banned-word:robust
      PASS banned-word:scalable
      PASS banned-word:seamless
      PASS banned-word:cutting-edge
      PASS banned-word:world-class
      PASS banned-word:game-changing
      PASS banned-word:holistic
      PASS banned-word:myriad
      PASS banned-word:elucidate
      PASS banned-word:paradigm
      PASS banned-word:navigate
      PASS banned-word:empower
      PASS banned-word:thought-leadership
      PASS hashtag
      PASS hype-emoji
      PASS listicle-opener
      PASS self-praise
      PASS closing-platitude
      PASS trailing-ellipsis
      PASS tricolon-of-negation

      ALL EXPECTED RULES FIRED

      === QUESTION-OPENER INPUT (separate minimal text) ===
      Have you ever wondered why teams ship slow?
      We found the real bottleneck last quarter.

      === QUESTION-OPENER findings ===
      [FLAGGED] rule=question-opener quote="Have you ever wondered why teams ship slow?" suggestion="make a claim instead of opening with a question"
      PASS question-opener
      ```
- [x] S5. Clean test: a hand-written paragraph with none of the banned patterns produces zero
      findings (besides possibly zero auto-fixes)
      EVIDENCE:
      ```
      === CLEAN INPUT ===
      I shipped the new retrieval pipeline last week.
      It cut median query latency from 800ms to 210ms on our benchmark set of 10,000 queries.
      The change was simple: batch the embedding calls instead of sending them one at a time.
      I tested it against the old pipeline on the same 500 test cases and matched every result.
      What am I missing about further reducing tail latency?

      === CLEAN findings (0 total) ===
      []
      PASS zero findings
      ```
- [x] S6. File compiles standalone
      CHECK: cd /path/to/layer && npx tsc --noEmit --pretty false 2>&1 | grep -i checkslop || echo CLEAN
      EXPECT: CLEAN
      EVIDENCE:
      ```
      $ npx tsc --noEmit --pretty false 2>&1 | grep -i checkslop || echo CLEAN
      CLEAN
      ```

All six gates pass. `convex/checkSlop.test-manual.ts` was deleted after capturing the S4/S5
evidence above, per the leaf instructions (no test runner is configured in package.json).
