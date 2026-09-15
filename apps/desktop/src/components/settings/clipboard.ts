/**
 * **Putting a command on the clipboard, on all three webviews** — and saying so honestly when it fails.
 *
 * ## Why this is not one line of `navigator.clipboard.writeText`
 *
 * The modern API needs a **secure context**, and this app is loaded from three different ones: Vite's
 * `http://127.0.0.1:6173` in development (loopback counts as secure), Tauri's own protocol in the packaged
 * app, and whatever the Linux bundle ends up with under WebKitGTK. Whether WebKit and WebView2 agree that
 * those are secure is a question for the machine rather than for a document, so the write is attempted
 * through the modern API **and** through the `execCommand("copy")` path every one of them still implements.
 *
 * ## The gesture is why the order is what it is
 *
 * Both paths need the user's click to still be *in flight*: WebKit refuses a clipboard write that happens
 * after an `await`. So the legacy path is chosen **before** anything is awaited — a runtime that has no
 * `navigator.clipboard` goes straight to the synchronous path inside the click, and only a runtime that has
 * the API *and fails with it* reaches the fallback late, where it may fail. That ordering is the difference
 * between "Copy works on Linux" and "Copy works on the two machines the tests ran on".
 *
 * ## What it returns, and why a boolean rather than a throw
 *
 * `false` is a real answer here: a user pressing Copy on a machine with no working clipboard should be told
 * it did not work rather than shown a tick. A thrown error would make every caller write the same `catch`,
 * and a caller that forgot would render a *Copied* label over a command that is not on the clipboard —
 * which is the one outcome this product has a rule against (a control that lies about what it did).
 *
 * The same honesty governs whether the control exists at all: `canCopyText()` is asked **before** the button
 * is rendered, so a machine with no clipboard path shows the command and no button, rather than a button
 * that cannot work. EnvoyMesh's Social app copies pairing codes and device ids the same way (its own
 * `navigator.clipboard` calls, with a transient confirmation), so a user meets one behaviour in both apps.
 */

/** Is there any way to put text on the clipboard here? */
export function canCopyText(): boolean {
  const modern = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (modern !== undefined && typeof modern.writeText === "function") return true;
  return (
    typeof document !== "undefined" &&
    typeof (document as { execCommand?: unknown }).execCommand === "function"
  );
}

/**
 * Copy `text`, and report whether it landed.
 *
 * Never rejects: see the module doc. A caller renders the result; nothing here decides what a failure looks
 * like.
 */
export async function copyText(text: string): Promise<boolean> {
  const modern = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (modern !== undefined && typeof modern.writeText === "function") {
    try {
      await modern.writeText(text);
      return true;
    } catch {
      // A denied permission or an insecure context. The fallback below is late and may also fail — which is
      // why this returns the fallback's answer rather than assuming it worked.
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

/**
 * The pre-`navigator.clipboard` path: select a throwaway textarea and ask the document to copy it.
 *
 * `execCommand` is deprecated and is still the only thing that works in every webview this product ships in.
 * The textarea is placed off-screen rather than `display: none` — an element that is not rendered cannot be
 * selected, and one that is rendered in place would flash a box inside the row the user is reading.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const exec = (document as { execCommand?: unknown }).execCommand;
  if (typeof exec !== "function") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.left = "-1000px";
  document.body.appendChild(area);
  try {
    area.select();
    return (exec as (command: string) => boolean).call(document, "copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
