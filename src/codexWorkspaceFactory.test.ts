import { afterEach, beforeEach, expect, it, vi } from "vitest";
const current = vi.hoisted(() => ({ label: "fixture-window" }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: current.label }) }));
vi.mock("./codexLive", () => ({ nativeCodexLiveBackend: {}, CodexLiveClient: class {
  constructor(readonly panelId: string) {}
  inspect = async () => true;
  subscribe = () => () => {};
  dispose = vi.fn();
} }));
import { desktopCodexWorkspace, releaseDesktopCodexWorkspace, CODEX_WORKSPACE_PREFIX, CODEX_WORKSPACE_V2_PREFIX } from "./codexWorkspace";
import { desktopCodexPanes } from "./codexDesktop";
beforeEach(() => { Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} }); localStorage.clear(); });
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });
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

it("uses disjoint addresses for new panes and scopes factory caches to the owning window", () => {
  const pane = "v2:00000000-0000-0000-0000-000000000043";
  current.label = "window-a";
  const first = desktopCodexWorkspace("/a", pane);
  first.update({ draft: "first draft" });
  expect(first.client.panelId).toBe(`codex:pane:v2:${JSON.stringify(["window-a", pane])}`);
  expect(first.key).toBe(CODEX_WORKSPACE_V2_PREFIX + JSON.stringify(["window-a", pane]));
  current.label = "window-b";
  const second = desktopCodexWorkspace("/b", pane);
  expect(second).not.toBe(first); expect(second.state().draft).toBe("");
  expect(second.client.panelId).not.toBe(first.client.panelId); expect(second.key).not.toBe(first.key);
  current.label = `window-a.${pane}`;
  const primary = desktopCodexWorkspace("/primary");
  expect(primary.client.panelId).not.toBe(first.client.panelId); expect(primary.key).not.toBe(first.key);
  releaseDesktopCodexWorkspace(pane, first);
  expect(first.client.dispose).toHaveBeenCalledOnce(); expect(second.client.dispose).not.toHaveBeenCalled();
});
it("preserves legacy draft and outbox addresses and refuses an ambiguous primary label without touching them", () => {
  const pane = "00000000-0000-0000-0000-000000000044";
  current.label = "legacy-parent";
  const key = CODEX_WORKSPACE_PREFIX + `legacy-parent.${pane}`;
  const outbox = `blackcrab.codexOutbox.v1.codex-legacy-parent.${pane}`;
  const saved = JSON.stringify({ version: 1, cwd: "/legacy", model: "", resumeId: "native", draft: "preserved", draftTarget: "native" });
  localStorage.setItem(key, saved); localStorage.setItem(outbox, "unconfirmed original send");
  const legacy = desktopCodexWorkspace("/new-default", pane);
  expect(legacy.key).toBe(key); expect(legacy.client.panelId).toBe(`codex-legacy-parent.${pane}`);
  expect(legacy.state().draft).toBe("preserved");
  current.label = `legacy-parent.${pane}`;
  expect(() => desktopCodexWorkspace("/ambiguous")).toThrow("conflicts with a legacy Codex pane address");
  expect(localStorage.getItem(key)).toBe(saved); expect(localStorage.getItem(outbox)).toBe("unconfirmed original send");
  expect(legacy.client.dispose).not.toHaveBeenCalled();
});
it("keeps desktop registries and deferred owner factories bound to their captured window", () => {
  current.label = "registry-a";
  const first = desktopCodexPanes("/a");
  current.label = "registry-b";
  const second = desktopCodexPanes("/b");
  expect(second).not.toBe(first); expect(second.key).not.toBe(first.key);
  const added = first.add()!;
  expect(added).toMatch(/^v2:/);
  expect(first.workspace(added).client.panelId).toBe(`codex:pane:v2:${JSON.stringify(["registry-a", added])}`);
  expect(second.workspace("primary").client.panelId).toBe("codex-registry-b");
  current.label = "registry-a";
  expect(desktopCodexPanes("/changed")).toBe(first);
});
