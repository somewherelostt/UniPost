// convex/generatePost.ts
//
// Convex action: brief + platform -> LLM-generated post copy.
// Calls the OpenAI chat completions API directly via fetch (no `openai` package
// dependency — see PLAN.md, this leaf must not touch package.json).
//
// The prompt embeds the full anti-slop rule set from
// outreach/workflows/content_guardrails.md (condensed but not paraphrased away
// from its actual wording) because the point of UniPost is that generated
// copy never reads as AI-generated in the first place. `checkSlop` is the
// second, mechanical line of defense; this prompt is the first.

import { action } from './_generated/server';
import { v } from 'convex/values';

const OPENAI_MODEL = 'gpt-5.4-mini';

type Platform =
  | 'bluesky'
  | 'linkedin'
  | 'youtube'
  | 'instagram'
  | 'pinterest'
  | 'facebook'
  | 'twitter'
  | 'threads';

// Condensed, verbatim-sourced anti-slop rule set. Shared by every platform
// branch below, then extended with platform-specific structural rules.
const BASE_RULES = `You write posts for a real person's account. The single biggest failure mode is
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
- Lead with the strongest claim. Do not soften the ending into a summary.`;

// Shared by Bluesky and Twitter/X below: both platforms are short-form, one-post, no-thread
// surfaces with a hard character ceiling, and "target well under 280 characters, one tight post"
// is the same instruction either way — only the platform name and its real limit differ (Bluesky:
// 300 graphemes; X standard tier: 280 characters exactly). Sharing this as a constant instead of
// writing Twitter's branch from scratch, per the task's own note that the constraint is nearly
// identical to Bluesky's.
function shortFormPlatformInstructions(platformName: string, realLimitNote: string): string {
  return `PLATFORM: ${platformName}
Target well under 280 characters total (${realLimitNote}). Write one tight post, no line breaks
needed unless they earn their place. Every character should carry the claim.`;
}

function platformInstructions(platform: Platform): string {
  if (platform === 'bluesky') {
    return shortFormPlatformInstructions(
      'Bluesky',
      "Bluesky's real limit is 300 graphemes; stay comfortably under 280 so nothing gets cut"
    );
  }
  if (platform === 'twitter') {
    return shortFormPlatformInstructions(
      'Twitter/X',
      "X's standard-tier limit is 280 characters; stay well under it so nothing gets cut"
    );
  }
  if (platform === 'linkedin') {
    return `PLATFORM: LinkedIn
The first 210 characters MUST contain the full hook on their own, because LinkedIn
truncates the post in-feed after that point and shows a "see more" link. Put a blank
line between paragraphs (LinkedIn does not render markdown, so blank lines are the only
way paragraphs read as separate). Do not use markdown headers (no #, no ##, no **bold**
markers). Ending the post on a single question is allowed, since it drives comments, but
use at most one question and only as the final line.`;
  }
  if (platform === 'youtube') {
    return `PLATFORM: YouTube
Produce two separate fields, not one blob split in half:
- "title": <= 100 characters. Curious and specific, never clickbait, never in ALL CAPS.
- "description": <= 5000 characters. Gives real context on what the video covers, written
  in the same first-person, no-slop voice as the rest of this prompt.
Respond with ONLY a JSON object of the exact shape {"title": "...", "description": "..."}.
No prose before or after the JSON, no markdown code fence around it.`;
  }
  if (platform === 'instagram') {
    return `PLATFORM: Instagram
Write a caption for a feed post that accompanies a photo or video (the media is already
selected; do not describe what is in it, write copy that stands next to it). Target well under
2200 characters (Instagram's real caption limit) — most strong captions are one to four short
paragraphs. Line breaks between short paragraphs read naturally in-feed.

Exception to the no-hashtags rule above: on this platform, include 3 to 8 relevant, specific
hashtags at the end of the caption, on their own line. Generic hashtags like #love #instagood
are still banned — they must be topically specific to the content, not generic engagement bait.`;
  }
  if (platform === 'pinterest') {
    return `PLATFORM: Pinterest
Produce two separate fields, not one blob split in half:
- "title": <= 100 characters. Specific and searchable — Pinterest is a search engine first, a
  feed second, so name exactly what the pin is about instead of teasing it.
- "description": <= 500 characters. Real, keyword-rich context (Pinterest surfaces pins by
  matching the description against search), written in the same first-person, no-slop voice as
  the rest of this prompt.
Respond with ONLY a JSON object of the exact shape {"title": "...", "description": "..."}.
No prose before or after the JSON, no markdown code fence around it.

Exception to the no-hashtags rule above: on this platform, include 3 to 8 relevant, specific
hashtags at the end of the "description" field. Generic hashtags like #love #instagood are
still banned — they must be topically specific to the content, not generic engagement bait.`;
  }
  if (platform === 'facebook') {
    return `PLATFORM: Facebook
Write a conversational post for a Facebook Page. This can run longer than the Bluesky/X-style
post above (a few short paragraphs is fine, Facebook has no meaningful length ceiling for this
use case), but do not pad it just because there is room. Same tone family as LinkedIn (real
claims, no fluff) but noticeably less formal — write the way you would tell a friend about it,
not the way you would write a professional update. No hashtags on this platform at all: unlike
Instagram/Pinterest, Facebook Page posts perform fine with zero hashtags, so the base
BANNED HASHTAGS rule above applies here with no exception. Blank lines between short
paragraphs read naturally in-feed, same as LinkedIn.`;
  }
  return `PLATFORM: Threads
Write a short, conversational post for Meta's Threads app. Similar length culture to Twitter/X
and Bluesky (most strong Threads posts are one or two short sentences, not a paragraph), but the
platform reads noticeably more casual and text-first than either: no line-break formatting
tricks, just one plain-spoken thought, closer to how you would actually talk than to a polished
LinkedIn update. Target well under 280 characters (Threads shares X's practical length culture
even though its own limit is longer) so the post reads as a single tight beat, not a wall of
text. No hashtags on this platform.`;
}

function buildAvoidSection(avoid: string[] | undefined): string {
  if (!avoid || avoid.length === 0) return '';
  const quotedList = avoid.map((quote) => `- "${quote}"`).join('\n');
  return `\n\nAVOID WRITING ANYTHING RESEMBLING THESE EXAMPLES OF AI-SOUNDING WRITING (a previous
draft used these exact phrases and they were flagged as AI slop, do not reuse them or
anything structurally similar to them):
${quotedList}`;
}

function buildSystemPrompt(platform: Platform, avoid: string[] | undefined): string {
  return `${BASE_RULES}

${platformInstructions(platform)}${buildAvoidSection(avoid)}`;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

async function callOpenAI(params: {
  systemPrompt: string;
  brief: string;
  jsonMode: boolean;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: `Brief: ${params.brief}` },
    ],
  };
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as OpenAIChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI API returned no content');
  }
  return content;
}

// Platforms whose prompt asks the model for a title/body split instead of one blob. The
// `youtubeTitle` schema field doubles as the generic "platform title" for all of them (see the
// matching comment in convex/publishPost.ts's dispatch()) rather than adding a `pinterestTitle`
// column for what is structurally the same title/description split YouTube already has.
const JSON_MODE_PLATFORMS: Platform[] = ['youtube', 'pinterest'];

export const generatePost = action({
  args: {
    brief: v.string(),
    platform: v.union(
      v.literal('bluesky'),
      v.literal('linkedin'),
      v.literal('youtube'),
      v.literal('instagram'),
      v.literal('pinterest'),
      v.literal('facebook'),
      v.literal('twitter'),
      v.literal('threads')
    ),
    avoid: v.optional(v.array(v.string())),
  },
  returns: v.object({
    generatedText: v.string(),
    youtubeTitle: v.optional(v.string()),
  }),
  handler: async (
    _ctx,
    args,
  ): Promise<{ generatedText: string; youtubeTitle?: string }> => {
    const platform = args.platform as Platform;
    const systemPrompt = buildSystemPrompt(platform, args.avoid);
    const usesJsonMode = JSON_MODE_PLATFORMS.includes(platform);

    try {
      if (usesJsonMode) {
        const raw = await callOpenAI({ systemPrompt, brief: args.brief, jsonMode: true });
        try {
          const parsed = JSON.parse(raw) as { title?: string; description?: string };
          return {
            generatedText: parsed.description ?? '',
            youtubeTitle: parsed.title ?? '',
          };
        } catch (parseError) {
          console.error(`generatePost: failed to parse ${platform} JSON output`, parseError, raw);
          return { generatedText: '', youtubeTitle: '' };
        }
      }

      const text = await callOpenAI({ systemPrompt, brief: args.brief, jsonMode: false });
      return { generatedText: text.trim() };
    } catch (error) {
      // Never throw out of this action: a failed generation should surface as an
      // empty draft the user can retry, not a crashed request during a live demo.
      console.error('generatePost: OpenAI call failed', error);
      return usesJsonMode
        ? { generatedText: '', youtubeTitle: '' }
        : { generatedText: '' };
    }
  },
});
