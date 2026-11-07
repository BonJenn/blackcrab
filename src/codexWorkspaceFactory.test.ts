import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "fixture-window" }) }));
vi.mock("./codexLive", () => ({ nativeCodexLiveBackend: {}, CodexLiveClient: class {
  constructor(readonly panelId: string) {}
  inspect = async () => true;
  dispose = vi.fn();
} }));
import { desktopCodexWorkspace, releaseDesktopCodexWorkspace, CODEX_WORKSPACE_PREFIX } from "./codexWorkspace";
it("preserves legacy owner/storage identity while keeping added panes distinct", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const pane = "00000000-0000-0000-0000-000000000042";
  const original = desktopCodexWorkspace("/original");
  const added = desktopCodexWorkspace("/other", pane);
  expect(original.client.panelId).toBe("codex-fixture-window");
  expect(original.key).toBe(CODEX_WORKSPACE_PREFIX + "fixture-window");
  expect(added.client.panelId).toBe(`codex-fixture-window.${pane}`);
  expect(added.key).toBe(CODEX_WORKSPACE_PREFIX + `fixture-window.${pane}`);
  expect(desktopCodexWorkspace("/changed")).toBe(original);
  expect(desktopCodexWorkspace("/changed", pane)).toBe(added);
  expect(() => desktopCodexWorkspace("/bad", "../../foreign")).toThrow("Invalid Codex pane");
  releaseDesktopCodexWorkspace("primary", original);
  expect(original.client.dispose).not.toHaveBeenCalled();
  releaseDesktopCodexWorkspace(pane, added);
  expect(added.client.dispose).toHaveBeenCalledOnce();
  expect(desktopCodexWorkspace("/fresh", pane)).not.toBe(added);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});
