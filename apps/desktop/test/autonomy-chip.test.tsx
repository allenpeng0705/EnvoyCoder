/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerControls } from "../src/components/ComposerControls.js";
import { I18nProvider } from "../src/i18n/context.js";

afterEach(() => cleanup());

function show(
  over: Partial<React.ComponentProps<typeof ComposerControls>> = {},
): ReturnType<typeof render> {
  return render(
    <I18nProvider locale="en">
      <ComposerControls
        modes={[
          { id: "default", label: "Default" },
          { id: "plan", label: "Plan" },
          { id: "yolo", label: "YOLO", unattended: true },
        ]}
        selectedModeId="default"
        onChooseMode={() => undefined}
        modelKind="none"
        models={[]}
        selectedModelId={undefined}
        onChooseModel={() => undefined}
        thinkingOptions={[]}
        selectedThinkingLevel={undefined}
        onChooseThinking={() => undefined}
        agentLabel="Envoy"
        running={false}
        requireApproval={true}
        modeUnattended={false}
        onChooseAutonomyPreset={() => undefined}
        {...over}
      />
    </I18nProvider>,
  );
}

describe("autonomy chip presets", () => {
  it("shows the Default preset while Asking is on", () => {
    show();
    const chip = screen.getByTestId("composer-autonomy-chip");
    expect(chip.querySelector("select")?.value).toBe("default");
  });

  it("asks before enabling Full access", () => {
    const onChoose = vi.fn();
    show({ onChooseAutonomyPreset: onChoose });
    const select = screen.getByTestId("composer-autonomy-chip").querySelector("select")!;
    fireEvent.change(select, { target: { value: "full-access" } });
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByTestId("autonomy-full-access-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("autonomy-full-access-confirm-cta"));
    expect(onChoose).toHaveBeenCalledWith("full-access");
  });

  it("applies Read only without a confirm", () => {
    const onChoose = vi.fn();
    show({ onChooseAutonomyPreset: onChoose });
    const select = screen.getByTestId("composer-autonomy-chip").querySelector("select")!;
    fireEvent.change(select, { target: { value: "read-only" } });
    expect(onChoose).toHaveBeenCalledWith("read-only");
    expect(screen.queryByTestId("autonomy-full-access-confirm")).toBeNull();
  });
});
