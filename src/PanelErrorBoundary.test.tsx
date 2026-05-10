import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(element);
  });
  return container;
}

function Crash(): ReactNode {
  throw new Error("boom");
}

describe("PanelErrorBoundary", () => {
  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("renders children before an error", () => {
    const el = render(
      <PanelErrorBoundary resetKey="panel-a" title="Panel A">
        <div>panel content</div>
      </PanelErrorBoundary>,
    );

    expect(el.textContent).toContain("panel content");
  });

  it("contains a render failure to the panel fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const el = render(
      <PanelErrorBoundary resetKey="panel-a" title="Panel A">
        <Crash />
      </PanelErrorBoundary>,
    );

    expect(el.textContent).toContain("Panel crashed");
    expect(el.textContent).toContain("Panel A");
    expect(el.textContent).toContain("boom");
  });
});
