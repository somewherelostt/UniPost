// Generates a fallback image via OpenAI's image generation API for posts that have no media
// attached. Instagram has no text-only post type (see the comment above `publishToInstagram`
// in composio.ts), so a text-only post to Instagram used to hard-fail with "Instagram requires
// a photo or video." This module backfills a generated image from the post's own caption text
// so that post can still go out, instead of failing.
//
// Follows convex/generatePost.ts's established pattern for calling OpenAI: a direct fetch() to
// OpenAI's REST API, no `openai` npm package (none is installed in this repo, and it should stay
// that way). OPENAI_API_KEY is read from process.env the same way generatePost.ts reads it.

import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

// gpt-image-2 is OpenAI's current image generation model (it superseded gpt-image-1 in April
// 2026 and is, as of this writing, the model OpenAI recommends for new integrations — confirmed
// against OpenAI's own docs and a live test call against this exact endpoint, not guessed). Like
// gpt-image-1 before it, the whole gpt-image family always returns base64-encoded image data —
// there is no `response_format: "url"` option the way older dall-e-2/3 models had one — so this
// module never has to handle a URL-shaped response or worry about a short-lived OpenAI-hosted
// URL expiring before the (possibly much later, for scheduled posts) publish step runs.
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string }>;
}

// Instagram captions routinely end in a run of hashtags (generatePost.ts's own Instagram prompt
// asks for 3-8 of them) and sometimes wrap phrases in quotes. Passed straight through as an
// image prompt, a model like gpt-image-2 tends to render that literal text into the image
// instead of treating it as subject matter. Stripping hashtags and framing the remaining text as
// "the idea", with an explicit no-text-in-image instruction, keeps the fallback image usable as
// a photo/illustration rather than a picture of a caption.
function buildImagePrompt(captionText: string): string {
  const withoutHashtags = captionText
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .replace(/#\w+/g, '')
    .trim();

  const subject = withoutHashtags.length > 0 ? withoutHashtags : captionText.trim();

  return `Create a photo or illustration that visually represents the following idea for a social
media post. Do not render any text, letters, or words in the image itself.

Idea: ${subject}`;
}

async function requestGeneratedImage(prompt: string): Promise<Uint8Array> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      n: 1,
      size: '1024x1024',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI image API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as OpenAIImageResponse;
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI image API returned no image data');
  }

  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates an image from `captionText` and stores it in Convex file storage, returning the new
 * storage id (the same kind of id `posts.mediaStorageId` already holds, so `ctx.storage.getUrl()`
 * works on it exactly like it does for a user-uploaded file).
 */
export async function generateFallbackImage(
  ctx: ActionCtx,
  captionText: string
): Promise<Id<'_storage'>> {
  const prompt = buildImagePrompt(captionText);
  const bytes = await requestGeneratedImage(prompt);
  // gpt-image-2 defaults to PNG output (no `output_format` override requested above), so the
  // stored blob's type is declared to match rather than guessed. Cast needed because the
  // installed TS lib types `Uint8Array.buffer` as `ArrayBufferLike` (which also covers
  // `SharedArrayBuffer`) while `BlobPart` wants a concrete `ArrayBuffer` — a real mismatch only
  // in the type checker, not at runtime, where `Blob` has always accepted a `Uint8Array` directly.
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  return await ctx.storage.store(blob);
}
