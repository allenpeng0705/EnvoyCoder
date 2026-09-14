import type { JSX } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoderApp } from "./components/CoderApp.js";
import { useCoderActions, useCoderState } from "./state/useCoderState.js";
// Design tokens before the app sheet: `styles.css` consumes these variables, and one import order
// that works by accident is one refactor away from a screen with no colours.
import "./design/tokens.css";
import "./styles.css";

/**
 * The window's root.
 *
 * Two hooks and no data of its own: the state comes from the daemon through one store, and the
 * actions go back through the same store, so a component cannot be handed a list that is a copy of
 * another component's list. There is no provider in between because there is exactly one store per
 * window — the moment there are two (a second daemon, a remote host), this becomes a context.
 */
function Root(): JSX.Element {
  const state = useCoderState();
  const actions = useCoderActions();
  return <CoderApp state={state} actions={actions} />;
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
