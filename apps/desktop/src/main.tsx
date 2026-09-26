import type { JSX } from "react";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CoderApp } from "./components/CoderApp.js";
import { applyTheme } from "./design/applyTheme.js";
import { I18nProvider } from "./i18n/context.js";
import { useCoderActions, useCoderState } from "./state/useCoderState.js";
// Design tokens before the app sheet: `styles.css` consumes these variables, and one import order
// that works by accident is one refactor away from a screen with no colours.
// Dark is this product's default until settings load (`docs/design-tokens.md`); Settings → Appearance
// then writes or clears `data-theme` via `applyTheme`.
applyTheme("dark");

/**
 * The platform, for the handful of CSS rules that are genuinely OS-specific.
 *
 * Only one today: macOS draws its window controls **over** the webview when the shell asks for an overlay
 * title bar, so the app's own top bar has to leave room for them (see `styles.css`). A UA check is the
 * honest mechanism here — WKWebView, WebView2 and WebKitGTK do not expose the OS to CSS any other way —
 * and guessing wrong costs a padding on Windows and Linux, not a broken control.
 */
const ua = navigator.userAgent;
document.documentElement.dataset.os = /Mac|iPhone|iPad/.test(ua)
  ? "macos"
  : /Windows/.test(ua)
    ? "windows"
    : "linux";
import "./design/tokens.css";
import "./styles.css";

/**
 * The window's root.
 *
 * Two hooks and no data of its own: the state comes from the daemon through one store, and the
 * actions go back through the same store, so a component cannot be handed a list that is a copy of
 * another component's list.
 *
 * **The one provider in between is the translator**, mounted here rather than inside `CoderApp`
 * because the language is a *setting* — it arrives from the daemon with the rest of the state — and
 * a component that owned it could not be rendered without one. `preference` is what the user chose
 * (`system` included); the provider resolves it against what the platform reports, and re-renders
 * every `t()` in the window when the setting changes. No reload, and no second source of truth about
 * which language is in use.
 *
 * Theme follows the same path: `applyTheme` runs whenever `settings.theme` changes so Light / Dark /
 * System take effect without a reload.
 */
function Root(): JSX.Element {
  const state = useCoderState();
  const actions = useCoderActions();
  useEffect(() => {
    applyTheme(state.settings.theme ?? "dark");
  }, [state.settings.theme]);
  return (
    <I18nProvider preference={state.settings.language ?? "system"}>
      <CoderApp state={state} actions={actions} />
    </I18nProvider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
