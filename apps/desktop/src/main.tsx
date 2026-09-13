import type { JSX } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoderApp } from "./components/CoderApp.js";
import { useCoderState } from "./state/useCoderState.js";
import "./styles.css";

function Root(): JSX.Element {
  const state = useCoderState();
  return (
    <CoderApp
      projects={state.projects}
      workspaces={state.workspaces}
      mesh={state.mesh}
      windowCount={state.windowCount}
    />
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
