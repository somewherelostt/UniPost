// Direct AT Protocol client for Bluesky, ported from this repo's proven client-side
// implementation (git history commit c51a6a3, src/adapters/bluesky.ts) into a Convex-side
// module. See gates/bluesky.md for what changed and why.
//
// Runs in Convex's default action environment (not "use node") — that environment supports
// `fetch` and the standard Fetch API response methods used below, so no Node-specific API is
// needed here.

const SERVICE = 'https://bsky.social';

interface Session {
  accessJwt: string;
  did: string;
}

interface BlueskyBlob {
  $type: 'blob';
  ref: unknown;
  mimeType: string;
  size: number;
}

async function createSession(handle: string, appPassword: string): Promise<Session> {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!res.ok) {
    throw new Error(`Bluesky login failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { accessJwt: data.accessJwt, did: data.did };
}

async function uploadImage(session: Session, mediaUrl: string): Promise<BlueskyBlob> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) {
    throw new Error(`Fetching media for Bluesky upload failed: ${mediaRes.status} ${await mediaRes.text()}`);
  }
  const bytes = await mediaRes.arrayBuffer();
  const contentType = mediaRes.headers.get('content-type') || 'image/jpeg';

  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': contentType,
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Bluesky image upload failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.blob;
}

export async function publishToBluesky(
  text: string,
  mediaUrl?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const handle = process.env.BLUESKY_HANDLE;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;

    if (!handle || !appPassword) {
      return {
        success: false,
        error: 'Missing BLUESKY_HANDLE / BLUESKY_APP_PASSWORD Convex environment variables',
      };
    }

    const session = await createSession(handle, appPassword);

    const record: {
      $type: string;
      text: string;
      createdAt: string;
      embed?: { $type: string; images: { image: BlueskyBlob; alt: string }[] };
    } = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
    };

    // V0 scope: Bluesky supports text + image. Video posting on Bluesky requires a separate
    // job-based video pipeline (app.bsky.video.*) — out of scope for V0.
    if (mediaUrl) {
      const blob = await uploadImage(session, mediaUrl);
      record.embed = {
        $type: 'app.bsky.embed.images',
        images: [{ image: blob, alt: '' }],
      };
    }

    const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });

    if (!res.ok) {
      throw new Error(`Bluesky post failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const postId = data.uri?.split('/').pop();

    return {
      success: true,
      url: postId ? `https://bsky.app/profile/${handle}/post/${postId}` : undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
