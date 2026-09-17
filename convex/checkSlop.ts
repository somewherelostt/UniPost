// Deterministic AI-slop detector for generated post drafts.
//
// Pure function, zero runtime dependencies (Convex, network, filesystem, or otherwise) so it can
// run identically inside a Convex action or later directly on the client. Mirrors the philosophy
// of the real de-slop skill (outreach/workflows/content_guardrails.md,
// outreach/skills/de-slop/SKILL.md): mechanical, unambiguous issues (curly quotes only) get
// silently auto-fixed. Everything else is flagged with an exact quote, the rule it breaks, and a
// suggestion — never silently rewritten.

export interface SlopFinding {
  rule: string;
  quote: string;
  suggestion: string;
  autoFixed: boolean;
}

interface CheckSlopResult {
  cleanedText: string;
  findings: SlopFinding[];
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** Escape a literal string for safe use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** Word-boundary, case-insensitive, global regex matching any of the given literal phrases. */
function phraseRegex(phrases: string[]): RegExp {
  const alternation = phrases.map(escapeRegExp).join('|');
  return new RegExp(`\\b(?:${alternation})\\b`, 'gi');
}

/**
 * Return the sentence (bounded by . ! ? or the start/end of the text) that contains the span
 * [matchIndex, matchIndex + matchLength) — used where a bare matched token would be too little
 * context to act on (dashes, trailing ellipses), per content_guardrails.md's point that the
 * correct fix for a dash "depends on the sentence."
 */
function extractSentence(text: string, matchIndex: number, matchLength: number): string {
  const before = text.slice(0, matchIndex);
  const lastBoundary = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const start = lastBoundary + 1;

  const afterStart = matchIndex + matchLength;
  const after = text.slice(afterStart);
  const dotIdx = after.indexOf('.');
  const bangIdx = after.indexOf('!');
  const qIdx = after.indexOf('?');
  const candidates = [dotIdx, bangIdx, qIdx].filter((i) => i !== -1);
  const end = candidates.length > 0 ? afterStart + Math.min(...candidates) + 1 : text.length;

  return text.slice(start, end).trim();
}

function pushFinding(findings: SlopFinding[], rule: string, quote: string, suggestion: string, autoFixed = false): void {
  findings.push({ rule, quote, suggestion, autoFixed });
}

// ---------------------------------------------------------------------------------------------
// Rule tables (from docs/spec-v0.md section 5 and content_guardrails.md)
// ---------------------------------------------------------------------------------------------

const CURLY_QUOTE_MAP: Record<string, string> = {
  '“': '"', // “
  '”': '"', // ”
  '‘': "'", // ‘
  '’': "'", // ’
};
const CURLY_QUOTE_REGEX = /[“”‘’]/g;

interface TellWordGroup {
  ruleId: string;
  phrases: string[];
  suggestion: string;
  /** When true, `phrases` entries are treated as raw regex fragments instead of literal text. */
  raw?: boolean;
}

const TELL_WORD_GROUPS: TellWordGroup[] = [
  { ruleId: 'delve', phrases: ['delve into', 'delve'], suggestion: 'explore, look at, dig into' },
  { ruleId: 'dive-deep', phrases: ['dive deep', 'deep dive'], suggestion: 'study, examine, look closely' },
  { ruleId: 'embark-on', phrases: ['embark on'], suggestion: 'start, begin' },
  { ruleId: 'leverage', phrases: ['leverage'], suggestion: 'use' },
  { ruleId: 'streamline', phrases: ['streamline'], suggestion: 'simplify, speed up, reduce friction' },
  { ruleId: 'synergy', phrases: ['synergies', 'synergy'], suggestion: 'working together, fit' },
  { ruleId: 'ecosystem', phrases: ['ecosystem'], suggestion: 'community, market, network' },
  { ruleId: 'robust', phrases: ['robust'], suggestion: 'tested, reliable (with evidence)' },
  { ruleId: 'scalable', phrases: ['scalable'], suggestion: 'scales to N (with a real N)' },
  { ruleId: 'seamless', phrases: ['seamless'], suggestion: 'cut the word, describe what actually happens' },
  { ruleId: 'cutting-edge', phrases: ['cutting-edge', 'state-of-the-art'], suggestion: 'cut and name the actual tech' },
  {
    ruleId: 'world-class',
    phrases: ['world-class', 'industry-leading', 'best-in-class'],
    suggestion: 'cut, name the metric',
  },
  {
    ruleId: 'game-changing',
    phrases: ['game-changing', 'revolutionary', 'paradigm shift'],
    suggestion: 'cut, describe the change',
  },
  { ruleId: 'holistic', phrases: ['holistic'], suggestion: 'full, complete, end-to-end' },
  { ruleId: 'myriad', phrases: ['myriad', 'plethora'], suggestion: 'many, several, hundreds of' },
  { ruleId: 'elucidate', phrases: ['elucidate'], suggestion: 'explain, show' },
  // Matched separately from "paradigm shift" above via negative lookahead so a single
  // occurrence of "paradigm shift" isn't double-counted as both rules.
  { ruleId: 'paradigm', phrases: ['paradigm(?!\\s+shift)'], suggestion: 'almost never necessary, cut', raw: true },
  { ruleId: 'navigate', phrases: ['navigate'], suggestion: 'handle, work through' },
  { ruleId: 'empower', phrases: ['empower'], suggestion: 'enable, let, give' },
  { ruleId: 'thought-leadership', phrases: ['thought leadership'], suggestion: 'cut, just write the post' },
];

const SELF_PRAISE_PHRASES = ['game-changing', 'mind-blowing', 'insanely good'];

const HYPE_EMOJIS = ['🚀', '💡', '✨', '🔥', '⚡', '🎯', '💪', '🙌', '👀', '🤯', '🧵'];

const LISTICLE_OPENER_PATTERNS: RegExp[] = [
  /^here are\b/i,
  /^here'?s what\b/i,
  /^let me share\b/i,
  /^\d+\s+reasons\b/i,
  /^want to know how\b/i,
];

const QUESTION_OPENER_PATTERNS: RegExp[] = [/^have you ever\b/i, /^what if\b/i, /^did you know\b/i, /^why do\b/i];

const CLOSING_PLATITUDES = ['thanks for reading', 'subscribe for more', 'follow me', 'follow for more', 'drop your thoughts'];

// Instagram/Pinterest are discovery/hashtag-driven platforms where a zero-hashtag caption
// meaningfully hurts reach — see docs/spec-v0.md section 5 and generatePost.ts's per-platform
// prompt override. checkSlop's hashtag rule for those two platforms downgrades from "ban every
// hashtag" to "ban generic, non-specific hashtags only" (this list, not an exhaustive one).
const GENERIC_HASHTAGS = new Set([
  '#love', '#instagood', '#follow', '#followme', '#followforfollowback', '#f4f', '#l4l',
  '#like', '#likeforlike', '#like4like', '#photooftheday', '#instadaily', '#instagram',
  '#happy', '#beautiful', '#picoftheday', '#style', '#cute', '#tbt', '#me', '#selfie',
  '#summer', '#fashion', '#viral', '#trending', '#explorepage', '#instapic',
]);

// ---------------------------------------------------------------------------------------------
// Individual checks — each appends to `findings` and reads from `text` (post curly-quote fix,
// since that is the only transform that changes the string clients will actually see/edit).
// ---------------------------------------------------------------------------------------------

function checkCurlyQuotes(original: string, findings: SlopFinding[]): string {
  let match: RegExpExecArray | null;
  const regex = new RegExp(CURLY_QUOTE_REGEX);
  while ((match = regex.exec(original)) !== null) {
    pushFinding(findings, 'curly-quotes', match[0], 'replace with a straight quote (" or \')', true);
  }
  return original.replace(CURLY_QUOTE_REGEX, (ch) => CURLY_QUOTE_MAP[ch] ?? ch);
}

function checkDashes(text: string, findings: SlopFinding[]): void {
  const regex = /[—–]/g; // — and –
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const isEmDash = match[0] === '—';
    const sentence = extractSentence(text, match.index, match[0].length);
    pushFinding(
      findings,
      isEmDash ? 'em-dash' : 'en-dash',
      sentence || match[0],
      'replace with a period, comma, or rephrase',
      false,
    );
  }
}

function checkTellWords(text: string, findings: SlopFinding[]): void {
  for (const group of TELL_WORD_GROUPS) {
    const alternation = group.phrases.map((p) => (group.raw ? p : escapeRegExp(p))).join('|');
    const regex = new RegExp(`\\b(?:${alternation})\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      pushFinding(findings, `banned-word:${group.ruleId}`, match[0], group.suggestion, false);
    }
  }
}

function checkHashtags(text: string, findings: SlopFinding[], allowHashtags: boolean): void {
  const regex = /#\w+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (!allowHashtags) {
      pushFinding(findings, 'hashtag', match[0], 'cut the hashtag entirely', false);
      continue;
    }
    if (GENERIC_HASHTAGS.has(match[0].toLowerCase())) {
      pushFinding(
        findings,
        'generic-hashtag',
        match[0],
        'replace with a hashtag specific to this post, not a generic engagement tag',
        false,
      );
    }
  }
}

function checkHypeEmojis(text: string, findings: SlopFinding[]): void {
  for (const char of text) {
    if (HYPE_EMOJIS.includes(char)) {
      pushFinding(findings, 'hype-emoji', char, 'cut the emoji, voice does the lifting', false);
    }
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function lastLine(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function checkListicleOpener(text: string, findings: SlopFinding[]): void {
  const line = firstLine(text);
  for (const pattern of LISTICLE_OPENER_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      pushFinding(findings, 'listicle-opener', line, 'lead with the actual claim instead of announcing a list', false);
      return;
    }
  }
}

function checkQuestionOpener(text: string, findings: SlopFinding[]): void {
  const line = firstLine(text);
  for (const pattern of QUESTION_OPENER_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      pushFinding(findings, 'question-opener', line, 'make a claim instead of opening with a question', false);
      return;
    }
  }
}

function checkSelfPraise(text: string, findings: SlopFinding[]): void {
  const regex = phraseRegex(SELF_PRAISE_PHRASES);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    pushFinding(findings, 'self-praise', match[0], 'cut it, let the work earn the reaction', false);
  }
}

function checkClosingPlatitude(text: string, findings: SlopFinding[]): void {
  const line = lastLine(text);
  const lowerLine = line.toLowerCase();
  for (const phrase of CLOSING_PLATITUDES) {
    if (lowerLine.includes(phrase)) {
      pushFinding(
        findings,
        'closing-platitude',
        line,
        'cut it, or replace with a specific low-friction question',
        false,
      );
      return;
    }
  }
}

function checkTrailingEllipsis(text: string, findings: SlopFinding[]): void {
  const regex = /\.\.\.(?!\.)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const lastBoundary = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
    const start = lastBoundary + 1;
    const end = match.index + match[0].length;
    const quote = text.slice(start, end).trim();
    pushFinding(findings, 'trailing-ellipsis', quote, 'finish the sentence or cut it', false);
  }
}

function checkTricolonOfNegation(text: string, findings: SlopFinding[]): void {
  const regex = /\bit'?s not\b[^.!?]*[.!?]/gi;
  const matches = text.match(regex) ?? [];
  if (matches.length > 1) {
    pushFinding(
      findings,
      'tricolon-of-negation',
      matches.map((m) => m.trim()).join(' '),
      'use this pattern once per piece at most, rephrase the repeats',
      false,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export function checkSlop(text: string, allowHashtags = false): CheckSlopResult {
  const findings: SlopFinding[] = [];

  // Step 1: the only auto-fix — curly quotes to straight quotes.
  const cleanedText = checkCurlyQuotes(text, findings);

  // Step 2+: everything else is flag-only, evaluated against the (curly-quote-fixed) text that
  // the user will actually see and edit next.
  checkDashes(cleanedText, findings);
  checkTellWords(cleanedText, findings);
  checkHashtags(cleanedText, findings, allowHashtags);
  checkHypeEmojis(cleanedText, findings);
  checkListicleOpener(cleanedText, findings);
  checkQuestionOpener(cleanedText, findings);
  checkSelfPraise(cleanedText, findings);
  checkClosingPlatitude(cleanedText, findings);
  checkTrailingEllipsis(cleanedText, findings);
  checkTricolonOfNegation(cleanedText, findings);

  return { cleanedText, findings };
}
