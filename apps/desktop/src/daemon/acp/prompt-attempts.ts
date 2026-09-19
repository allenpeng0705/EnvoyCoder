/**
 * The two shapes one `session/prompt` is sent in.
 *
 * A turn that is only words tries the standard ACP array first, then `{sessionId, text}`. That order
 * is the one this client already used: `envoy-harness` rejects the array (`text required`) and reads
 * the flat string, and `dsh` takes the array.
 *
 * A turn with a picture cannot fall through to the flat string — that shape has nowhere to put the
 * picture, so the agent would answer as if nothing had been attached. `envoy-harness` reads a
 * `content` list of text and image blocks; `dsh` reads the standard `prompt` array. Pictures try
 * `content` first, then the array.
 */

export interface PromptPicture {
  mimeType: string;
  data: string;
}

export function sessionPromptAttempts(
  sessionId: string,
  text: string,
  images: readonly PromptPicture[] = [],
): { first: Record<string, unknown>; second: Record<string, unknown>; pictures: boolean } {
  const pictures = images.filter(
    (image) => image.mimeType.startsWith("image/") && image.data.length > 0,
  );
  if (pictures.length === 0) {
    return {
      pictures: false,
      first: { sessionId, prompt: [{ type: "text", text }] },
      second: { sessionId, text },
    };
  }
  const blocks = [
    ...(text.length > 0 ? [{ type: "text", text }] : []),
    ...pictures.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })),
  ];
  return {
    pictures: true,
    first: { sessionId, content: blocks },
    second: { sessionId, prompt: blocks },
  };
}
